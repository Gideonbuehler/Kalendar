// ============================================================================
// Main Application Component — KalendarApp
// ============================================================================
// Root React component that orchestrates the entire Kalendar application.
// Manages all top-level state including authentication, calendar data,
// events, tasks, UI modals, and user settings. Communicates with the
// Electron main process via IPC for CalDAV operations and persistence.
// ============================================================================

// Electron IPC bridge for communicating with the main process (CalDAV, settings)
const { ipcRenderer } = require("electron");
const { Component } = React;

// React Big Calendar — the core calendar rendering library
const { Calendar } = ReactBigCalendar;
const { momentLocalizer } = ReactBigCalendar;

// Optional drag-and-drop support (loaded from CDN, may not be present)
const { DragDropContext } = window.ReactDnD || {};
const { HTML5Backend } = window.ReactDnDHTML5Backend || {};

// Initialize the Moment.js-based localizer for react-big-calendar
const localizer = momentLocalizer(moment);

/**
 * Debounce helper — delays invoking `fn` until `wait` ms have elapsed
 * since the last invocation. Used to batch rapid settings saves.
 */
function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      try {
        fn(...args);
      } catch (e) {
        console.error("Debounced function error:", e);
      }
    }, wait);
  };
}

// Check if DnD is available
const withDragAndDrop = ReactBigCalendar.withDragAndDrop || ((comp) => comp);

/**
 * KalendarApp — The root component of the application.
 *
 * State is organized into the following sections:
 *   - Authentication: connection status, server URL, credentials
 *   - Calendar Data: calendars list, selected calendars, events cache
 *   - UI State: modal visibility flags, loading indicators, errors
 *   - Event Creation/Editing: form data for the event modal
 *   - Tasks: local task lists (future: synced via CalDAV VTODO)
 *   - Settings: theme, colors, font size, calendar preferences
 *
 * All server communication is done through Electron IPC → main.js → caldavService.
 * UI updates use an optimistic pattern: update state immediately, then sync to server.
 */
class KalendarApp extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // Authentication — tracks whether the user is connected to a CalDAV server
      isConnected: false,
      serverUrl: "",
      username: "",
      password: "", // Calendar Data
      calendars: [],
      calendarUrl: "",
      selectedCalendar: null, // Store the actual calendar object
      selectedCalendarIds: [], // Array of selected calendar URLs for multi-calendar view
      events: [],
      allCalendarEvents: {}, // Store events per calendar: { calendarUrl: [...events] }
      currentDate: new Date(), // Current date for calendar navigation

      // Drag state for moving events
      draggingEvent: null,
      isDragging: false, // UI State
      showLoginForm: true,
      showEventModal: false,
      showCreateCalendarModal: false,
      showCalendarSettingsModal: false,
      selectedCalendarForSettings: null,
      showSettings: false,
      isLoading: false,
      isCreatingEvent: false,
      errorMessage: "",

      // Context Menu
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        event: null,
      }, // Event Creation
      newEvent: {
        title: "",
        start: new Date(),
        end: new Date(),
        description: "",
        location: "",
        calendarUrl: "", // Will be set to first calendar by default
      }, // Editing Event
      editingEvent: null,
      isEditMode: false, // Tasks
      taskLists: [
        {
          id: "1",
          name: "Comp350",
          tasks: [
            {
              id: "t1",
              name: "homework1",
              completed: false,
              createdAt: new Date().toISOString(),
            },
            {
              id: "t2",
              name: "homework2",
              completed: true,
              createdAt: new Date().toISOString(),
            },
            {
              id: "t3",
              name: "project-draft",
              completed: false,
              createdAt: new Date().toISOString(),
            },
          ],
          createdAt: new Date().toISOString(),
        },
        {
          id: "2",
          name: "Shopping",
          tasks: [
            {
              id: "t4",
              name: "Buy groceries",
              completed: false,
              createdAt: new Date().toISOString(),
            },
            {
              id: "t5",
              name: "Pick up package",
              completed: false,
              createdAt: new Date().toISOString(),
            },
          ],
          createdAt: new Date().toISOString(),
        },
      ],
      showTaskManager: false,
      showTaskModal: false,
      editingTaskListId: null,      editingTask: null, // Settings
      settings: {
        theme: "light",
        primaryColor: "#5e72e4",
        accentColor: "#11cdef",
        fontSize: "medium",
        firstDayOfWeek: 0,
        timeFormat: "12h",
        defaultView: "month",
        showWeekNumbers: false,
        compactMode: false,
        animations: true,
        defaultTaskDuration: 15, // minutes
      },      // Creative features
      currentView: "month",
    };
    // Debounced settings saver to avoid frequent IPC + disk writes
    this._debouncedSaveSettings = debounce((s) => {
      try {
        ipcRenderer.invoke("save-settings", s);
      } catch (e) {
        console.error("Failed to invoke save-settings:", e);
      }
    }, 700);
  }
  /**
   * componentDidMount — App initialization sequence:
   * 1. Register global keyboard shortcut listeners
   * 2. Load persisted settings from disk (via main process)
   * 3. Apply theme/color/font settings to the DOM
   * 4. Auto-login if saved credentials exist
   */
  async componentDidMount() {
    // Global keyboard shortcuts (reserved for future use)
    this._handleKeyDown = (e) => {};
    document.addEventListener("keydown", this._handleKeyDown);

    // Load settings from main process (stored in userData/settings.json)
    const result = await ipcRenderer.invoke("get-settings");
    if (result.success) {
      this.setState({ settings: result.settings }, () => {
        this.applySettings();
      });

      // Check for saved credentials
      if (
        result.settings.serverUrl &&
        result.settings.username &&
        result.settings.password
      ) {
        console.log("Found saved credentials, auto-login...");
        this.setState(
          {
            serverUrl: result.settings.serverUrl,
            username: result.settings.username,
            password: result.settings.password, // Ideally this should be stored securely
          },
          () => {
            this.handleLoginSubmit({
              serverUrl: result.settings.serverUrl,
              username: result.settings.username,
              password: result.settings.password,
              rememberMe: true,
            });
          }
        );
      }
    }
  }

  /**
   * applySettings — Pushes current settings into the DOM.
   * Sets data-attributes and CSS custom properties on <html> so that
   * theme.css and main.css can react to the user's preferences.
   */
  applySettings() {
    const { settings } = this.state;
    const root = document.documentElement;

    // Apply theme (light / dark / auto-detect from OS)
    root.setAttribute(
      "data-theme",
      settings.theme === "auto" ? this.getSystemTheme() : settings.theme
    );

    // Apply custom colors
    root.style.setProperty("--primary-color", settings.primaryColor);
    root.style.setProperty("--accent-color", settings.accentColor);

    // Apply font size
    root.setAttribute("data-font-size", settings.fontSize);

    // Apply compact mode
    root.setAttribute("data-compact", settings.compactMode);

    // Apply animations
    root.setAttribute("data-animations", settings.animations);
  }

  getSystemTheme() {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  // Generic input handler — updates top-level state fields by input name
  handleInputChange = (e) => {
    const { name, value } = e.target;
    this.setState({ [name]: value });
  };

  // Event-specific input handler — updates fields within `newEvent` state object
  handleEventInputChange = (e) => {
    const { name, value } = e.target;
    this.setState((prevState) => ({
      newEvent: {
        ...prevState.newEvent,
        [name]: value,
      },
    }));
  };

  handleEventDateChange = (fieldName, date) => {
    this.setState((prevState) => ({
      newEvent: {
        ...prevState.newEvent,
        [fieldName]: date,
      },
    }));
  };

  /**
   * handleLoginSubmit — Authenticates with the CalDAV server.
   *
   * Flow:
   * 1. Send credentials to main process via "connect-caldav" IPC
   * 2. On success: save credentials (if rememberMe), store calendars in state
   * 3. Auto-select all event-capable calendars (VEVENT)
   * 4. Fetch events from all selected calendars
   * 5. On failure: display error message, keep login form visible
   */
  handleLoginSubmit = (credentials) => {
    const { serverUrl, username, password, rememberMe } = credentials;

    this.setState(
      {
        serverUrl,
        username,
        password,
        isLoading: true,
        errorMessage: "",
      },
      async () => {
        try {
          const result = await ipcRenderer.invoke("connect-caldav", {
            serverUrl: this.state.serverUrl,
            username: this.state.username,
            password: this.state.password,
          });

          if (result.success) {
            console.log(
              "Login successful, calendars received:",
              result.calendars
            );

            // Save credentials if rememberMe is true
            if (rememberMe) {
              const settings = {
                ...this.state.settings,
                serverUrl: this.state.serverUrl,
                username: this.state.username,
                password: this.state.password,
              };
              await ipcRenderer.invoke("save-settings", settings);
            }

            // Set calendars first
            this.setState({
              isConnected: true,
              calendars: result.calendars,
              isLoading: false,
              errorMessage: "",
            });
            if (result.calendars && result.calendars.length > 0) {
              // Find the first calendar that supports VEVENT (events), not just VTODO (tasks)
              const eventsCalendar = result.calendars.find(
                (cal) => cal.components && cal.components.includes("VEVENT")
              );

              const firstCalendar = eventsCalendar || result.calendars[0];
              const calUrl = firstCalendar.url || firstCalendar.href;

              console.log("Selected calendar:", {
                displayName: firstCalendar.displayName,
                url: calUrl,
                components: firstCalendar.components,
                isEventsCalendar:
                  firstCalendar.components &&
                  firstCalendar.components.includes("VEVENT"),
                isTasksOnly:
                  firstCalendar.components &&
                  firstCalendar.components.includes("VTODO") &&
                  !firstCalendar.components.includes("VEVENT"),
              });

              if (
                firstCalendar.components &&
                firstCalendar.components.includes("VTODO") &&
                !firstCalendar.components.includes("VEVENT")
              ) {
                console.warn(
                  "⚠️ WARNING: Selected calendar only supports tasks (VTODO), not events (VEVENT)!"
                );
              } // Get all event calendars (not just tasks)
              const eventCalendars = result.calendars.filter(
                (cal) => cal.components && cal.components.includes("VEVENT")
              );

              // Initialize with all event calendars selected
              const selectedCalendarIds = eventCalendars.map((cal) => cal.url);

              // Set calendar URL and the full calendar object, then wait for state to update
              this.setState(
                {
                  calendarUrl: calUrl,
                  selectedCalendar: firstCalendar,
                  selectedCalendarIds: selectedCalendarIds,
                  showLoginForm: false,
                },
                () => {
                  // This callback runs after state is updated
                  console.log(
                    "State updated, calendar URL is now:",
                    this.state.calendarUrl
                  );
                  // Fetch events from all selected calendars
                  this.fetchAllCalendarEvents();
                }
              );
            } else {
              this.setState({
                errorMessage: "No calendars found in your account",
                isLoading: false,
                showLoginForm: false,
              });
            }
          } else {
            // Connection failed - show error but keep the form visible
            this.setState({
              errorMessage:
                result.error ||
                "Connection failed. Please check your credentials and try again.",
              isLoading: false,
            });
          }
        } catch (error) {
          console.error("Login error:", error);
          this.setState({
            errorMessage: "An unexpected error occurred. Please try again.",
            isLoading: false,
          });
        }
      }
    );
  };

  handleLogin = async (e) => {
    if (e) e.preventDefault();
    this.handleLoginSubmit({
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      rememberMe: true, // Default to true based on user request
    });
  };

  /**
   * fetchEvents — Fetches events from a single calendar.
   * Used when switching the active calendar. For multi-calendar fetching,
   * see fetchAllCalendarEvents() below.
   */
  fetchEvents = async (calendarUrl) => {
    console.log(
      "fetchEvents called with calendarUrl:",
      calendarUrl || this.state.calendarUrl
    );
    console.log("Using calendar object:", this.state.selectedCalendar);

    // Show loading state
    this.setState({ isLoading: true });

    const result = await ipcRenderer.invoke("fetch-events", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendar: this.state.selectedCalendar, // Pass the full calendar object
      calendarUrl: calendarUrl || this.state.calendarUrl,
    });

    console.log("fetchEvents result:", result);

    if (result.success) {
      console.log("Setting events in state:", result.events);
      this.setState(
        {
          events: result.events,
          isLoading: false,
        },
        () => {
          console.log("State updated, current events:", this.state.events);
        }
      );
    } else {
      console.error("Failed to fetch events:", result.error);
      this.setState({ isLoading: false });
      alert("Failed to fetch events: " + result.error);
    }
  };

  /**
   * fetchAllCalendarEvents — Fetches events from ALL selected calendars.
   *
   * Iterates over selectedCalendarIds, fetches each calendar's events via IPC,
   * tags each event with its calendarUrl and calendarName (for color-coding),
   * caches them in allCalendarEvents, and merges into a flat events array.
   * Preserves any local-only or pending-sync events not yet confirmed by server.
   */
  fetchAllCalendarEvents = async () => {
    console.log("Fetching events from all selected calendars");
    this.setState({ isLoading: true });

    const allCalendarEvents = {};
    const allEvents = [];

    // Fetch events from each selected calendar in sequence
    for (const calendarUrl of this.state.selectedCalendarIds) {
      const calendar = this.state.calendars.find(
        (cal) => cal.url === calendarUrl
      );

      if (!calendar) continue;

      const result = await ipcRenderer.invoke("fetch-events", {
        serverUrl: this.state.serverUrl,
        username: this.state.username,
        password: this.state.password,
        calendar: calendar,
        calendarUrl: calendarUrl,
      });

      if (result.success) {
        // Tag events with their calendar info
        const taggedEvents = result.events.map((event) => ({
          ...event,
          calendarUrl: calendarUrl,
          calendarName: calendar.displayName,
        }));

        allCalendarEvents[calendarUrl] = taggedEvents;
        allEvents.push(...taggedEvents);
      }
    }
    console.log("All calendar events fetched:", allEvents.length);
    this.setState((prevState) => {
      // Preserve any local-only or pending-sync events that haven't been confirmed from the server yet
      const preservedEvents = prevState.events.filter(
        (evt) => evt.localOnly || evt.tempId || evt.pendingSync
      );
      return {
        allCalendarEvents: allCalendarEvents,
        events: [...allEvents, ...preservedEvents],
        isLoading: false,
      };
    });
  };
  /**
   * handleCalendarToggle — Toggles a calendar's visibility in the multi-calendar view.
   *
   * Deselecting: immediately filters out that calendar's events from display.
   * Selecting: uses cached events for instant display, or fetches from server if uncached.
   */
  handleCalendarToggle = async (calendarUrl) => {
    const { selectedCalendarIds, allCalendarEvents } = this.state;
    let newSelectedIds;

    if (selectedCalendarIds.includes(calendarUrl)) {
      // Deselect - immediately filter out events from this calendar
      newSelectedIds = selectedCalendarIds.filter((id) => id !== calendarUrl);
      const allEvents = this.state.events.filter(
        (event) => event.calendarUrl !== calendarUrl
      );
      this.setState({
        selectedCalendarIds: newSelectedIds,
        events: allEvents,
      });
    } else {
      // Select - immediately add cached events if available
      newSelectedIds = [...selectedCalendarIds, calendarUrl];

      // Check if we have cached events for this calendar
      if (allCalendarEvents[calendarUrl]) {
        // Use cached events for instant display
        const cachedEvents = allCalendarEvents[calendarUrl];
        const allEvents = [...this.state.events, ...cachedEvents];
        this.setState({
          selectedCalendarIds: newSelectedIds,
          events: allEvents,
        });
      } else {
        // No cache, need to fetch
        this.setState({ selectedCalendarIds: newSelectedIds, isLoading: true });

        const calendar = this.state.calendars.find(
          (cal) => cal.url === calendarUrl
        );

        if (calendar) {
          const result = await ipcRenderer.invoke("fetch-events", {
            serverUrl: this.state.serverUrl,
            username: this.state.username,
            password: this.state.password,
            calendar: calendar,
            calendarUrl: calendarUrl,
          });

          if (result.success) {
            // Tag events with their calendar info
            const taggedEvents = result.events.map((event) => ({
              ...event,
              calendarUrl: calendarUrl,
              calendarName: calendar.displayName,
            }));

            // Update cache
            const updatedCache = {
              ...this.state.allCalendarEvents,
              [calendarUrl]: taggedEvents,
            };

            // Add new events to existing events
            const allEvents = [...this.state.events, ...taggedEvents];

            this.setState({
              allCalendarEvents: updatedCache,
              events: allEvents,
              isLoading: false,
            });
          } else {
            this.setState({ isLoading: false });
          }
        }
      }
    }
  };
  // Opens the event creation modal when the user clicks/drags a time slot
  handleSelectSlot = ({ start, end }) => {
    // Get the first available event calendar as default
    const eventCalendars = this.state.calendars.filter(
      (cal) => !cal.components || cal.components.includes("VEVENT")
    );
    const defaultCalendar =
      this.state.selectedCalendar?.url ||
      (eventCalendars.length > 0 ? eventCalendars[0].url : "");

    this.setState({
      showEventModal: true,
      newEvent: {
        title: "",
        start: start,
        end: end,
        description: "",
        location: "",
        calendarUrl: defaultCalendar,
      },
    });
  };
  /**
   * handleCreateEvent — Creates a new event on the CalDAV server.
   *
   * Uses optimistic UI pattern:
   * 1. Adds a temporary event to state immediately (instant visual feedback)
   * 2. Sends create-event IPC to main process in background
   * 3. On success: refreshes from server to get canonical event data
   * 4. On failure: removes the temporary event and shows an error
   */
  handleCreateEvent = async (e) => {
    e.preventDefault();
    console.log("Creating event, current state:", {
      calendarUrl: this.state.newEvent.calendarUrl,
      hasSelectedCalendar: !!this.state.selectedCalendar,
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      hasPassword: !!this.state.password,
    }); // Validate that we have a calendar
    const targetCalendarUrl =
      this.state.newEvent.calendarUrl || this.state.calendarUrl;
    if (!targetCalendarUrl) {
      alert("No calendar selected. Please select a calendar.");
      console.error("Missing calendar in event data");
      return;
    }

    // Find the calendar object that matches the selected URL
    const targetCalendar = this.state.calendars.find(
      (cal) => cal.url === targetCalendarUrl
    );
    if (!targetCalendar) {
      alert("Selected calendar not found. Please refresh and try again.");
      console.error("Calendar not found for URL:", targetCalendarUrl);
      return;
    }
    console.log("Creating event in calendar:", {
      name: targetCalendar.displayName,
      url: targetCalendarUrl,
    });

    // Create temporary event for optimistic UI update
    const tempEvent = {
      ...this.state.newEvent,
      id: `temp-${Date.now()}`,
      calendarUrl: targetCalendarUrl,
      calendarName: targetCalendar.displayName,
      _isOptimistic: true,
    };

    // Add to UI immediately
    this.setState((prevState) => {
      const newEvents = [...prevState.events, tempEvent];
      const newAllCalendarEvents = { ...prevState.allCalendarEvents };
      if (newAllCalendarEvents[targetCalendarUrl]) {
        newAllCalendarEvents[targetCalendarUrl] = [
          ...newAllCalendarEvents[targetCalendarUrl],
          tempEvent,
        ];
      } else {
        newAllCalendarEvents[targetCalendarUrl] = [tempEvent];
      }

      return {
        events: newEvents,
        allCalendarEvents: newAllCalendarEvents,
        isCreatingEvent: true,
        showEventModal: false,
        newEvent: {
          title: "",
          start: new Date(),
          end: new Date(),
          description: "",
          location: "",
          calendarUrl: "",
        },
      };
    });

    // Then create on server
    const result = await ipcRenderer.invoke("create-event", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendar: targetCalendar,
      calendarUrl: targetCalendarUrl,
      eventData: this.state.newEvent,
    });

    this.setState({ isCreatingEvent: false });

    if (result.success) {
      console.log("✅ Event created successfully!");

      // Replace temporary event with real one from server
      setTimeout(() => {
        this.fetchAllCalendarEvents();
      }, 500);
    } else {
      console.error("❌ Event creation failed:", result.error);
      alert("Failed to create event: " + result.error);

      // Remove temporary event on failure
      this.setState((prevState) => ({
        events: prevState.events.filter((e) => e.id !== tempEvent.id),
        allCalendarEvents: {
          ...prevState.allCalendarEvents,
          [targetCalendarUrl]:
            prevState.allCalendarEvents[targetCalendarUrl]?.filter(
              (e) => e.id !== tempEvent.id
            ) || [],
        },
      }));
    }
  };
  // Shows context menu on event click; Alt+Click = quick delete shortcut
  handleContextMenu = (event, jsEvent) => {
    // Alt + Click = Quick delete
    if (jsEvent.altKey) {
      jsEvent.preventDefault();
      if (confirm(`Delete "${event.title}"?`)) {
        this.handleDeleteEvent(event);
      }
      return;
    }

    // Regular right-click = Context menu
    jsEvent.preventDefault();
    this.setState({
      contextMenu: {
        visible: true,
        x: jsEvent.clientX,
        y: jsEvent.clientY,
        event: event,
      },
    });
  };
  // Handles drag-and-drop event rescheduling (optimistic update + server sync)
  handleEventDrop = async ({ event, start, end }) => {
    console.log("Event dropped:", event.title, "to", start);

    // Update the event in state immediately for smooth UX (optimistic update)
    const updatedEvents = this.state.events.map((ev) =>
      ev.id === event.id ? { ...ev, start: new Date(start), end: new Date(end) } : ev
    );
    this.setState({ events: updatedEvents });

    const calendarUrl = event.calendarUrl || this.state.calendarUrl;

    try {
      const result = await ipcRenderer.invoke("update-event", {
        username: this.state.username,
        password: this.state.password,
        calendarUrl: calendarUrl,
        eventId: event.id,
        eventData: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
      });

      if (result.success) {
        console.log("✅ Event moved successfully!");
      } else {
        console.error("❌ Failed to move event:", result.error);
        // Revert optimistic update on failure
        this.fetchAllCalendarEvents();
      }
    } catch (error) {
      console.error("Error moving event:", error);
      this.fetchAllCalendarEvents();
    }
  };
  // Handles event resize in week/day view (optimistic update + server sync)
  handleEventResize = async ({ event, start, end }) => {
    console.log("Event resized:", event.title, "from", event.start, "to", start, end);

    // Update the event in state immediately for smooth UX (optimistic update)
    const updatedEvents = this.state.events.map((ev) =>
      ev.id === event.id ? { ...ev, start: new Date(start), end: new Date(end) } : ev
    );
    this.setState({ events: updatedEvents });

    const calendarUrl = event.calendarUrl || this.state.calendarUrl;

    try {
      const result = await ipcRenderer.invoke("update-event", {
        username: this.state.username,
        password: this.state.password,
        calendarUrl: calendarUrl,
        eventId: event.id,
        eventData: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
      });

      if (result.success) {
        console.log("✅ Event resized successfully!");
      } else {
        console.error("❌ Failed to resize event:", result.error);
        this.fetchAllCalendarEvents();
      }
    } catch (error) {
      console.error("Error resizing event:", error);
      this.fetchAllCalendarEvents();
    }
  };

  handleCloseContextMenu = () => {
    this.setState({
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        event: null,
      },
    });
  };

  // Opens the event modal in edit mode, pre-filling fields from the existing event
  handleEditEvent = (event) => {
    this.setState({
      isEditMode: true,
      editingEvent: event,
      newEvent: {
        title: event.title,
        start: event.start,
        end: event.end,
        description: event.description || "",
        location: event.location || "",
      },
      showEventModal: true,
    });
  };
  /**
   * handleUpdateEvent — Saves changes to an existing event.
   * Applies optimistic update to UI, then syncs to server.
   * Reverts to server state on failure.
   */
  handleUpdateEvent = async () => {
    const { editingEvent, newEvent } = this.state;
    if (!editingEvent) return;

    console.log("Updating event:", editingEvent.id, "with:", newEvent);

    const calendarUrl = editingEvent.calendarUrl || this.state.calendarUrl;

    // Optimistic update — apply changes to UI immediately
    const updatedStart = new Date(newEvent.start);
    const updatedEnd = new Date(newEvent.end);
    this.setState((prevState) => ({
      events: prevState.events.map((ev) =>
        ev.id === editingEvent.id
          ? {
              ...ev,
              title: newEvent.title,
              start: updatedStart,
              end: updatedEnd,
              description: newEvent.description,
              location: newEvent.location,
            }
          : ev
      ),
      showEventModal: false,
      isEditMode: false,
      editingEvent: null,
      newEvent: {
        title: "",
        start: new Date(),
        end: new Date(),
        description: "",
        location: "",
      },
    }));

    try {
      const result = await ipcRenderer.invoke("update-event", {
        username: this.state.username,
        password: this.state.password,
        calendarUrl: calendarUrl,
        eventId: editingEvent.id,
        eventData: {
          title: newEvent.title,
          start: updatedStart.toISOString(),
          end: updatedEnd.toISOString(),
          description: newEvent.description || "",
          location: newEvent.location || "",
        },
      });

      if (result.success) {
        console.log("✅ Event updated successfully!");
      } else {
        console.error("❌ Failed to update event:", result.error);
        alert("Failed to update event: " + result.error);
        this.fetchAllCalendarEvents();
      }
    } catch (error) {
      console.error("Error updating event:", error);
      alert("Error updating event: " + error.message);
      this.fetchAllCalendarEvents();
    }
  };
  // Deletes an event — removes from UI immediately, then deletes on server
  handleDeleteEvent = async (event) => {
    console.log("Deleting event:", event);

    // Optimistic update - remove from UI immediately
    const eventCalendarUrl = event.calendarUrl || this.state.calendarUrl;

    this.setState((prevState) => {
      const newEvents = prevState.events.filter((e) => e.id !== event.id);
      const newAllCalendarEvents = { ...prevState.allCalendarEvents };
      if (newAllCalendarEvents[eventCalendarUrl]) {
        newAllCalendarEvents[eventCalendarUrl] = newAllCalendarEvents[
          eventCalendarUrl
        ].filter((e) => e.id !== event.id);
      }

      return {
        events: newEvents,
        allCalendarEvents: newAllCalendarEvents,
      };
    });

    // Then delete from server
    const result = await ipcRenderer.invoke("delete-event", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendarUrl: eventCalendarUrl, // Use the event's calendar, not the primary one
      eventId: event.id,
    });

    if (result.success) {
      console.log("✅ Event deleted successfully!");
    } else {
      console.error("❌ Event deletion failed:", result.error);
      alert("Failed to delete event: " + result.error);
      // Revert optimistic update on failure
      this.fetchAllCalendarEvents();
    }
  };

  handleAddCalendar = () => {
    this.setState({ showCreateCalendarModal: true });
  };
  /**
   * handleCreateCalendar — Creates a new calendar on the Nextcloud server.
   * Adds an optimistic placeholder immediately, then issues MKCALENDAR on server.
   * On success: reconnects to fetch the real calendar object from the server.
   * On failure: removes the placeholder and alerts the user.
   */
  handleCreateCalendar = async (calendarName, calendarColor) => {
    console.log("Creating calendar:", calendarName, calendarColor);

    // Optimistic update - add calendar to UI immediately
    const tempCalendar = {
      url: `${this.state.serverUrl}/calendars/${
        this.state.username
      }/${calendarName.toLowerCase().replace(/\s+/g, "-")}/`,
      displayName: calendarName,
      name: calendarName.toLowerCase().replace(/\s+/g, "-"),
      components: ["VEVENT"],
      color: calendarColor,
      _isOptimistic: true, // Flag to track temporary calendar
    };

    // Add to calendars list immediately
    this.setState((prevState) => ({
      calendars: [...prevState.calendars, tempCalendar],
      selectedCalendarIds: [...prevState.selectedCalendarIds, tempCalendar.url],
      allCalendarEvents: {
        ...prevState.allCalendarEvents,
        [tempCalendar.url]: [],
      },
      showCreateCalendarModal: false,
    }));

    // Now actually create on server in background
    const result = await ipcRenderer.invoke("create-calendar", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendarName: calendarName,
      calendarColor: calendarColor,
    });

    if (result.success) {
      console.log("✅ Calendar created successfully on server!");

      // Replace optimistic calendar with real one from server
      setTimeout(async () => {
        const reconnectResult = await ipcRenderer.invoke("connect-caldav", {
          serverUrl: this.state.serverUrl,
          username: this.state.username,
          password: this.state.password,
        });

        if (reconnectResult.success) {
          // Find the real calendar that was just created
          const realCalendar = reconnectResult.calendars.find(
            (cal) => cal.displayName === calendarName
          );

          if (realCalendar) {
            this.setState((prevState) => ({
              calendars: prevState.calendars.map((cal) =>
                cal._isOptimistic && cal.displayName === calendarName
                  ? realCalendar
                  : cal
              ),
            }));
          }
        }
      }, 500);
    } else {
      console.error("❌ Calendar creation failed:", result.error);

      // Remove optimistic calendar on failure
      this.setState((prevState) => ({
        calendars: prevState.calendars.filter(
          (cal) => !(cal._isOptimistic && cal.displayName === calendarName)
        ),
        selectedCalendarIds: prevState.selectedCalendarIds.filter(
          (url) => url !== tempCalendar.url
        ),
      }));

      alert("Failed to create calendar: " + result.error);
    }
  };

  handleCalendarSettings = (calendar) => {
    console.log("Opening settings for calendar:", calendar.displayName);
    this.setState({
      showCalendarSettingsModal: true,
      selectedCalendarForSettings: calendar,
    });
  };

  handleUpdateCalendarColor = async (calendarUrl, color) => {
    console.log("Updating calendar color:", { calendarUrl, color });

    // Optimistic update
    this.setState((prevState) => ({
      calendars: prevState.calendars.map((cal) =>
        cal.url === calendarUrl ? { ...cal, color: color } : cal
      ),
      showCalendarSettingsModal: false,
    }));

    // Update on server
    const result = await ipcRenderer.invoke("update-calendar-color", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      color: color,
    });

    if (result.success) {
      console.log("✅ Calendar color updated successfully!");
      // Refresh events to show new colors
      this.fetchAllCalendarEvents();
    } else {
      console.error("❌ Calendar color update failed:", result.error);
      alert("Failed to update calendar color: " + result.error);
      // Revert on failure
      setTimeout(() => {
        this.fetchAllCalendarEvents();
      }, 500);
    }
  };

  handleUpdateCalendarName = async (calendarUrl, newName) => {
    console.log("Updating calendar name:", { calendarUrl, newName });

    if (!newName || !newName.trim()) {
      alert("Calendar name cannot be empty");
      return;
    }

    // Optimistic update
    this.setState((prevState) => ({
      calendars: prevState.calendars.map((cal) =>
        cal.url === calendarUrl ? { ...cal, displayName: newName.trim() } : cal
      ),
      showCalendarSettingsModal: false,
    }));

    // Update on server
    const result = await ipcRenderer.invoke("update-calendar-name", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      displayName: newName.trim(),
    });

    if (result.success) {
      console.log("✅ Calendar name updated successfully!");
      // Refresh calendars to confirm update
      this.fetchAllCalendarEvents();
    } else {
      console.error("❌ Calendar name update failed:", result.error);
      alert("Failed to update calendar name: " + result.error);
      // Revert on failure
      setTimeout(() => {
        this.fetchAllCalendarEvents();
      }, 500);
    }
  };

  handleAddCalendarShare = async (calendarUrl, shareEmail, permission) => {
    console.log("Adding calendar share:", {
      calendarUrl,
      shareEmail,
      permission,
    });

    const result = await ipcRenderer.invoke("share-calendar", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      shareWithEmail: shareEmail,
      permission: permission,
    });

    if (result.success) {
      console.log("✅ Calendar shared successfully!");
      alert(`Calendar shared with ${shareEmail}!`);

      // Update calendar shares in state
      if (result.share) {
        this.setState((prevState) => ({
          calendars: prevState.calendars.map((cal) =>
            cal.url === calendarUrl
              ? { ...cal, shares: [...(cal.shares || []), result.share] }
              : cal
          ),
          selectedCalendarForSettings: {
            ...prevState.selectedCalendarForSettings,
            shares: [
              ...(prevState.selectedCalendarForSettings?.shares || []),
              result.share,
            ],
          },
        }));
      }
    } else {
      console.error("❌ Calendar share failed:", result.error);
      alert("Failed to share calendar: " + result.error);
    }
  };

  handleRemoveCalendarShare = async (calendarUrl, shareId) => {
    console.log("Removing calendar share:", { calendarUrl, shareId });

    const result = await ipcRenderer.invoke("remove-calendar-share", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      shareEmail: shareId,
    });

    if (result.success) {
      console.log("✅ Calendar share removed successfully!");

      // Update calendar shares in state
      this.setState((prevState) => ({
        calendars: prevState.calendars.map((cal) =>
          cal.url === calendarUrl
            ? {
                ...cal,
                shares: (cal.shares || []).filter(
                  (s) => s.id !== shareId && s.email !== shareId
                ),
              }
            : cal
        ),
        selectedCalendarForSettings: {
          ...prevState.selectedCalendarForSettings,
          shares: (prevState.selectedCalendarForSettings?.shares || []).filter(
            (s) => s.id !== shareId && s.email !== shareId
          ),
        },
      }));
    } else {
      console.error("❌ Calendar share removal failed:", result.error);
      alert("Failed to remove calendar share: " + result.error);
    }
  };

  handleLogout = () => {
    // Clear credentials from settings
    const { settings } = this.state;
    const newSettings = {
      ...settings,
      serverUrl: "",
      username: "",
      password: "",
    };

    // Save cleared settings
    ipcRenderer.invoke("save-settings", newSettings);

    // Also clear from state
    this.setState({
      isConnected: false,
      calendars: [],
      calendarUrl: "",
      events: [],
      showLoginForm: true,
      username: "",
      password: "",
      // Keep serverUrl pre-filled for convenience
    });
  };

  // ============================================
  // Task Management Handlers
  // ============================================

  // Creates a new task list locally (TODO: sync via CalDAV VTODO)
  handleCreateList = (listName) => {
    const newList = {
      id: Date.now().toString(),
      name: listName,
      tasks: [],
      createdAt: new Date().toISOString(),
    };

    // Optimistic update
    this.setState((prevState) => ({
      taskLists: [...prevState.taskLists, newList],
    }));

    // TODO: Sync to CalDAV server using VTODO
    console.log("✓ Task list created:", newList);
  };

  // Creates a new task within a list (TODO: sync via CalDAV VTODO)
  handleCreateTask = (listId, taskName) => {
    const newTask = {
      id: Date.now().toString(),
      name: taskName,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    // Optimistic update
    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((list) =>
        list.id === listId ? { ...list, tasks: [...list.tasks, newTask] } : list
      ),
    }));

    // TODO: Sync to CalDAV server using VTODO
    console.log("✓ Task created:", newTask, "in list:", listId);
  };
  // Toggles task completion — also updates any matching calendar events
  handleToggleTask = (listId, taskId) => {
    // Find the task to determine the new completed state
    const list = this.state.taskLists.find((l) => l.id === listId);
    const task = list?.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const newCompleted = !task.completed;

    // Optimistic update for task list
    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((list) =>
        list.id === listId
          ? {
              ...list,
              tasks: list.tasks.map((t) =>
                t.id === taskId
                  ? { ...t, completed: newCompleted }
                  : t
              ),
            }
          : list
      ),
    }));

    // Also mark any matching calendar events as completed/uncompleted
    // Match by title (task name) and description containing the list name
    const taskName = task.name;
    this.setState((prevState) => ({
      events: prevState.events.map((ev) => {
        const isMatch =
          ev.title === taskName ||
          (ev.description && ev.description.includes(`Task from list:`));
        if (isMatch && ev.title === taskName) {
          return { ...ev, completed: newCompleted };
        }
        return ev;
      }),
    }));

    console.log("✓ Task toggled:", taskId, "in list:", listId, "→", newCompleted ? "completed" : "active");
  };

  handleDeleteTask = (listId, taskId) => {
    // Optimistic update
    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((list) =>
        list.id === listId
          ? { ...list, tasks: list.tasks.filter((task) => task.id !== taskId) }
          : list
      ),
    }));

    // TODO: Sync to CalDAV server using VTODO
    console.log("✓ Task deleted:", taskId, "from list:", listId);
  };

  handleDeleteList = (listId) => {
    // Optimistic update
    this.setState((prevState) => ({
      taskLists: prevState.taskLists.filter((list) => list.id !== listId),
    }));

    // TODO: Sync to CalDAV server using VTODO
    console.log("✓ Task list deleted:", listId);
  };
  handleToggleTaskManager = () => {
    this.setState((prevState) => ({
      showTaskManager: !prevState.showTaskManager,
    }));
  };
  // Opens the event modal pre-filled with task data, allowing the user to schedule it
  handleTaskToCalendar = (task, listName) => {
    // Open event modal with task details pre-filled
    const now = new Date();
    const startTime = new Date(now);
    startTime.setHours(9, 0, 0, 0); // Default to 9 AM
    const endTime = new Date(startTime);
    endTime.setHours(10, 0, 0, 0); // Default to 1 hour duration

    const targetCalUrl =
          this.state.selectedCalendarIds[0] || this.state.calendarUrl;
    const targetCal = this.state.calendars.find(
      (cal) => cal.url === targetCalUrl
    );

    this.setState({
      showEventModal: true,
      isEditMode: false,
      newEvent: {
        title: task.name,
        start: startTime,
        end: endTime,
        description: `Task from list: ${listName}`,
        location: "",
        calendarUrl: targetCalUrl,
        calendarName: targetCal?.displayName || "",
      },
    });
  };
  /**
   * handleTaskDroppedOnCalendar — Handles native drag-drop of a task onto the calendar.
   * Creates an event at the drop time with the task's name and configured duration.
   * Uses optimistic UI + background server sync via createEventFromTask().
   */
  handleTaskDroppedOnCalendar = (dragData, slotInfo) => {
    console.log("Task dropped on calendar:", dragData, slotInfo);

    // Validate dragData
    if (!dragData || !dragData.task || !dragData.task.name) {
      console.error("Invalid drag data:", dragData);
      alert("Error: Invalid task data");
      return;
    }

    // Get the default task duration from settings (default 15 minutes)
    const taskDuration = this.state.settings?.defaultTaskDuration || 15;

    // Use the slot time if available, otherwise use current time
    const startTime = slotInfo?.start || new Date();
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + taskDuration);

    // Get the calendar to add to
    const targetCalendarUrl =
      this.state.selectedCalendarIds[0] || this.state.calendarUrl;

    if (!targetCalendarUrl) {
      console.error("No calendar URL available");
      alert("Error: No calendar selected. Please select a calendar first.");
      return;
    }

    // Find the calendar name for the target
    const targetCalendar = this.state.calendars.find(
      (cal) => cal.url === targetCalendarUrl
    );

    // Create new event object
    const newEvent = {
      title: dragData.task.name,
      start: startTime,
      end: endTime,
      description: `Task from list: ${dragData.listName || "Unknown"}`,
      location: "",
      calendarUrl: targetCalendarUrl,
      calendarName: targetCalendar?.displayName || "",
    };

    console.log("Creating event from task:", newEvent);

    // Add the event immediately to the calendar (optimistic update)
    const tempId = `temp-${Date.now()}`;
    const displayEvent = {
      ...newEvent,
      id: tempId,
      tempId: tempId,
    };

    // Optimistically add to state
    this.setState((prevState) => ({
      events: [...prevState.events, displayEvent],
    }));

    // Create on server
    this.createEventFromTask(newEvent, tempId);
  };
  // Server-side creation of an event from a dropped task (with retry/preserve on failure)
  createEventFromTask = async (eventData, tempId) => {
    try {
      // Validate eventData
      if (!eventData || !eventData.title) {
        throw new Error("Invalid event data: missing title");
      }

      console.log("Creating event with data:", eventData);

      const result = await ipcRenderer.invoke("create-event", {
        username: this.state.username,
        password: this.state.password,
        calendarUrl: eventData.calendarUrl,
        eventData: {
          title: eventData.title,
          description: eventData.description || "",
          location: eventData.location || "",
          start: eventData.start.toISOString(),
          end: eventData.end.toISOString(),
        },
      });
      if (result.success) {
        console.log("✅ Event created from task successfully!");

        const eventId = result.eventId || tempId;

        // Replace the temp event with a permanent one immediately
        // Mark as pendingSync so fetchAllCalendarEvents preserves it until the server catches up
        this.setState((prevState) => ({
          events: prevState.events.map((evt) =>
            evt.tempId === tempId
              ? {
                  ...evt,
                  id: eventId,
                  tempId: undefined, // No longer temporary
                  pendingSync: true, // Keep through fetches until server returns it
                }
              : evt
          ),
        }));

        // Refresh events from server to get the canonical event data
        // Wait for the server to process the new event before fetching
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // When fetching, merge server events with any remaining local-only events
        try {
          await this.fetchAllCalendarEvents();
          // Only clear pendingSync if the server actually returned the event
          this.setState((prevState) => {
            const serverHasEvent = prevState.events.some(
              (evt) => !evt.pendingSync && evt.id === eventId
            );
            if (serverHasEvent) {
              // Server returned it — remove the pendingSync duplicate
              return {
                events: prevState.events.filter(
                  (evt) => !(evt.pendingSync && evt.id === eventId)
                ),
              };
            }
            // Server hasn't returned it yet — keep the pendingSync event
            console.log(
              "Server hasn't returned the new event yet, keeping local copy"
            );
            return {};
          });
        } catch (fetchErr) {
          console.warn(
            "Failed to refresh events after task drop, local event preserved:",
            fetchErr
          );
        }

        console.log("✅ Task added to calendar!");
      } else {
        console.error("❌ Failed to create event from task:", result.error);

        // Keep the event visible even if server sync fails
        // Just remove the tempId so it becomes a "real" event
        this.setState((prevState) => ({
          events: prevState.events.map((evt) =>
            evt.tempId === tempId
              ? {
                  ...evt,
                  id: tempId, // Use tempId as permanent ID
                  tempId: undefined,
                }
              : evt
          ),
        }));

        console.warn(
          "⚠️ Event saved locally but may not be synced to server:",
          result.error
        );
      }
    } catch (error) {
      console.error("Error creating event from task:", error);

      // Keep the event visible even on error
      // Just mark it as local-only
      this.setState((prevState) => ({
        events: prevState.events.map((evt) =>
          evt.tempId === tempId
            ? {
                ...evt,
                id: tempId, // Use tempId as permanent ID
                tempId: undefined,
                localOnly: true, // Mark as not synced
              }
            : evt
        ),
      }));

      console.warn(
        "⚠️ Event saved locally only (server error):",
        error.message
      );
    }
  };

  handleAddTaskList = () => {
    const listName = prompt("Enter task list name:");
    if (listName && listName.trim()) {
      this.handleCreateList(listName.trim());
    }
  };

  handleTaskClick = (listId, taskId) => {
    // Open task modal for editing
    const list = this.state.taskLists.find((l) => l.id === listId);
    const task = list?.tasks.find((t) => t.id === taskId);

    if (task && list) {
      this.setState({
        showTaskModal: true,
        editingTaskListId: listId,
        editingTask: task,
      });
    }
  };

  handleTaskModalSubmit = (taskData) => {
    const { editingTaskListId, editingTask } = this.state;

    if (editingTask) {
      // Update existing task
      this.setState((prevState) => ({
        taskLists: prevState.taskLists.map((list) =>
          list.id === editingTaskListId
            ? {
                ...list,
                tasks: list.tasks.map((task) =>
                  task.id === editingTask.id ? { ...task, ...taskData } : task
                ),
              }
            : list
        ),
        showTaskModal: false,
        editingTaskListId: null,
        editingTask: null,
      }));
    }
  };

  handleTaskModalAddToCalendar = (eventData) => {
    // Add task as calendar event
    this.setState({
      showTaskModal: false,
      showEventModal: true,
      isEditMode: false,
      newEvent: {
        ...eventData,
        calendarUrl:
          this.state.selectedCalendarIds[0] || this.state.calendarUrl,
      },
    });
  };
  // ============================================
  // End Task Management Handlers
  // ============================================
  // ============================================
  // Creative Feature Handlers
  // ============================================

  handleChangeView = (view) => {
    this.setState({ currentView: view });
  };

  handleDateNavigate = (date) => {
    this.setState({ currentDate: date });
  };

  // Updates a single setting, applies it to the DOM, and persists (debounced)
  handleSettingChange = (key, value) => {
    const newSettings = { ...this.state.settings, [key]: value };
    this.setState({ settings: newSettings }, () => {
      this.applySettings();
      // Debounce saving to avoid frequent synchronous work in main process
      this._debouncedSaveSettings(newSettings);
    });
  };

  // Resets all settings to factory defaults and persists immediately
  handleResetSettings = () => {
    const defaults = {
      theme: "light",
      primaryColor: "#5e72e4",
      accentColor: "#11cdef",
      fontSize: "medium",
      firstDayOfWeek: 0,
      timeFormat: "12h",
      defaultView: "month",
      showWeekNumbers: false,
      compactMode: false,
      animations: true,
      defaultTaskDuration: 15,
    };
    this.setState({ settings: defaults }, () => {
      this.applySettings();
      ipcRenderer.invoke("save-settings", defaults);
    });
  };

  // ============================================
  // End Creative Feature Handlers
  // ============================================

  /**
   * formatDateTimeLocal — Converts a Date object to "YYYY-MM-DDTHH:MM" string
   * for use as the value of <input type="datetime-local">.
   * Returns empty string for invalid dates to prevent NaN in inputs.
   */
  formatDateTimeLocal = (date) => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  /**
   * render — Renders either the login form or the full app layout.
   * The app layout consists of:
   *   - CalendarView (sidebar + calendar grid)
   *   - ContextMenu (right-click event actions)
   *   - EventModal (create/edit events)
   *   - Settings, CreateCalendarModal, CalendarSettingsModal
   *   - TaskModal (edit task details)
   */
  render() {
    if (this.state.showLoginForm) {
      return h(LoginForm, {
        serverUrl: this.state.serverUrl,
        username: this.state.username,
        password: this.state.password,
        onInputChange: this.handleInputChange,
        onSubmit: this.handleLogin,
        isLoading: this.state.isLoading,
        errorMessage: this.state.errorMessage,
      });
    }    // The root div is now the CalendarView itself, no extra div needed
    return h(
      "div",
      { className: "kalendar-app-wrapper" },
      h(CalendarView, {
        localizer: localizer,
        events: this.state.events,
        calendars: this.state.calendars,
        calendarUrl: this.state.calendarUrl,
        selectedCalendarIds: this.state.selectedCalendarIds,
        settings: this.state.settings,
        currentDate: this.state.currentDate,
        isLoading: this.state.isLoading,
        taskLists: this.state.taskLists,
        showTaskManager: this.state.showTaskManager,
        currentView: this.state.currentView,
        onSelectSlot: this.handleSelectSlot,
        onSelectEvent: this.handleContextMenu,
        onEventDrop: this.handleEventDrop,
        onEventResize: this.handleEventResize,
        onCalendarToggle: this.handleCalendarToggle,
        onAddCalendar: () => this.setState({ showCreateCalendarModal: true }),
        onCalendarSettings: this.handleCalendarSettings,
        onCalendarChange: (url) => {
          this.setState({ calendarUrl: url });
          this.fetchEvents(url);
        },
        onDateNavigate: this.handleDateNavigate,
        onRefresh: () => this.fetchAllCalendarEvents(),
        onSettingsClick: () => this.setState({ showSettings: true }),
        onLogout: this.handleLogout,
        onToggleTaskManager: this.handleToggleTaskManager,
        onAddTaskList: this.handleAddTaskList,
        onToggleTask: this.handleToggleTask,
        onTaskToCalendar: this.handleTaskToCalendar,
        onTaskClick: this.handleTaskClick,        onTaskDroppedOnCalendar: this.handleTaskDroppedOnCalendar,
        onViewChange: this.handleChangeView,
      }),

      // Task Manager removed - now integrated in sidebar

      h(ContextMenu, {
        visible: this.state.contextMenu.visible,
        x: this.state.contextMenu.x,
        y: this.state.contextMenu.y,
        event: this.state.contextMenu.event,
        onEdit: this.handleEditEvent,
        onDelete: this.handleDeleteEvent,
        onClose: this.handleCloseContextMenu,
      }),
      this.state.showEventModal &&
        h(EventModal, {
          newEvent: this.state.newEvent,
          isEditMode: this.state.isEditMode,
          calendars: this.state.calendars,
          selectedCalendarIds: this.state.selectedCalendarIds,
          onCalendarChange: (e) => {
            this.setState({
              newEvent: {
                ...this.state.newEvent,
                calendarUrl: e.target.value,
              },
            });
          },
          onSubmit: this.state.isEditMode
            ? this.handleUpdateEvent
            : this.handleCreateEvent,
          onInputChange: this.handleEventInputChange, // <-- Pass the new handler here
          onDateChange: this.handleEventDateChange,
          onClose: () =>
            this.setState({
              showEventModal: false,
              isEditMode: false,
              editingEvent: null,
              newEvent: {
                title: "",
                start: new Date(),
                end: new Date(),
                description: "",
                location: "",
                calendarUrl: "",
              },
            }),
          formatDateTimeLocal: this.formatDateTimeLocal,
          isLoading: this.state.isCreatingEvent,
        }),
      this.state.showSettings &&
        h(Settings, {
          settings: this.state.settings,
          onSettingChange: this.handleSettingChange,
          onClose: () => this.setState({ showSettings: false }),
          onReset: this.handleResetSettings,
        }),

      this.state.showCreateCalendarModal &&
        h(CreateCalendarModal, {
          onSubmit: this.handleCreateCalendar,
          onClose: () => this.setState({ showCreateCalendarModal: false }),
        }),
      this.state.showCalendarSettingsModal &&
        h(CalendarSettingsModal, {
          calendar: this.state.selectedCalendarForSettings,
          onUpdateColor: this.handleUpdateCalendarColor,
          onUpdateName: this.handleUpdateCalendarName,
          onAddShare: this.handleAddCalendarShare,
          onRemoveShare: this.handleRemoveCalendarShare,
          onClose: () =>
            this.setState({
              showCalendarSettingsModal: false,
              selectedCalendarForSettings: null,
            }),
        }),

      this.state.showTaskModal &&
        h(TaskModal, {
          task: this.state.editingTask,
          listName:
            this.state.taskLists.find(
              (l) => l.id === this.state.editingTaskListId
            )?.name || "",
          isEdit: !!this.state.editingTask,
          onSubmit: this.handleTaskModalSubmit,
          onAddToCalendar: this.handleTaskModalAddToCalendar,
          onClose: () =>
            this.setState({
              showTaskModal: false,
              editingTaskListId: null,
              editingTask: null,            }),        })
    );
  }
}

// Bootstrap — Mount the KalendarApp component into the DOM (React 17 API)
ReactDOM.render(h(KalendarApp), document.getElementById("app"));
