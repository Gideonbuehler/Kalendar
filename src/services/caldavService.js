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
const { URL } = require("url");

/**
 * CalDAVService — Singleton service for all server-side calendar operations.
 * Maintains a reference to the last-used credentials for convenience,
 * but each IPC call receives credentials explicitly for safety.
 */
class CalDAVService {
  constructor() {
    this.credentials = null; // Cached credentials from last successful connect()
    this.serverUrl = null; // Cached server URL
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

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: method,
        headers: {
          Authorization: `Basic ${auth}`,
          ...headers,
        },
        rejectUnauthorized: false, // Allow self-signed certificates
      };

      console.log(`📡 Making ${method} request to:`, parsedUrl.pathname);

      const req = client.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          console.log(
            `✅ Response status: ${res.statusCode} ${res.statusMessage}`
          );
          console.log(`📦 Response length: ${responseData.length} bytes`);

          resolve({
            status: res.statusCode,
            statusText: res.statusMessage,
            body: responseData,
            headers: res.headers,
          });
        });
      });

      req.on("error", (error) => {
        console.error(`❌ Request error:`, error);
        reject(error);
      });

      if (data) {
        req.write(data);
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

      console.log("Connected successfully, calendars:", account.calendars);

      // Log detailed information about all calendars
      if (account.calendars && account.calendars.length > 0) {
        account.calendars.forEach((cal, index) => {
          console.log(`Calendar ${index}:`, {
            displayName: cal.displayName,
            url: cal.url,
            components: cal.components,
            isTasksCalendar: cal.components && cal.components.includes("VTODO"),
            isEventsCalendar:
              cal.components && cal.components.includes("VEVENT"),
          });
        });
      }

      return { success: true, calendars: account.calendars };
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
      console.log("📥 Fetching events from:", targetUrl);

      // Check if this is a tasks calendar
      if (calendar && calendar.components) {
        console.log("Calendar components:", calendar.components);
        if (
          calendar.components.includes("VTODO") &&
          !calendar.components.includes("VEVENT")
        ) {
          console.warn(
            "⚠️ WARNING: This is a tasks calendar (VTODO), not an events calendar (VEVENT)!"
          );
          console.warn(
            "No events will be found. Please select a calendar that supports events."
          );
          return { success: true, events: [] };
        }
      }

      const xhr = this.createXHR(username, password);

      // Simplified approach: Use dav.request to get calendar objects directly
      console.log("Using REPORT query to fetch VEVENT components...");
      const events = [];

      try {
        // Use raw HTTP request instead of dav.request.basic
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

        console.log("✅ REPORT response:", {
          status: response.status,
          statusText: response.statusText,
          bodyLength: response.body ? response.body.length : 0,
        });

        // Log the raw response for debugging
        if (response.body && response.body.length > 0) {
          console.log(
            "📄 Raw XML response (first 1000 chars):",
            response.body.substring(0, 1000)
          );
        } else if (response.xhr && response.xhr.responseText) {
          console.log("📄 Using XHR responseText instead...");
          response.body = response.xhr.responseText;
        } else {
          console.log("⚠️ Empty response body from server");
        } // Simple regex parsing instead of DOMParser (works in Node.js)
        if (response && response.body) {
          // Match calendar-data with any namespace prefix (C:, cal:, etc.)
          const calendarDataMatches = response.body.match(
            /<[^:]+:calendar-data[^>]*>([\s\S]*?)<\/[^:]+:calendar-data>/gi
          );

          console.log(
            `Found ${
              calendarDataMatches ? calendarDataMatches.length : 0
            } calendar-data elements`
          );

          if (calendarDataMatches) {
            for (const match of calendarDataMatches) {
              try {
                // Extract the actual calendar data (remove tags with any namespace)
                const calendarData = match
                  .replace(/<[^:]+:calendar-data[^>]*>/i, "")
                  .replace(/<\/[^:]+:calendar-data>/i, "")
                  .trim();

                if (
                  calendarData &&
                  calendarData.startsWith("BEGIN:VCALENDAR")
                ) {
                  console.log("📄 Processing calendar data...");

                  const jcalData = ICAL.parse(calendarData);
                  const comp = new ICAL.Component(jcalData);
                  const vevent = comp.getFirstSubcomponent("vevent");                  if (vevent) {
                    const event = new ICAL.Event(vevent);

                    // Parse recurrence rule if present
                    let recurrence = { enabled: false, days: [], endDate: "" };
                    const rruleProp = vevent.getFirstProperty("rrule");
                    if (rruleProp) {
                      const rrule = rruleProp.getFirstValue();
                      if (rrule && rrule.freq === "WEEKLY" && rrule.parts && rrule.parts.BYDAY) {
                        recurrence.enabled = true;
                        recurrence.days = rrule.parts.BYDAY.map(String);
                        if (rrule.until) {
                          const untilDate = rrule.until.toJSDate();
                          recurrence.endDate = untilDate.toISOString().split("T")[0];
                        }
                      }
                    }

                    const parsedEvent = {
                      id: event.uid,
                      title: event.summary || "Untitled Event",
                      start: event.startDate.toJSDate(),
                      end: event.endDate.toJSDate(),
                      description: event.description || "",
                      location: event.location || "",
                      recurrence: recurrence,
                    };
                    console.log("✅ Parsed event:", parsedEvent);
                    events.push(parsedEvent);

                    // Expand recurring events into individual occurrences
                    if (recurrence.enabled && rruleProp) {
                      try {
                        const expand = new ICAL.RecurExpansion({
                          component: vevent,
                          dtstart: event.startDate,
                        });

                        const duration = event.endDate.toJSDate().getTime() - event.startDate.toJSDate().getTime();
                        // Expand up to 1 year from now, max 365 occurrences
                        const expandLimit = new Date();
                        expandLimit.setFullYear(expandLimit.getFullYear() + 1);
                        let count = 0;
                        const maxOccurrences = 365;

                        // Skip the first occurrence (already added above)
                        expand.next();

                        while (count < maxOccurrences) {
                          const nextDate = expand.next();
                          if (!nextDate) break;
                          const occurrenceStart = nextDate.toJSDate();
                          if (occurrenceStart > expandLimit) break;

                          events.push({
                            id: event.uid + "-" + occurrenceStart.toISOString(),
                            title: event.summary || "Untitled Event",
                            start: occurrenceStart,
                            end: new Date(occurrenceStart.getTime() + duration),
                            description: event.description || "",
                            location: event.location || "",
                            recurrence: recurrence,
                            isRecurrenceInstance: true,
                            masterEventId: event.uid,
                          });
                          count++;
                        }
                        console.log(`🔁 Expanded ${count} recurring occurrences for "${event.summary}"`);
                      } catch (expandError) {
                        console.error("❌ Error expanding recurrence:", expandError);
                      }
                    }
                  }
                }
              } catch (parseError) {
                console.error("❌ Error parsing individual event:", parseError);
              }
            }
          }
        }
      } catch (queryError) {
        console.error("❌ Calendar query failed:", queryError);
        throw queryError;
      }

      console.log(`🎉 Successfully fetched ${events.length} events`);
      return { success: true, events };
    } catch (error) {
      console.error("❌ Fetch events error:", error);
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

      const xhr = this.createXHR(username, password);

      const comp = new ICAL.Component(["vcalendar", [], []]);
      comp.updatePropertyWithValue("prodid", "-//Kalendar//EN");
      comp.updatePropertyWithValue("version", "2.0");

      const vevent = new ICAL.Component("vevent");
      const event = new ICAL.Event(vevent);

      event.summary = eventData.title;

      // Create dates - use local time zone instead of UTC
      const startDate = new Date(eventData.start);
      const endDate = new Date(eventData.end);

      console.log("Converting dates:", {
        originalStart: eventData.start,
        originalEnd: eventData.end,
        jsDateStart: startDate,
        jsDateEnd: endDate,
      });

      // Use false for timezone to create floating time (local time)
      event.startDate = ICAL.Time.fromJSDate(startDate, false);
      event.endDate = ICAL.Time.fromJSDate(endDate, false);      if (eventData.description) {
        event.description = eventData.description;
      }
      if (eventData.location) {
        event.location = eventData.location;
      }

      // Add recurrence rule if enabled
      if (
        eventData.recurrence &&
        eventData.recurrence.enabled &&
        eventData.recurrence.days &&
        eventData.recurrence.days.length > 0
      ) {
        let rruleValue = "FREQ=WEEKLY;BYDAY=" + eventData.recurrence.days.join(",");
        if (eventData.recurrence.endDate) {
          // Convert end date to RRULE UNTIL format (YYYYMMDD)
          const untilDate = eventData.recurrence.endDate.replace(/-/g, "") + "T235959Z";
          rruleValue += ";UNTIL=" + untilDate;
        }
        vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(rruleValue));
        console.log("Added RRULE:", rruleValue);
      }

      event.uid = `${Date.now()}@kalendar-app`;
      comp.addSubcomponent(vevent);

      const calendarData = comp.toString();

      console.log("=== EVENT CREATION DEBUG ===");
      console.log("Event UID:", event.uid);
      console.log("Event Title:", eventData.title);
      console.log("Event Start:", eventData.start);
      console.log("Event End:", eventData.end);
      console.log("Calendar URL:", calendar ? calendar.url : calendarUrl);
      console.log("Full iCalendar data:");
      console.log(calendarData);
      console.log("=== END DEBUG ==="); // Use dav.request for more control over the HTTP request
      const targetUrl = calendar ? calendar.url : calendarUrl;
      const eventUrl = `${targetUrl}${event.uid}.ics`;

      console.log("Full event URL:", eventUrl);

      // Use raw HTTP request instead of dav.request.basic
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

      console.log("✅ PUT response:", {
        status: response.status,
        statusText: response.statusText,
      });
      if (response.status >= 200 && response.status < 300) {
        console.log("🎉 Event creation confirmed - HTTP", response.status);
      } else {
        console.warn("⚠️ Unexpected response status:", response.status);
      }

      return { success: true, eventId: event.uid };
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
   * deleteEvent — Removes an event from the server by sending HTTP DELETE
   * to the event's .ics URL (calendarUrl + eventId + ".ics").
   */
  async deleteEvent(username, password, calendarUrl, eventId) {
    try {
      console.log("Deleting event:", {
        calendarUrl,
        eventId,
      });

      // Validate inputs
      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      if (!calendarUrl) {
        throw new Error("No calendar URL provided.");
      }

      if (!eventId) {
        throw new Error("No event ID provided.");
      }

      // Construct the event URL
      const eventUrl = `${calendarUrl}${eventId}.ics`;
      console.log("Full event URL for deletion:", eventUrl);

      // Use raw HTTP request to delete the event
      const response = await this.makeRequest(
        "DELETE",
        eventUrl,
        null,
        {},
        username,
        password
      );

      console.log("✅ DELETE response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("🎉 Event deleted successfully - HTTP", response.status);
        return { success: true };
      } else {
        console.warn("⚠️ Unexpected response status:", response.status);
        return {
          success: false,
          error: `Server returned status ${response.status}`,
        };
      }
    } catch (error) {
      console.error("Delete event error:", error);

      // Provide more user-friendly error messages
      let errorMessage = error.message || String(error);

      if (errorMessage.includes("404")) {
        errorMessage = "Event not found. It may have already been deleted.";
      } else if (errorMessage.includes("401") || errorMessage.includes("403")) {
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
   */
  async updateEvent(username, password, calendarUrl, eventId, eventData) {
    try {
      console.log("Updating event:", { calendarUrl, eventId, eventData });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }
      if (!calendarUrl || !eventId) {
        throw new Error("Missing calendar URL or event ID.");
      }

      // Step 1: Fetch the existing event to get its full iCalendar data
      const eventUrl = `${calendarUrl}${eventId}.ics`;
      console.log("Fetching existing event from:", eventUrl);

      const getResponse = await this.makeRequest(
        "GET",
        eventUrl,
        null,
        { Accept: "text/calendar" },
        username,
        password
      );

      if (getResponse.status < 200 || getResponse.status >= 300) {
        throw new Error(
          `Failed to fetch event: HTTP ${getResponse.status} ${getResponse.statusText}`
        );
      }

      // Step 2: Parse the existing iCalendar data
      let calendarData = getResponse.body;
      if (!calendarData || !calendarData.includes("BEGIN:VCALENDAR")) {
        throw new Error("Invalid calendar data received from server");
      }

      const jcalData = ICAL.parse(calendarData);
      const comp = new ICAL.Component(jcalData);
      const vevent = comp.getFirstSubcomponent("vevent");

      if (!vevent) {
        throw new Error("No VEVENT found in calendar data");
      }

      const event = new ICAL.Event(vevent);

      // Step 3: Update the event properties
      if (eventData.start) {
        event.startDate = ICAL.Time.fromJSDate(
          new Date(eventData.start),
          false
        );
      }
      if (eventData.end) {
        event.endDate = ICAL.Time.fromJSDate(new Date(eventData.end), false);
      }
      if (eventData.title !== undefined) {
        event.summary = eventData.title;
      }      if (eventData.description !== undefined) {
        event.description = eventData.description;
      }
      if (eventData.location !== undefined) {
        event.location = eventData.location;
      }

      // Update recurrence rule
      if (eventData.recurrence !== undefined) {
        // Remove existing RRULE if present
        vevent.removeAllProperties("rrule");

        if (
          eventData.recurrence &&
          eventData.recurrence.enabled &&
          eventData.recurrence.days &&
          eventData.recurrence.days.length > 0
        ) {
          let rruleValue = "FREQ=WEEKLY;BYDAY=" + eventData.recurrence.days.join(",");
          if (eventData.recurrence.endDate) {
            const untilDate = eventData.recurrence.endDate.replace(/-/g, "") + "T235959Z";
            rruleValue += ";UNTIL=" + untilDate;
          }
          vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(rruleValue));
          console.log("Updated RRULE:", rruleValue);
        } else {
          console.log("Removed RRULE (recurrence disabled)");
        }
      }

      const updatedCalendarData = comp.toString();

      console.log("=== EVENT UPDATE DEBUG ===");
      console.log("Event UID:", event.uid);
      console.log("New Start:", eventData.start);
      console.log("New End:", eventData.end);
      console.log("=== END DEBUG ===");

      // Step 4: PUT the updated event back (overwrite existing)
      const putResponse = await this.makeRequest(
        "PUT",
        eventUrl,
        updatedCalendarData,
        {
          "Content-Type": "text/calendar; charset=utf-8",
        },
        username,
        password
      );

      console.log("✅ PUT response:", {
        status: putResponse.status,
        statusText: putResponse.statusText,
      });

      if (putResponse.status >= 200 && putResponse.status < 300) {
        console.log("🎉 Event updated successfully - HTTP", putResponse.status);
        return { success: true };
      } else {
        return {
          success: false,
          error: `Server returned status ${putResponse.status}: ${putResponse.statusText}`,
        };
      }
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
    calendarColor
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

      // Construct the calendar URL
      const normalizedUrl = this.normalizeServerUrl(serverUrl);
      const calendarUrl = `${normalizedUrl}/calendars/${username}/${calendarId}/`;

      console.log("Calendar URL:", calendarUrl);

      // Create the calendar using MKCALENDAR request
      const calendarData = `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${this.escapeXml(calendarName)}</D:displayname>
      <I:calendar-color>${calendarColor}</I:calendar-color>
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

      console.log("✅ MKCALENDAR response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("🎉 Calendar created successfully - HTTP", response.status);
        return { success: true, calendarUrl: calendarUrl };
      } else {
        console.warn("⚠️ Unexpected response status:", response.status);
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

      console.log("✅ PROPPATCH response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("🎨 Calendar color updated successfully");
        return { success: true };
      } else {
        console.warn("⚠️ Unexpected response status:", response.status);
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

      console.log("✅ PROPPATCH response:", {
        status: response.status,
        statusText: response.statusText,
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("📝 Calendar name updated successfully");
        return { success: true };
      } else {
        console.warn("⚠️ Unexpected response status:", response.status);
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

      console.log("✅ Share response:", {
        status: response.status,
        statusText: response.statusText,
        body: response.body ? response.body.substring(0, 500) : "",
      });

      if (response.status >= 200 && response.status < 300) {
        console.log("👥 Calendar shared successfully with:", shareWithEmail);
        return {
          success: true,
          share: {
            email: shareWithEmail,
            permission: permission,
            id: shareWithUser,
          },
        };
      } else {
        console.warn("⚠️ Share response status:", response.status);
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
        console.log("📋 Calendar shares fetched");
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
        console.log("🗑️ Calendar share removed successfully");
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
