// CalDAV Service - Handles all CalDAV operations
const dav = require("dav");
const ICAL = require("ical.js");
const https = require("https");
const http = require("http");
const { URL } = require("url");

class CalDAVService {
  constructor() {
    this.credentials = null;
    this.serverUrl = null;
  }

  // Helper method to make HTTP/HTTPS requests that works in Electron
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

  createXHR(username, password) {
    return new dav.transport.Basic(
      new dav.Credentials({
        username: username,
        password: password,
      })
    );
  }
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
                  const vevent = comp.getFirstSubcomponent("vevent");

                  if (vevent) {
                    const event = new ICAL.Event(vevent);
                    const parsedEvent = {
                      id: event.uid,
                      title: event.summary || "Untitled Event",
                      start: event.startDate.toJSDate(),
                      end: event.endDate.toJSDate(),
                      description: event.description || "",
                      location: event.location || "",
                    };
                    console.log("✅ Parsed event:", parsedEvent);
                    events.push(parsedEvent);
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
      event.endDate = ICAL.Time.fromJSDate(endDate, false);

      if (eventData.description) {
        event.description = eventData.description;
      }
      if (eventData.location) {
        event.location = eventData.location;
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

      return { success: true };
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
      }

      // Extract the Nextcloud username from the email (or use as-is if it's already a username)
      // Nextcloud CalDAV sharing uses principal URLs, not email addresses
      const shareWithUser = shareWithEmail.includes("@")
        ? shareWithEmail.split("@")[0]
        : shareWithEmail;

      // Extract server URL from the calendar URL
      const url = new URL(calendarUrl);
      const serverUrl = `${url.protocol}//${url.host}`;

      // Build the principal URL for the user we're sharing with
      const principalHref = `/remote.php/dav/principals/users/${shareWithUser}/`;

      // Nextcloud uses the CalDAV sharing protocol (cs:share-resource)
      // This POSTs an XML body to the calendar URL itself
      const readAccess = `<d:privilege><d:read /></d:privilege>`;
      const writeAccess = `<d:privilege><d:read /></d:privilege><d:privilege><d:write /></d:privilege>`;

      const shareXml = `<?xml version="1.0" encoding="utf-8" ?>
<cs:share xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <cs:set>
    <d:href>${principalHref}</d:href>
    <cs:common-name>${shareWithEmail}</cs:common-name>
    <cs:summary>Shared calendar</cs:summary>
    <cs:read-write />
  </cs:set>
</cs:share>`;

      // For read-only shares, use <cs:read /> instead of <cs:read-write />
      const shareXmlReadOnly = `<?xml version="1.0" encoding="utf-8" ?>
<cs:share xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <cs:set>
    <d:href>${principalHref}</d:href>
    <cs:common-name>${shareWithEmail}</cs:common-name>
    <cs:summary>Shared calendar</cs:summary>
    <cs:read />
  </cs:set>
</cs:share>`;

      const xmlBody = permission === "write" ? shareXml : shareXmlReadOnly;

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
          const msgMatch = response.body.match(/<s:message>([^<]+)<\/s:message>/);
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
  async removeCalendarShare(username, password, calendarUrl, shareEmail) {
    try {
      console.log("Removing calendar share:", { calendarUrl, shareEmail });

      if (!username || !password) {
        throw new Error("Missing credentials. Please log in again.");
      }

      // Extract the Nextcloud username from the email
      const shareWithUser = shareEmail.includes("@")
        ? shareEmail.split("@")[0]
        : shareEmail;

      const url = new URL(calendarUrl);
      const principalHref = `/remote.php/dav/principals/users/${shareWithUser}/`;

      // Use the CalDAV sharing protocol to remove (cs:remove)
      const unshareXml = `<?xml version="1.0" encoding="utf-8" ?>
<cs:share xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <cs:remove>
    <d:href>${principalHref}</d:href>
  </cs:remove>
</cs:share>`;

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

  escapeXml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

module.exports = new CalDAVService();
