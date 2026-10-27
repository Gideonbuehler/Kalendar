// ============================================================================
// CalDAV Service — caldavService.js
// ============================================================================
// Handles all communication with the CalDAV/Nextcloud server.
// Runs in the Electron main process (Node.js context).
//
// Operations supported:
//   - connect()           — Authenticate and discover calendars
//   - fetchEvents()       — REPORT query for VEVENT components
//   - createEvent()       — PUT a new .ics event file
//   - updateEvent()       — GET existing → modify → PUT back
//   - deleteEvent()       — DELETE an .ics file by UID
//   - createCalendar()    — MKCALENDAR with display name + color
//   - updateCalendarColor/Name() — PROPPATCH
//   - shareCalendar()     — POST with ownCloud sharing namespace
//   - getCalendarShares() — PROPFIND for ACL
//   - removeCalendarShare() — POST with ownCloud un-share
//
// Uses the `dav` library for initial account discovery, and raw HTTP
// requests (via Node's http/https modules) for all other operations.
// iCal parsing/generation is handled by the `ical.js` (ICAL) library.
// ============================================================================

const dav = require("dav");
const ICAL = require("ical.js");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");

// Recurring events are expanded into individual occurrences within this window
// (relative to "now"). Non-recurring events are always returned regardless of date.
const RECURRENCE_PAST_DAYS = 365;
const RECURRENCE_FUTURE_DAYS = 730;
const MAX_OCCURRENCES_PER_EVENT = 1500;
const MAX_RECURRENCE_ITERATIONS = 50000;
const REQUEST_TIMEOUT_MS = 30000;

// ── XML / iCalendar helpers ─────────────────────────────────────────────

/**
 * decodeXmlText — Turns the text content of an XML element back into plain text.
 * Servers escape calendar-data inside their XML responses (e.g. "&amp;", "&#13;"),
 * which must be undone before the iCalendar parser sees it.
 */
function decodeXmlText(text) {
  const cdata = text.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1];
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * parseMultistatus — Splits a WebDAV multistatus body into its <response> entries.
 * Works with any namespace prefix (Nextcloud uses "d:"/"cal:", other servers use
 * default namespaces). Returns [{ href, props: { localName: text } }].
 */
function parseMultistatus(xml, propNames) {
  const results = [];
  const responseRe = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi;
  const pick = (body, tag) => {
    const re = new RegExp(
      `<(?:[\\w-]+:)?${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>)`,
      "i"
    );
    const m = body.match(re);
    return m && m[1] != null ? decodeXmlText(m[1].trim()) : null;
  };
  let match;
  while ((match = responseRe.exec(xml))) {
    const body = match[1];
    const props = {};
    for (const name of propNames) props[name] = pick(body, name);
    results.push({ href: pick(body, "href"), props });
  }
  return results;
}

/** Normalizes a collection URL for comparisons (decoded path, trailing slash). */
function collectionKey(url) {
  try {
    let path = decodeURIComponent(new URL(url).pathname);
    if (!path.endsWith("/")) path += "/";
    return path;
  } catch (e) {
    return url;
  }
}

/** Nextcloud stores colors as "#RRGGBBAA"; the UI (and <input type=color>) wants "#RRGGBB". */
function normalizeColor(color) {
  if (!color) return null;
  const m = color.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  return m ? `#${m[1]}` : color.trim();
}

/** Registers every VTIMEZONE in a VCALENDAR so TZID-based times convert correctly. */
function registerTimezones(vcalendar) {
  for (const vtz of vcalendar.getAllSubcomponents("vtimezone")) {
    try {
      const tz = new ICAL.Timezone(vtz);
      if (tz.tzid && !ICAL.TimezoneService.has(tz.tzid)) {
        ICAL.TimezoneService.register(tz.tzid, tz);
      }
    } catch (e) {
      console.warn("Skipping invalid VTIMEZONE:", e.message);
    }
  }
}

/**
 * toICALTime — Converts a JS Date into an ICAL.Time.
 * All-day values become DATE values (local calendar day). Timed values keep the
 * timezone style of `like` (the value being replaced) so that recurring events
 * keep their TZID and stay at the same wall-clock time across DST changes.
 * New values without a template are written in UTC.
 */
function toICALTime(jsDate, allDay, like) {
  const date = new Date(jsDate);
  if (allDay) {
    return ICAL.Time.fromData({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      isDate: true,
    });
  }
  if (like && !like.isDate && like.zone) {
    if (like.zone === ICAL.Timezone.localTimezone) {
      return ICAL.Time.fromJSDate(date, false);
    }
    if (like.zone !== ICAL.Timezone.utcTimezone && like.zone.tzid) {
      return ICAL.Time.fromJSDate(date, true).convertToZone(like.zone);
    }
  }
  return ICAL.Time.fromJSDate(date, true);
}

/**
 * setTimeProperty — Writes an ICAL.Time into a DTSTART/DTEND/RECURRENCE-ID
 * property, setting VALUE=DATE and TZID parameters to match the value.
 */
function setTimeProperty(component, name, time) {
  let prop = component.getFirstProperty(name);
  if (!prop) {
    prop = new ICAL.Property(name);
    component.addProperty(prop);
  }
  writeTimeValue(prop, time);
}

/** Sets a property's value to an ICAL.Time along with matching VALUE/TZID parameters. */
function writeTimeValue(prop, time) {
  const previousTzid = prop.getParameter("tzid");
  prop.removeParameter("tzid");
  prop.resetType(time.isDate ? "date" : "date-time");
  prop.setValue(time);

  const zone = time.zone;
  if (!time.isDate && zone && zone !== ICAL.Timezone.utcTimezone) {
    if (zone !== ICAL.Timezone.localTimezone && zone.tzid) {
      prop.setParameter("tzid", zone.tzid);
    } else if (previousTzid && !ICAL.TimezoneService.has(previousTzid)) {
      // Unknown TZID (no VTIMEZONE): we treated it as local time when reading,
      // so keep the TZID and write local wall-clock time back.
      prop.setParameter("tzid", previousTzid);
    }
  }
}

/** Adds `seconds` of wall-clock time (whole days for DATE values) to a time property. */
function shiftTimeProperty(prop, seconds) {
  const values = prop.getValues();
  if (!values.every((value) => value instanceof ICAL.Time)) return; // e.g. RDATE periods
  const shifted = values.map((value) => {
    const t = value.clone();
    const step = t.isDate ? Math.round(seconds / 86400) * 86400 : seconds;
    t.addDuration(ICAL.Duration.fromSeconds(step));
    return t;
  });
  if (prop.isMultiValue) {
    prop.setValues(shifted);
  } else {
    prop.setValue(shifted[0]);
  }
}

/** The RECURRENCE-ID of an exception VEVENT as epoch milliseconds. */
function recurrenceIdMs(vevent) {
  const value = vevent.getFirstPropertyValue("recurrence-id");
  return value ? value.toJSDate().getTime() : null;
}

/** Marks a VEVENT as modified (DTSTAMP, LAST-MODIFIED, SEQUENCE). */
function touchEvent(vevent) {
  const now = ICAL.Time.fromJSDate(new Date(), true);
  vevent.updatePropertyWithValue("dtstamp", now);
  vevent.updatePropertyWithValue("last-modified", now);
  const sequence = parseInt(vevent.getFirstPropertyValue("sequence"), 10) || 0;
  vevent.updatePropertyWithValue("sequence", sequence + 1);
}

/** Sets a text property, removing it entirely when the new value is empty. */
function setTextProperty(vevent, name, value) {
  if (value) {
    vevent.updatePropertyWithValue(name, value);
  } else {
    vevent.removeAllProperties(name);
  }
}

/**
 * applyEventChanges — Applies edited fields from the UI to a VEVENT.
 * Times keep the timezone style of the values they replace.
 */
function applyEventChanges(vevent, eventData) {
  if (eventData.title !== undefined) setTextProperty(vevent, "summary", eventData.title);
  if (eventData.description !== undefined) setTextProperty(vevent, "description", eventData.description);
  if (eventData.location !== undefined) setTextProperty(vevent, "location", eventData.location);

  const oldStart = vevent.getFirstPropertyValue("dtstart");
  const oldEnd = vevent.getFirstPropertyValue("dtend") || oldStart;
  const allDay =
    eventData.allDay !== undefined ? !!eventData.allDay : !!(oldStart && oldStart.isDate);
  if (eventData.start) {
    setTimeProperty(vevent, "dtstart", toICALTime(eventData.start, allDay, oldStart));
  }
  if (eventData.end) {
    vevent.removeAllProperties("duration");
    setTimeProperty(vevent, "dtend", toICALTime(eventData.end, allDay, oldEnd));
  }
  touchEvent(vevent);
}

/**
 * createException — Builds the VEVENT that overrides one occurrence of a series:
 * a copy of the master (including alarms) without recurrence rules, pinned to
 * the occurrence via RECURRENCE-ID.
 */
function createException(master, recurrenceTime) {
  const exception = new ICAL.Component("vevent");
  const skip = new Set(["rrule", "rdate", "exdate", "dtstart", "dtend", "duration", "recurrence-id"]);
  for (const prop of master.getAllProperties()) {
    if (!skip.has(prop.name)) {
      exception.addProperty(new ICAL.Property(JSON.parse(JSON.stringify(prop.toJSON()))));
    }
  }
  for (const sub of master.getAllSubcomponents()) {
    exception.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(sub.toJSON()))));
  }
  const end = recurrenceTime.clone();
  end.addDuration(new ICAL.Event(master).duration);
  setTimeProperty(exception, "recurrence-id", recurrenceTime);
  setTimeProperty(exception, "dtstart", recurrenceTime.clone());
  setTimeProperty(exception, "dtend", end);
  return exception;
}

/**
 * updateSeries — Applies an edit to every occurrence of a recurring event.
 * A time change is applied as a wall-clock shift of the series start (so a
 * 9:00 meeting moved to 10:00 stays at 10:00 across DST), and EXDATEs and
 * overridden occurrences are shifted along so they keep matching the series.
 */
function updateSeries(master, exceptions, eventData, originalStart) {
  const masterEvent = new ICAL.Event(master);
  const textOnly = {
    title: eventData.title,
    description: eventData.description,
    location: eventData.location,
  };
  applyEventChanges(master, textOnly);

  if (!eventData.start || !eventData.end || !originalStart) return;

  const newStart = new Date(eventData.start).getTime();
  const deltaSeconds = Math.round((newStart - new Date(originalStart).getTime()) / 1000);
  const durationSeconds = Math.round((new Date(eventData.end).getTime() - newStart) / 1000);

  const start = masterEvent.startDate.clone();
  const step = start.isDate ? Math.round(deltaSeconds / 86400) * 86400 : deltaSeconds;
  start.addDuration(ICAL.Duration.fromSeconds(step));
  const end = start.clone();
  end.addDuration(
    ICAL.Duration.fromSeconds(
      start.isDate ? Math.max(1, Math.round(durationSeconds / 86400)) * 86400 : durationSeconds
    )
  );
  setTimeProperty(master, "dtstart", start);
  master.removeAllProperties("duration");
  setTimeProperty(master, "dtend", end);

  if (step !== 0) {
    master.getAllProperties("exdate").forEach((prop) => shiftTimeProperty(prop, step));
    master.getAllProperties("rdate").forEach((prop) => shiftTimeProperty(prop, step));
    exceptions.forEach((ex) => {
      ex.getAllProperties("recurrence-id").forEach((prop) => shiftTimeProperty(prop, step));
    });
  }
}

/** Finds the occurrence of a recurring master event whose start equals `targetMs`. */
function findOccurrenceTime(masterEvent, targetMs) {
  const iterator = masterEvent.iterator();
  let next;
  let guard = 0;
  while ((next = iterator.next()) && guard++ < MAX_RECURRENCE_ITERATIONS) {
    const ms = next.toJSDate().getTime();
    if (ms === targetMs) return next;
    if (ms > targetMs) break;
  }
  return null;
}

/** Splits a VCALENDAR's VEVENTs into the master and its RECURRENCE-ID exceptions. */
function splitEvents(vcalendar) {
  const vevents = vcalendar.getAllSubcomponents("vevent");
  const master = vevents.find((v) => !v.hasProperty("recurrence-id")) || null;
  const exceptions = vevents.filter((v) => v.hasProperty("recurrence-id"));
  return { vevents, master, exceptions };
}

/**
 * CalDAVService — Singleton service for all server-side calendar operations.
 * Maintains a reference to the last-used credentials for convenience,
 * but each IPC call receives credentials explicitly for safety.
 */
class CalDAVService {
  constructor() {
    this.credentials = null; // Cached credentials from last successful connect()
    this.serverUrl = null;   // Cached server URL
  }

  /**
   * makeRequest — Low-level HTTP/HTTPS request helper.
   * Works in Electron's main process (no browser fetch/XMLHttpRequest).
   * Handles Basic auth, self-signed certificates, and streaming response body.
   */
  makeRequest(method, url, data, headers, username, password) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";
      const client = isHttps ? https : http;

      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const body = data ? Buffer.from(data, "utf8") : null;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: {
          Authorization: `Basic ${auth}`,
          ...(body ? { "Content-Length": body.length } : {}),
          ...headers,
        },
        rejectUnauthorized: false, // Allow self-signed certificates
      };

      console.log(`Making ${method} request to:`, parsedUrl.pathname);

      const req = client.request(options, (res) => {
        // Collect raw chunks and decode once, so multi-byte characters
        // (umlauts, emoji) that straddle chunk boundaries aren't corrupted
        const chunks = [];

        res.on("data", (chunk) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const responseData = Buffer.concat(chunks).toString("utf8");
          console.log(
            `Response status: ${res.statusCode} ${res.statusMessage}`
          );

          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            body: responseData,
            headers: res.headers,
          });
        });
      });

      // Don't let a hung server leave the UI waiting forever
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy(new Error("Request timed out (ETIMEDOUT)"));
      });

      req.on("error", (error) => {
        console.error(`Request error:`, error);
        reject(error);
      });

      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * normalizeServerUrl — Ensures the server URL ends with /remote.php/dav
   * (the standard Nextcloud CalDAV endpoint). Strips trailing slashes.
   */
  normalizeServerUrl(serverUrl) {
    let normalizedUrl = serverUrl.trim();

    if (normalizedUrl.endsWith("/")) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }

    if (!normalizedUrl.includes("/remote.php/dav")) {
      normalizedUrl = normalizedUrl + "/remote.php/dav";
    }

    return normalizedUrl;
  }

  /** Creates a dav.transport.Basic instance for the `dav` library's account discovery. */
  createXHR(username, password) {
    return new dav.transport.Basic(
      new dav.Credentials({
        username: username,
        password: password,
      })
    );
  }
  /**
   * connect — Authenticates with the CalDAV server and discovers calendars.
   * Uses the `dav` library's createAccount() which performs PROPFIND to
   * enumerate all calendars (VEVENT + VTODO collections).
   * Returns { success, calendars[] } or { success: false, error }.
   */
  async connect(serverUrl, username, password) {
    try {
      const normalizedUrl = this.normalizeServerUrl(serverUrl);
      console.log("Connecting to CalDAV server:", normalizedUrl);

      const xhr = this.createXHR(username, password);

      const account = await dav.createAccount({
        server: normalizedUrl,
        xhr: xhr,
        accountType: "caldav",
        loadCollections: true,
      });

      this.serverUrl = normalizedUrl;
      this.credentials = { username, password };

      // The dav library doesn't load calendar colors, so fetch them separately
      const colors = await this.fetchCalendarColors(
        username,
        password,
        account.homeUrl
      );

      // Return plain objects (the dav objects carry back-references to the account)
      const calendars = (account.calendars || []).map((cal) => ({
        url: cal.url,
        displayName: cal.displayName,
        description: cal.description,
        components: cal.components || [],
        ctag: cal.ctag,
        color: colors[collectionKey(cal.url)] || null,
      }));

      console.log(
        "Connected successfully, calendars:",
        calendars.map((c) => `${c.displayName} [${c.components.join(",")}]`)
      );

      return { success: true, calendars, homeUrl: account.homeUrl };
    } catch (error) {
      console.error("CalDAV connection error:", error);

      // Provide user-friendly error messages
      let userMessage = error.message;

      if (
        error.message.includes("401") ||
        error.message.includes("Unauthorized")
      ) {
        userMessage =
          "Invalid username or password. Please check your credentials.";
      } else if (
        error.message.includes("404") ||
        error.message.includes("Not Found")
      ) {
        userMessage = "Server not found. Please check the URL.";
      } else if (
        error.message.includes("405") ||
        error.message.includes("Method Not Allowed")
      ) {
        userMessage =
          "Connection error. Please verify your Nextcloud server URL.";
      } else if (
        error.message.includes("timeout") ||
        error.message.includes("ETIMEDOUT")
      ) {
        userMessage =
          "Connection timed out. Please check your internet connection and server URL.";
      } else if (
        error.message.includes("ENOTFOUND") ||
        error.message.includes("getaddrinfo")
      ) {
        userMessage =
          "Cannot reach server. Please check the URL and your internet connection.";
      } else if (error.message.includes("ECONNREFUSED")) {
        userMessage =
          "Server refused connection. Please verify the server is running.";
      }

      return { success: false, error: userMessage };
    }
  }

  /**
   * fetchCalendarColors — PROPFINDs the calendar home for Apple's calendar-color
   * property. Returns { collectionKey: "#rrggbb" }. Failures are non-fatal.
   */
  async fetchCalendarColors(username, password, homeUrl) {
    const colors = {};
    if (!homeUrl) return colors;
    try {
      const response = await this.makeRequest(
        "PROPFIND",
        homeUrl,
        `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">
  <D:prop><I:calendar-color/></D:prop>
</D:propfind>`,
        { "Content-Type": "application/xml; charset=utf-8", Depth: "1" },
        username,
        password
      );
      if (response.status >= 200 && response.status < 300) {
        for (const entry of parseMultistatus(response.body, ["calendar-color"])) {
          const color = normalizeColor(entry.props["calendar-color"]);
          if (entry.href && color) {
            colors[collectionKey(new URL(entry.href, homeUrl).toString())] = color;
          }
        }
      }
    } catch (error) {
      console.warn("Could not load calendar colors:", error.message);
    }
    return colors;
  }

  /**
   * parseCalendarObject — Converts one calendar object resource (.ics) into
   * display events. Recurring events are expanded into one entry per occurrence
   * (honouring EXDATEs and moved/changed occurrences), all-day events are flagged,
   * and TZID times are converted using the resource's VTIMEZONE definitions.
   *
   * Each event carries `url` (the resource to PUT/DELETE) and, for occurrences
   * of a series, `recurrenceId` (the occurrence's original start in epoch ms).
   */
  parseCalendarObject(icsText, resourceUrl, etag) {
    const vcalendar = new ICAL.Component(ICAL.parse(icsText));
    registerTimezones(vcalendar);

    const { vevents, master, exceptions } = splitEvents(vcalendar);
    if (vevents.length === 0) return [];

    const build = (item, startTime, endTime, recurrenceId, recurring) => {
      const allDay = !!startTime.isDate;
      const start = startTime.toJSDate();
      let end = endTime ? endTime.toJSDate() : start;
      if (end <= start) {
        // Zero-length events: all-day spans one day, timed events get a visible 30 min
        end = allDay
          ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
          : new Date(start.getTime() + 30 * 60000);
      }
      return {
        id: recurrenceId != null ? `${resourceUrl}#${recurrenceId}` : resourceUrl,
        uid: item.uid,
        url: resourceUrl,
        etag: etag || null,
        title: item.summary || "Untitled Event",
        start,
        end,
        allDay,
        description: item.description || "",
        location: item.location || "",
        recurring,
        recurrenceId,
      };
    };

    // A resource containing only overridden instances (e.g. an invitation to a
    // single occurrence): show each instance on its own
    if (!master) {
      return exceptions.map((vevent) => {
        const ev = new ICAL.Event(vevent);
        return build(ev, ev.startDate, ev.endDate, null, false);
      });
    }

    const masterEvent = new ICAL.Event(master);
    exceptions.forEach((ex) => masterEvent.relateException(ex));

    if (!masterEvent.isRecurring()) {
      return [build(masterEvent, masterEvent.startDate, masterEvent.endDate, null, false)];
    }

    const now = Date.now();
    const rangeStart = now - RECURRENCE_PAST_DAYS * 86400000;
    const rangeEnd = now + RECURRENCE_FUTURE_DAYS * 86400000;
    const occurrences = [];
    const iterator = masterEvent.iterator();
    let next;
    let guard = 0;
    while (
      (next = iterator.next()) &&
      guard++ < MAX_RECURRENCE_ITERATIONS &&
      occurrences.length < MAX_OCCURRENCES_PER_EVENT
    ) {
      const details = masterEvent.getOccurrenceDetails(next);
      const startMs = details.startDate.toJSDate().getTime();
      const endMs = details.endDate.toJSDate().getTime();
      if (next.toJSDate().getTime() > rangeEnd) break;
      if (endMs < rangeStart || startMs > rangeEnd) continue;
      occurrences.push(
        build(
          details.item,
          details.startDate,
          details.endDate,
          details.recurrenceId.toJSDate().getTime(),
          true
        )
      );
    }
    return occurrences;
  }

  /**
   * fetchEvents — Retrieves all VEVENT items from a calendar.
   * Sends a CalDAV REPORT request with a calendar-query filter,
   * then parses each iCalendar response using ical.js.
   * Returns { success, events[] } where each event has id, title, start, end, etc.
   */
  async fetchEvents(username, password, calendar, calendarUrl) {
    try {
      if (!username || !password || (!calendar && !calendarUrl)) {
        throw new Error("Missing required parameters");
      }

      const targetUrl = calendar ? calendar.url : calendarUrl;
      console.log("Fetching events from:", targetUrl);

      // Check if this is a tasks calendar
      if (calendar && calendar.components) {
        console.log("Calendar components:", calendar.components);
        if (
          calendar.components.includes("VTODO") &&
          !calendar.components.includes("VEVENT")
        ) {
          console.warn(
            "WARNING: This is a tasks calendar (VTODO), not an events calendar (VEVENT)!"
          );
          console.warn(
            "No events will be found. Please select a calendar that supports events."
          );
          return { success: true, events: [] };
        }
      }

      const events = [];

      try {
        const reportXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

        // Add Cache-Control/Pragma headers to prevent caching
        const response = await this.makeRequest(
          "REPORT",
          targetUrl,
          reportXml,
          {
            "Content-Type": "application/xml; charset=utf-8",
            Depth: "1",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
          username,
          password
        );

        if (response.status < 200 || response.status >= 300) {
          throw new Error(
            `Server returned status ${response.status}: ${response.statusText}`
          );
        }

        // Each <response> holds one .ics resource: its href (needed to update or
        // delete it later — it is NOT always "<UID>.ics") and its calendar data
        const entries = parseMultistatus(response.body || "", [
          "getetag",
          "calendar-data",
        ]);

        for (const entry of entries) {
          const calendarData = entry.props["calendar-data"];
          if (!entry.href || !calendarData || !calendarData.includes("BEGIN:VCALENDAR")) {
            continue;
          }
          try {
            const resourceUrl = new URL(entry.href, targetUrl).toString();
            events.push(
              ...this.parseCalendarObject(
                calendarData,
                resourceUrl,
                entry.props.getetag
              )
            );
          } catch (parseError) {
            console.error(`Error parsing ${entry.href}:`, parseError.message);
          }
        }
      } catch (queryError) {
        console.error("Calendar query failed:", queryError);
        throw queryError;
      }

      console.log(`Successfully fetched ${events.length} events`);
      return { success: true, events };
    } catch (error) {
      console.error("Fetch events error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * createEvent — Creates a new event on the CalDAV server.
   * Builds an iCalendar (VCALENDAR/VEVENT) string using ical.js,
   * then PUTs it to the calendar URL as a new .ics file.
   * Uses "If-None-Match: *" to prevent overwriting existing events.
   */
  async createEvent(username, password, calendar, calendarUrl, eventData) {
    try {
      console.log("Creating event with:", {
        username,
        hasCalendar: !!calendar,
        calendarUrl,
        eventData,
      });

      // Validate inputs
      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      if (!calendar && !calendarUrl) {
        throw new Error("No calendar selected. Please select a calendar.");
      }

      if (!eventData.title || !eventData.start || !eventData.end) {
        throw new Error(
          "Missing required event information (title, start, or end date)."
        );
      }

      const comp = new ICAL.Component(["vcalendar", [], []]);
      comp.updatePropertyWithValue("prodid", "-//Kalendar//EN");
      comp.updatePropertyWithValue("version", "2.0");

      const vevent = new ICAL.Component("vevent");
      const event = new ICAL.Event(vevent);

      event.uid = crypto.randomUUID();
      event.summary = eventData.title;
      const now = ICAL.Time.fromJSDate(new Date(), true);
      vevent.updatePropertyWithValue("dtstamp", now);
      vevent.updatePropertyWithValue("created", now);

      // Timed events are stored in UTC; all-day events as DATE values with an
      // exclusive end date (eventData.end is the midnight after the last day)
      const allDay = !!eventData.allDay;
      setTimeProperty(vevent, "dtstart", toICALTime(eventData.start, allDay));
      setTimeProperty(vevent, "dtend", toICALTime(eventData.end, allDay));

      if (eventData.description) {
        event.description = eventData.description;
      }
      if (eventData.location) {
        event.location = eventData.location;
      }

      comp.addSubcomponent(vevent);

      const calendarData = comp.toString();
      let targetUrl = calendar ? calendar.url : calendarUrl;
      if (!targetUrl.endsWith("/")) targetUrl += "/";
      const eventUrl = `${targetUrl}${event.uid}.ics`;

      console.log("Creating event at:", eventUrl);

      const response = await this.makeRequest(
        "PUT",
        eventUrl,
        calendarData,
        {
          "Content-Type": "text/calendar; charset=utf-8",
          "If-None-Match": "*", // Ensures we don't overwrite existing events
        },
        username,
        password
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `Server returned status ${response.status}: ${response.statusText}`
        );
      }

      return { success: true, eventId: event.uid, eventUrl };
    } catch (error) {
      console.error("Create event error:", error);

      // Provide more user-friendly error messages
      let errorMessage = error.message || String(error);

      if (errorMessage.includes("url")) {
        errorMessage = "Invalid calendar URL. Please try logging in again.";
      } else if (errorMessage.includes("401") || errorMessage.includes("403")) {
        errorMessage =
          "Authentication failed. Please check your credentials and try logging in again.";
      } else if (errorMessage.includes("404")) {
        errorMessage = "Calendar not found. It may have been deleted.";
      } else if (
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage =
          "Cannot connect to server. Please check your internet connection.";
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * resolveEventUrl — The URL of an event's .ics resource. Uses the href the
   * server reported when fetching (other clients don't name files "<UID>.ics"),
   * falling back to "<calendar>/<UID>.ics" for events Kalendar created itself.
   */
  resolveEventUrl(calendarUrl, eventId, eventUrl) {
    if (eventUrl) return eventUrl;
    const base = calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`;
    return `${base}${eventId}.ics`;
  }

  /** GETs and parses an event resource. Returns { vcalendar, etag }. */
  async loadEventResource(username, password, eventUrl) {
    const response = await this.makeRequest(
      "GET",
      eventUrl,
      null,
      { Accept: "text/calendar" },
      username,
      password
    );
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Failed to fetch event: HTTP ${response.status} ${response.statusText}`
      );
    }
    if (!response.body || !response.body.includes("BEGIN:VCALENDAR")) {
      throw new Error("Invalid calendar data received from server");
    }
    const vcalendar = new ICAL.Component(ICAL.parse(response.body));
    registerTimezones(vcalendar);
    return { vcalendar, etag: response.headers.etag || null };
  }

  /**
   * saveEventResource — PUTs a modified resource back. The ETag from
   * loadEventResource guards against overwriting a change made elsewhere
   * in the meantime.
   */
  async saveEventResource(username, password, eventUrl, vcalendar, etag) {
    const headers = { "Content-Type": "text/calendar; charset=utf-8" };
    if (etag && !etag.startsWith("W/")) headers["If-Match"] = etag;
    const response = await this.makeRequest(
      "PUT",
      eventUrl,
      vcalendar.toString(),
      headers,
      username,
      password
    );
    if (response.status === 412) {
      throw new Error(
        "The event was changed on the server in the meantime. Please refresh and try again."
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `Server returned status ${response.status}: ${response.statusText}`
      );
    }
  }

  /**
   * deleteEvent — Removes an event from the server.
   * With options.recurrenceId, only that occurrence of a recurring event is
   * removed (by adding an EXDATE to the series); otherwise the whole .ics
   * resource is deleted.
   */
  async deleteEvent(username, password, calendarUrl, eventId, options = {}) {
    try {
      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }
      if (!calendarUrl && !options.eventUrl) {
        throw new Error("No calendar URL provided.");
      }
      if (!eventId && !options.eventUrl) {
        throw new Error("No event ID provided.");
      }

      const eventUrl = this.resolveEventUrl(calendarUrl, eventId, options.eventUrl);
      console.log("Deleting event:", eventUrl, options.recurrenceId != null ? `(occurrence ${options.recurrenceId})` : "");

      if (options.recurrenceId != null) {
        const { vcalendar, etag } = await this.loadEventResource(username, password, eventUrl);
        const { master, exceptions } = splitEvents(vcalendar);
        if (master && new ICAL.Event(master).isRecurring()) {
          // Drop any modified copy of this occurrence, then exclude it from the series
          exceptions
            .filter((ex) => recurrenceIdMs(ex) === options.recurrenceId)
            .forEach((ex) => vcalendar.removeSubcomponent(ex));
          const occurrence = findOccurrenceTime(new ICAL.Event(master), options.recurrenceId);
          if (occurrence) {
            const exdate = new ICAL.Property("exdate", master);
            writeTimeValue(exdate, occurrence);
            master.addProperty(exdate);
          }
          touchEvent(master);
          await this.saveEventResource(username, password, eventUrl, vcalendar, etag);
          return { success: true };
        }
      }

      const response = await this.makeRequest(
        "DELETE",
        eventUrl,
        null,
        {},
        username,
        password
      );

      // 404 means it's already gone, which is what the user wanted
      if ((response.status >= 200 && response.status < 300) || response.status === 404) {
        return { success: true };
      }
      return {
        success: false,
        error: `Server returned status ${response.status}`,
      };
    } catch (error) {
      console.error("Delete event error:", error);

      // Provide more user-friendly error messages
      let errorMessage = error.message || String(error);

      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        errorMessage = "Authentication failed. Please check your credentials.";
      } else if (
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage =
          "Cannot connect to server. Please check your internet connection.";
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * updateEvent — Modifies an existing event on the server.
   * Flow: GET the existing .ics → parse with ical.js → update fields → PUT back.
   * This preserves any server-side properties (alarms, attendees, etc.)
   * that Kalendar doesn't manage.
   *
   * For an occurrence of a recurring event (options.recurrenceId):
   *   - scope "occurrence" (default): only that occurrence changes; it is stored
   *     as an exception (a VEVENT with RECURRENCE-ID) inside the same resource
   *   - scope "series": the whole series changes; a time change is applied as the
   *     difference between options.originalStart and eventData.start
   */
  async updateEvent(username, password, calendarUrl, eventId, eventData, options = {}) {
    try {
      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }
      if ((!calendarUrl || !eventId) && !options.eventUrl) {
        throw new Error("Missing calendar URL or event ID.");
      }

      const eventUrl = this.resolveEventUrl(calendarUrl, eventId, options.eventUrl);
      console.log("Updating event:", eventUrl, options.scope || "", options.recurrenceId || "");

      const { vcalendar, etag } = await this.loadEventResource(username, password, eventUrl);
      const { vevents, master, exceptions } = splitEvents(vcalendar);
      if (vevents.length === 0) {
        throw new Error("No VEVENT found in calendar data");
      }

      const isOccurrence =
        options.recurrenceId != null && master && new ICAL.Event(master).isRecurring();

      if (isOccurrence && options.scope === "series") {
        updateSeries(master, exceptions, eventData, options.originalStart);
      } else if (isOccurrence) {
        let target = exceptions.find((ex) => recurrenceIdMs(ex) === options.recurrenceId);
        if (!target) {
          const occurrence = findOccurrenceTime(new ICAL.Event(master), options.recurrenceId);
          if (!occurrence) {
            throw new Error("This occurrence no longer exists on the server. Please refresh.");
          }
          target = createException(master, occurrence);
          vcalendar.addSubcomponent(target);
        }
        applyEventChanges(target, eventData);
      } else {
        applyEventChanges(master || vevents[0], eventData);
      }

      await this.saveEventResource(username, password, eventUrl, vcalendar, etag);
      return { success: true };
    } catch (error) {
      console.error("Update event error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * createCalendar — Creates a new calendar collection on the Nextcloud server.
   * Sends a MKCALENDAR request with display name, color, and component type.
   * The calendar ID is derived from the name + timestamp for uniqueness.
   */
  async createCalendar(
    username,
    password,
    serverUrl,
    calendarName,
    calendarColor,
    homeUrl
  ) {
    try {
      console.log("Creating calendar:", {
        calendarName,
        calendarColor,
      });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      if (!calendarName) {
        throw new Error("Calendar name is required.");
      }

      // Generate a unique calendar ID (URL-safe)
      const calendarId =
        calendarName.toLowerCase().replace(/[^a-z0-9]/g, "-") +
        "-" +
        Date.now();

      // Construct the calendar URL inside the user's calendar home (discovered at
      // login); fall back to Nextcloud's standard layout
      let calendarHome = homeUrl;
      if (!calendarHome) {
        const normalizedUrl = this.normalizeServerUrl(serverUrl);
        calendarHome = `${normalizedUrl}/calendars/${encodeURIComponent(username)}/`;
      }
      if (!calendarHome.endsWith("/")) calendarHome += "/";
      const calendarUrl = `${calendarHome}${calendarId}/`;

      console.log("Calendar URL:", calendarUrl);

      // Create the calendar using MKCALENDAR request
      const calendarData = `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${this.escapeXml(calendarName)}</D:displayname>
      <I:calendar-color>${this.escapeXml(calendarColor || "#5e72e4")}</I:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

      const response = await this.makeRequest(
        "MKCALENDAR",
        calendarUrl,
        calendarData,
        {
          "Content-Type": "application/xml; charset=utf-8",
        },
        username,
        password
      );

      console.log("MKCALENDAR response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar created successfully - HTTP", response.status);
        return { success: true, calendarUrl: calendarUrl };
      } else {
        console.warn("Unexpected response status:", response.status);
        return {
          success: false,
          error: `Server returned status ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error("Create calendar error:", error);

      let errorMessage = error.message || String(error);

      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        errorMessage = "Authentication failed. Please check your credentials.";
      } else if (errorMessage.includes("405")) {
        errorMessage = "Calendar creation not supported by this server.";
      } else if (
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage =
          "Cannot connect to server. Please check your internet connection.";
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * updateCalendarColor — Changes a calendar's color via PROPPATCH.
   * Uses the Apple iCal namespace (http://apple.com/ns/ical/) which
   * Nextcloud supports for calendar-color.
   */
  async updateCalendarColor(username, password, calendarUrl, color) {
    try {
      console.log("Updating calendar color:", { calendarUrl, color });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      // Update calendar color using PROPPATCH
      const propPatchData = `<?xml version="1.0" encoding="utf-8" ?>
<D:propertyupdate xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <I:calendar-color>${color}</I:calendar-color>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

      const response = await this.makeRequest(
        "PROPPATCH",
        calendarUrl,
        propPatchData,
        {
          "Content-Type": "application/xml; charset=utf-8",
        },
        username,
        password
      );

      console.log("PROPPATCH response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar color updated successfully");
        return { success: true };
      } else {
        console.warn("Unexpected response status:", response.status);
        return {
          success: false,
          error: `Server returned status ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error("Update calendar color error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * updateCalendarName — Renames a calendar via PROPPATCH on DAV:displayname.
   */
  async updateCalendarName(username, password, calendarUrl, displayName) {
    try {
      console.log("Updating calendar name:", { calendarUrl, displayName });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      if (!displayName || !displayName.trim()) {
        throw new Error("Calendar name cannot be empty.");
      }

      // Update calendar display name using PROPPATCH
      const propPatchData = `<?xml version="1.0" encoding="utf-8" ?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${this.escapeXml(displayName.trim())}</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

      const response = await this.makeRequest(
        "PROPPATCH",
        calendarUrl,
        propPatchData,
        {
          "Content-Type": "application/xml; charset=utf-8",
        },
        username,
        password
      );

      console.log("PROPPATCH response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar name updated successfully");
        return { success: true };
      } else {
        console.warn("Unexpected response status:", response.status);
        return {
          success: false,
          error: `Server returned status ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error("Update calendar name error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }
  /**
   * shareCalendar — Shares a calendar with another Nextcloud user.
   * Uses the ownCloud sharing namespace (http://owncloud.org/ns).
   * Note: Requires specific Nextcloud server configuration to work.
   * The shareWithEmail is converted to a principal URL.
   */
  async shareCalendar(
    username,
    password,
    calendarUrl,
    shareWithEmail,
    permission
  ) {
    try {
      console.log("Sharing calendar:", {
        calendarUrl,
        shareWithEmail,
        permission,
      });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      } // Extract the Nextcloud username from the email (or use as-is if it's already a username)
      // Nextcloud CalDAV sharing uses principal URLs, not email addresses
      const shareWithUser = shareWithEmail.includes("@")
        ? shareWithEmail.split("@")[0]
        : shareWithEmail;

      // Build the principal URL for the user we're sharing with
      const principalHref = `principal:principals/users/${shareWithUser}`;

      // Nextcloud uses the ownCloud sharing namespace (http://owncloud.org/ns)
      // NOT the CalendarServer namespace (http://calendarserver.org/ns/)
      const accessElement =
        permission === "write" ? `<o:read-write />` : `<o:read />`;

      const xmlBody = `<?xml version="1.0" encoding="utf-8" ?>
<o:share xmlns:d="DAV:" xmlns:o="http://owncloud.org/ns">
  <o:set>
    <d:href>${principalHref}</d:href>
    <o:summary>Shared calendar</o:summary>
    ${accessElement}
  </o:set>
</o:share>`;

      const response = await this.makeRequest(
        "POST",
        calendarUrl,
        xmlBody,
        {
          "Content-Type": "application/xml; charset=utf-8",
        },
        username,
        password
      );

      console.log("Share response:", {
        status: response.status,
        statusText: response.statusText,
        body: response.body ? response.body.substring(0, 500) : "",
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar shared successfully with:", shareWithEmail);
        return {
          success: true,
          share: {
            email: shareWithEmail,
            permission: permission,
            id: shareWithUser,
          },
        };
      } else {
        console.warn("Share response status:", response.status);
        let errorMessage = `Server returned status ${response.status}: ${response.statusText}`;

        // Try to parse error from XML response
        if (response.body) {
          const msgMatch = response.body.match(
            /<s:message>([^<]+)<\/s:message>/
          );
          if (msgMatch) {
            errorMessage = msgMatch[1];
          }
        }

        return {
          success: false,
          error: errorMessage,
        };
      }
    } catch (error) {
      console.error("Share calendar error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * getCalendarShares — Fetches the ACL (access control list) for a calendar.
   * Currently returns an empty shares array — full ACL parsing is TODO.
   */
  async getCalendarShares(username, password, calendarUrl) {
    try {
      console.log("Fetching calendar shares:", calendarUrl);

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      // Get ACL information
      const propfindData = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:acl/>
  </D:prop>
</D:propfind>`;

      const response = await this.makeRequest(
        "PROPFIND",
        calendarUrl,
        propfindData,
        {
          "Content-Type": "application/xml; charset=utf-8",
          Depth: "0",
        },
        username,
        password
      );

      if (response.status >= 200 && response.status < 300) {
        // Parse ACL from response
        // This is simplified - real implementation would parse XML response
        console.log("Calendar shares fetched");
        return { success: true, shares: [] };
      } else {
        return {
          success: false,
          error: `Server returned status ${response.status}`,
        };
      }
    } catch (error) {
      console.error("Get calendar shares error:", error);
      return {
        success: false,
        error: error.message || String(error),
        shares: [],
      };
    }
  }
  /**
   * removeCalendarShare — Revokes a previously shared calendar.
   * Sends a POST with the ownCloud un-share XML body.
   */
  async removeCalendarShare(username, password, calendarUrl, shareEmail) {
    try {
      console.log("Removing calendar share:", { calendarUrl, shareEmail });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      } // Extract the Nextcloud username from the email
      const shareWithUser = shareEmail.includes("@")
        ? shareEmail.split("@")[0]
        : shareEmail;

      const principalHref = `principal:principals/users/${shareWithUser}`;

      // Use the ownCloud sharing namespace to remove share
      const unshareXml = `<?xml version="1.0" encoding="utf-8" ?>
<o:share xmlns:d="DAV:" xmlns:o="http://owncloud.org/ns">
  <o:remove>
    <d:href>${principalHref}</d:href>
  </o:remove>
</o:share>`;

      const response = await this.makeRequest(
        "POST",
        calendarUrl,
        unshareXml,
        {
          "Content-Type": "application/xml; charset=utf-8",
        },
        username,
        password
      );

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar share removed successfully");
        return { success: true };
      } else {
        return {
          success: false,
          error: `Server returned status ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error("Remove calendar share error:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  /**
   * deleteCalendar — Permanently deletes a calendar collection from the Nextcloud server.
   * 
   * Sends a DELETE HTTP request to the calendar URL using CalDAV protocol.
   * Validates credentials and URL before attempting deletion.
   * Includes robust error handling for common failure scenarios:
   *   - 401/403: Authentication or permission issues
   *   - 404: Calendar no longer exists on server
   *   - 405: DELETE method not supported by server
   *   - Network errors: Connection issues
   * 
   * @param {string} username - CalDAV username for authentication
   * @param {string} password - CalDAV password for authentication
   * @param {string} calendarUrl - Full URL of the calendar collection to delete
   * @returns {Promise<{success: boolean, error?: string}>} Success status or error message
   */
  async deleteCalendar(username, password, calendarUrl) {
    try {
      console.log("Deleting calendar:", { calendarUrl });

      // Validate inputs
      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      if (!calendarUrl) {
        throw new Error("No calendar URL provided.");
      }

      console.log("Full calendar URL for deletion:", calendarUrl);

      // Use raw HTTP request to delete the calendar
      const response = await this.makeRequest(
        "DELETE",
        calendarUrl,
        null,
        {},
        username,
        password
      );

      console.log("DELETE calendar response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("Calendar deleted successfully - HTTP", response.status);
        return { success: true };
      } else {
        console.warn("Unexpected response status:", response.status);
        return {
          success: false,
          error: `Server returned status ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error("Delete calendar error:", error);

      let errorMessage = error.message || String(error);

      if (errorMessage.includes("401") || errorMessage.includes("403")) {
        errorMessage = "Authentication failed. Please check your credentials.";
      } else if (errorMessage.includes("404")) {
        errorMessage = "Calendar not found on server.";
      } else if (errorMessage.includes("405")) {
        errorMessage = "Calendar deletion not supported by this server.";
      } else if (
        errorMessage.includes("network") ||
        errorMessage.includes("ECONNREFUSED")
      ) {
        errorMessage =
          "Cannot connect to server. Please check your internet connection.";
      }

      return { success: false, error: errorMessage };
    }
  }

  /** Escapes special XML characters to prevent injection in PROPPATCH/MKCALENDAR bodies. */
  escapeXml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

// Export a singleton instance — shared across all IPC handlers
module.exports = new CalDAVService();
