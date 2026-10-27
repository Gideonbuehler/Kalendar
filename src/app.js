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
const { momentLocalizer } = ReactBigCalendar;

// Initialize the Moment.js-based localizer for react-big-calendar
const localizer = momentLocalizer(moment);

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_REFRESH_MS = 5 * 60 * 1000; // Background sync interval
const FOCUS_REFRESH_GAP_MS = 60 * 1000; // Min. time between syncs on window focus
const NOTICE_TIMEOUT_MS = 6000;
const TASKS_STORAGE_KEY = "kalendar.taskLists";

// Factory defaults for user preferences (credentials are stored separately)
const DEFAULT_SETTINGS = {
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
  hiddenCalendars: [], // URLs of calendars unchecked in the sidebar
};

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

/** Example task lists shown on first launch, before the user has saved any. */
function defaultTaskLists() {
  const now = new Date().toISOString();
  return [
    {
      id: "1",
      name: "Comp350",
      tasks: [
        { id: "t1", name: "homework1", completed: false, createdAt: now },
        { id: "t2", name: "homework2", completed: true, createdAt: now },
        { id: "t3", name: "project-draft", completed: false, createdAt: now },
      ],
      createdAt: now,
    },
    {
      id: "2",
      name: "Shopping",
      tasks: [
        { id: "t4", name: "Buy groceries", completed: false, createdAt: now },
        { id: "t5", name: "Pick up package", completed: false, createdAt: now },
      ],
      createdAt: now,
    },
  ];
}

/** Task lists are kept in localStorage so they survive restarts. */
function loadTaskLists() {
  try {
    const saved = JSON.parse(localStorage.getItem(TASKS_STORAGE_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (e) {
    console.error("Failed to load task lists:", e);
  }
  return defaultTaskLists();
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isMidnight(date) {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

/** Turns low-level network errors into a message people can act on. */
function friendlyError(message) {
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENETUNREACH|timed out/i.test(message || "")) {
    return "Can't reach the server. Check your internet connection and try again.";
  }
  return message || "unknown error";
}

/** Marks events scheduled from a task (see handleTaskDroppedOnCalendar). */
function isTaskEvent(event) {
  return !!(event.description && event.description.includes("Task from list:"));
}

/**
 * applyWeekStart — Makes Moment (and therefore react-big-calendar and the
 * week numbers) start weeks on Sunday (0) or Monday (1, ISO week numbering).
 */
function applyWeekStart(firstDayOfWeek) {
  const dow = firstDayOfWeek === 1 ? 1 : 0;
  moment.updateLocale("en", { week: { dow, doy: dow === 1 ? 4 : 6 } });
}

/**
 * KalendarApp — The root component of the application.
 *
 * State is organized into the following sections:
 *   - Authentication: connection status, server URL, credentials
 *   - Calendar Data: calendars list, selected calendars, events per calendar
 *   - UI State: modal visibility flags, loading indicators, notices
 *   - Event Creation/Editing: form data for the event modal
 *   - Tasks: local task lists (persisted in localStorage)
 *   - Settings: theme, colors, font size, calendar preferences
 *
 * Events live in one place, `allCalendarEvents` (keyed by calendar URL); the
 * events shown are derived from it and the checked calendars. All server
 * communication is done through Electron IPC → main.js → caldavService.
 * UI updates are optimistic: state changes immediately, then the calendar is
 * reloaded from the server, which confirms the change or reverts it.
 */
class KalendarApp extends Component {
  constructor(props) {
    super(props);
    this.state = {
      // Authentication — tracks whether the user is connected to a CalDAV server
      isConnected: false,
      serverUrl: "",
      username: "",
      password: "",
      homeUrl: null, // Calendar home collection (where new calendars are created)

      // Calendar Data
      calendars: [],
      selectedCalendarIds: [], // URLs of calendars checked in the sidebar
      allCalendarEvents: {}, // { calendarUrl: [...events] } incl. optimistic changes
      currentDate: new Date(), // Current date for calendar navigation

      // UI State
      showLoginForm: true,
      showEventModal: false,
      showCreateCalendarModal: false,
      showCalendarSettingsModal: false,
      selectedCalendarForSettings: null,
      showSettings: false,
      isLoading: false,
      errorMessage: "",
      notice: null, // { id, text, type } — transient message at the bottom

      // Context Menu (event details popover)
      contextMenu: {
        visible: false,
        x: 0,
        y: 0,
        event: null,
      },

      // Event Creation / Editing
      newEvent: {
        title: "",
        start: new Date(),
        end: new Date(),
        allDay: false,
        description: "",
        location: "",
        calendarUrl: "",
      },
      editingEvent: null,
      isEditMode: false,

      // Tasks
      taskLists: loadTaskLists(),
      showTaskManager: false,
      showTaskModal: false,
      editingTaskListId: null,
      editingTask: null,

      // Settings
      settings: { ...DEFAULT_SETTINGS },
      currentView: "month",
    };

    this._calendarVersions = {}; // Per-calendar change counters (see _bumpCalendar)
    this._pendingChanges = 0; // Server changes in flight (auto-refresh waits for them)
    this._lastRefresh = 0;
    this._lastUsedCalendarUrl = null;

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
   * 1. Register global keyboard shortcuts and background sync
   * 2. Load persisted settings from disk (via main process)
   * 3. Apply theme/color/font settings to the DOM
   * 4. Auto-login if saved credentials exist
   */
  async componentDidMount() {
    document.addEventListener("keydown", this._handleKeyDown);

    // Keep events in sync with changes made on other devices
    this._refreshTimer = setInterval(this._autoRefresh, AUTO_REFRESH_MS);
    window.addEventListener("focus", this._handleWindowFocus);

    // Load settings from main process (stored in userData/settings.json)
    const result = await ipcRenderer.invoke("get-settings");
    if (result.success) {
      // Credentials are kept out of `settings` so saving preferences can
      // never write back credentials that were cleared by logging out
      const { serverUrl, username, password, ...prefs } = result.settings;
      const settings = { ...DEFAULT_SETTINGS, ...prefs };
      this.setState({ settings, currentView: settings.defaultView || "month" }, () => {
        this.applySettings();
      });

      // Check for saved credentials
      if (serverUrl && username && password) {
        this.handleLoginSubmit({ serverUrl, username, password, rememberMe: true });
      } else if (serverUrl) {
        this.setState({ serverUrl });
      }
    }
  }

  componentWillUnmount() {
    document.removeEventListener("keydown", this._handleKeyDown);
    window.removeEventListener("focus", this._handleWindowFocus);
    clearInterval(this._refreshTimer);
    clearTimeout(this._noticeTimer);
  }

  componentDidUpdate(prevProps, prevState) {
    // Persist task lists whenever they change
    if (prevState.taskLists !== this.state.taskLists) {
      try {
        localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(this.state.taskLists));
      } catch (e) {
        console.error("Failed to save task lists:", e);
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

    // First day of the week (calendar grid, mini calendar and week numbers)
    applyWeekStart(settings.firstDayOfWeek);
  }

  getSystemTheme() {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  // ── Keyboard shortcuts & notices ──────────────────────────────────────

  _isAnyModalOpen() {
    const s = this.state;
    return (
      s.showEventModal ||
      s.showTaskModal ||
      s.showCalendarSettingsModal ||
      s.showCreateCalendarModal ||
      s.showSettings
    );
  }

  /**
   * _handleKeyDown — Global shortcuts:
   *   Esc closes the topmost dialog or popover, N creates an event,
   *   T jumps to today. Letter shortcuts are ignored while typing.
   */
  _handleKeyDown = (e) => {
    if (e.key === "Escape") {
      if (this.state.showEventModal) this._closeEventModal();
      else if (this.state.showTaskModal) this._closeTaskModal();
      else if (this.state.showCalendarSettingsModal) this._closeCalendarSettingsModal();
      else if (this.state.showCreateCalendarModal) this._closeCreateCalendarModal();
      else if (this.state.showSettings) this._closeSettings();
      else if (this.state.contextMenu.visible) this.handleCloseContextMenu();
      return;
    }

    const target = e.target || {};
    const tag = (target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!this.state.isConnected || this._isAnyModalOpen()) return;

    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      this.handleNewEvent();
    } else if (e.key === "t" || e.key === "T") {
      this.handleDateNavigate(new Date());
    }
  };

  /** Shows a short, non-blocking message at the bottom of the window. */
  _notify(text, type = "info") {
    clearTimeout(this._noticeTimer);
    this.setState({ notice: { id: Date.now(), text, type } });
    this._noticeTimer = setTimeout(
      () => this.setState({ notice: null }),
      type === "error" ? NOTICE_TIMEOUT_MS * 2 : NOTICE_TIMEOUT_MS
    );
  }

  _dismissNotice = () => {
    clearTimeout(this._noticeTimer);
    this.setState({ notice: null });
  };

  // Generic input handler — updates top-level state fields by input name
  handleInputChange = (e) => {
    const { name, value } = e.target;
    this.setState({ [name]: value });
  };

  /**
   * handleLoginSubmit — Authenticates with the CalDAV server.
   *
   * Flow:
   * 1. Send credentials to main process via "connect-caldav" IPC
   * 2. On success: save credentials (if rememberMe), store calendars in state
   * 3. Select all event-capable calendars (VEVENT) except the ones the user hid
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

          if (!result.success) {
            // Connection failed - show error but keep the form visible
            this.setState({
              errorMessage:
                result.error ||
                "Connection failed. Please check your credentials and try again.",
              isLoading: false,
            });
            return;
          }

          // Save credentials if rememberMe is true
          if (rememberMe) {
            await ipcRenderer.invoke("save-settings", {
              serverUrl: this.state.serverUrl,
              username: this.state.username,
              password: this.state.password,
            });
          }

          const calendars = result.calendars || [];
          const hidden = this.state.settings.hiddenCalendars || [];
          const selectedCalendarIds = calendars
            .filter((cal) => cal.components && cal.components.includes("VEVENT"))
            .map((cal) => cal.url)
            .filter((url) => !hidden.includes(url));

          this.setState(
            {
              isConnected: true,
              calendars,
              homeUrl: result.homeUrl || null,
              selectedCalendarIds,
              allCalendarEvents: {},
              showLoginForm: false,
              isLoading: false,
              errorMessage: "",
            },
            () => {
              if (calendars.length === 0) {
                this._notify("No calendars found in your account", "error");
              }
              this.fetchAllCalendarEvents();
            }
          );
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

  // ── Event data ────────────────────────────────────────────────────────

  /**
   * _getVisibleEvents — Events of all checked calendars, with task events
   * marked completed when their task is checked off. Memoized so components
   * receive the same array (and skip re-rendering) until something changes.
   */
  _getVisibleEvents() {
    const { allCalendarEvents, selectedCalendarIds, taskLists } = this.state;
    const cache = this._visibleCache;
    if (
      cache &&
      cache.allCalendarEvents === allCalendarEvents &&
      cache.selectedCalendarIds === selectedCalendarIds &&
      cache.taskLists === taskLists
    ) {
      return cache.events;
    }

    const completedTasks = new Set();
    taskLists.forEach((list) =>
      list.tasks.forEach((task) => task.completed && completedTasks.add(task.name))
    );

    let events = [];
    selectedCalendarIds.forEach((url) => {
      if (allCalendarEvents[url]) events = events.concat(allCalendarEvents[url]);
    });
    if (completedTasks.size > 0) {
      events = events.map((ev) =>
        completedTasks.has(ev.title) && isTaskEvent(ev) ? { ...ev, completed: true } : ev
      );
    }

    this._visibleCache = { allCalendarEvents, selectedCalendarIds, taskLists, events };
    return events;
  }

  /** Applies `fn` to one calendar's cached event list. */
  _updateCalendarEvents(calendarUrl, fn) {
    this.setState((prevState) => ({
      allCalendarEvents: {
        ...prevState.allCalendarEvents,
        [calendarUrl]: fn(prevState.allCalendarEvents[calendarUrl] || []),
      },
    }));
  }

  /**
   * _bumpCalendar — Marks a calendar as changed locally. A fetch that was
   * already running when the change happened returns outdated data, so its
   * result is discarded (the change triggers a fresh reload of its own).
   */
  _bumpCalendar(calendarUrl) {
    this._calendarVersions[calendarUrl] = (this._calendarVersions[calendarUrl] || 0) + 1;
  }

  /**
   * loadCalendarEvents — Fetches one calendar's events and replaces its cached
   * list. Events that were just created locally and aren't on the server yet
   * are kept. Returns { success, error }.
   */
  loadCalendarEvents = async (calendarUrl) => {
    const calendar = this.state.calendars.find((cal) => cal.url === calendarUrl);
    if (!calendar) return { success: false, error: "Calendar not found" };

    const version = this._calendarVersions[calendarUrl] || 0;
    let result;
    try {
      result = await ipcRenderer.invoke("fetch-events", {
        serverUrl: this.state.serverUrl,
        username: this.state.username,
        password: this.state.password,
        calendar: calendar,
        calendarUrl: calendarUrl,
      });
    } catch (error) {
      result = { success: false, error: error.message };
    }

    if (!result.success) {
      console.error(`Failed to fetch ${calendar.displayName}:`, result.error);
      return result;
    }
    // Stale: the calendar changed while this request was running
    if ((this._calendarVersions[calendarUrl] || 0) !== version) {
      return { success: true };
    }

    const serverEvents = result.events.map((event) => ({
      ...event,
      calendarUrl: calendarUrl,
      calendarName: calendar.displayName,
    }));
    const serverUrls = new Set(serverEvents.map((ev) => ev.url));

    this.setState((prevState) => {
      const pending = (prevState.allCalendarEvents[calendarUrl] || []).filter(
        (ev) => ev._isOptimistic && !(ev.url && serverUrls.has(ev.url))
      );
      return {
        allCalendarEvents: {
          ...prevState.allCalendarEvents,
          [calendarUrl]: [...serverEvents, ...pending],
        },
      };
    });
    return { success: true };
  };

  /**
   * fetchAllCalendarEvents — Refreshes all checked calendars in parallel.
   * With `silent`, no spinner or error message is shown (background sync).
   */
  fetchAllCalendarEvents = async ({ silent = false } = {}) => {
    if (!silent) this.setState({ isLoading: true });
    this._lastRefresh = Date.now();

    const results = await Promise.all(
      this.state.selectedCalendarIds.map((url) => this.loadCalendarEvents(url))
    );

    if (!silent) {
      this.setState({ isLoading: false });
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        this._notify(`Couldn't load events: ${friendlyError(failed[0].error)}`, "error");
      }
    }
  };

  /** Background sync: periodic, and when the window regains focus. */
  _autoRefresh = () => {
    if (!this.state.isConnected || this._pendingChanges > 0 || document.hidden) return;
    this.fetchAllCalendarEvents({ silent: true });
  };

  _handleWindowFocus = () => {
    if (Date.now() - this._lastRefresh > FOCUS_REFRESH_GAP_MS) this._autoRefresh();
  };

  /**
   * _syncChange — Runs a server change with an optimistic UI update.
   * `applyOptimistic` updates the calendar's events immediately; once the server
   * answers, the calendar is reloaded, which confirms the change or reverts it.
   */
  _syncChange = async (calendarUrl, applyOptimistic, serverCall, failureMessage) => {
    this._bumpCalendar(calendarUrl);
    this._pendingChanges++;
    const snapshot = this.state.allCalendarEvents[calendarUrl];
    if (applyOptimistic) this._updateCalendarEvents(calendarUrl, applyOptimistic);

    let result;
    try {
      result = await serverCall();
    } catch (error) {
      result = { success: false, error: error.message };
    }
    const failed = !result || !result.success;

    this._pendingChanges--;
    this._bumpCalendar(calendarUrl);
    if (failed) {
      // Undo the optimistic change right away; the reload below can't if the
      // server is unreachable
      this.setState((prevState) => ({
        allCalendarEvents: { ...prevState.allCalendarEvents, [calendarUrl]: snapshot },
      }));
      this._notify(`${failureMessage}: ${friendlyError(result && result.error)}`, "error");
    }
    this.loadCalendarEvents(calendarUrl);
    return result || { success: false };
  };

  /**
   * handleCalendarToggle — Shows or hides a calendar's events.
   * Showing uses cached events instantly and refreshes them in the background.
   * The choice is remembered across restarts.
   */
  handleCalendarToggle = async (calendarUrl) => {
    const wasSelected = this.state.selectedCalendarIds.includes(calendarUrl);
    const selectedCalendarIds = wasSelected
      ? this.state.selectedCalendarIds.filter((id) => id !== calendarUrl)
      : [...this.state.selectedCalendarIds, calendarUrl];

    const hiddenCalendars = this.state.calendars
      .filter((cal) => cal.components && cal.components.includes("VEVENT"))
      .map((cal) => cal.url)
      .filter((url) => !selectedCalendarIds.includes(url));
    this.handleSettingChange("hiddenCalendars", hiddenCalendars);

    if (wasSelected) {
      this.setState({ selectedCalendarIds });
      return;
    }

    const hasCache = !!this.state.allCalendarEvents[calendarUrl];
    this.setState({ selectedCalendarIds, isLoading: !hasCache || this.state.isLoading });
    const result = await this.loadCalendarEvents(calendarUrl);
    if (!hasCache) this.setState({ isLoading: false });
    if (!result.success) this._notify(`Couldn't load events: ${friendlyError(result.error)}`, "error");
  };

  // ── Creating events ───────────────────────────────────────────────────

  /** Event calendars the user can create events in. */
  _getEventCalendars() {
    return this.state.calendars.filter(
      (cal) => !cal.components || cal.components.length === 0 || cal.components.includes("VEVENT")
    );
  }

  /** Calendar for new events: the last one used, else the first visible one. */
  _getDefaultCalendarUrl() {
    const eventCalendars = this._getEventCalendars();
    const urls = eventCalendars.map((cal) => cal.url);
    if (this._lastUsedCalendarUrl && urls.includes(this._lastUsedCalendarUrl)) {
      return this._lastUsedCalendarUrl;
    }
    const visible = urls.find((url) => this.state.selectedCalendarIds.includes(url));
    return visible || urls[0] || "";
  }

  /** Opens the event modal pre-filled with the given values. */
  _openNewEventModal(values) {
    this.setState({
      showEventModal: true,
      isEditMode: false,
      editingEvent: null,
      newEvent: {
        title: "",
        description: "",
        location: "",
        allDay: false,
        calendarUrl: this._getDefaultCalendarUrl(),
        ...values,
      },
    });
  }

  /**
   * handleSelectSlot — Opens the event modal for a clicked/dragged time range.
   * Day selections (month view, all-day row) create all-day events; a single
   * click on a time slot creates a one-hour event.
   */
  handleSelectSlot = ({ start, end }) => {
    start = new Date(start);
    end = new Date(end);
    const allDay =
      this.state.currentView === "month" ||
      (isMidnight(start) && isMidnight(end) && end > start);

    if (allDay) {
      start = startOfDay(start);
      end = startOfDay(end);
      if (end <= start) end = addDays(start, 1);
    } else if (end - start <= 15 * 60000) {
      end = new Date(start.getTime() + 60 * 60000);
    }

    this._openNewEventModal({ start, end, allDay });
  };

  /** "New event" button / N key: next full hour today, or 9:00 on another day. */
  handleNewEvent = () => {
    const now = new Date();
    const day = this.state.currentDate || now;
    let start;
    if (startOfDay(day).getTime() === startOfDay(now).getTime()) {
      start = new Date(now);
      start.setHours(now.getHours() + 1, 0, 0, 0);
    } else {
      start = startOfDay(day);
      start.setHours(9);
    }
    this._openNewEventModal({ start, end: new Date(start.getTime() + 60 * 60000) });
  };

  /**
   * _createEvent — Creates an event on the server with an optimistic
   * placeholder that is shown (and dimmed) until the server confirms it.
   */
  _createEvent = (eventData) => {
    const calendarUrl = eventData.calendarUrl;
    const calendar = this.state.calendars.find((cal) => cal.url === calendarUrl);
    if (!calendar) {
      this._notify("Please choose a calendar for the event.", "error");
      return Promise.resolve({ success: false });
    }
    this._lastUsedCalendarUrl = calendarUrl;

    // Make sure the user sees the new event
    if (!this.state.selectedCalendarIds.includes(calendarUrl)) {
      this.handleCalendarToggle(calendarUrl);
    }

    const tempId = `temp-${newId()}`;
    const payload = {
      title: eventData.title,
      start: new Date(eventData.start),
      end: new Date(eventData.end),
      allDay: !!eventData.allDay,
      description: eventData.description || "",
      location: eventData.location || "",
    };
    const tempEvent = {
      ...payload,
      id: tempId,
      calendarUrl,
      calendarName: calendar.displayName,
      _isOptimistic: true,
    };

    return this._syncChange(
      calendarUrl,
      (list) => [...list, tempEvent],
      async () => {
        const result = await ipcRenderer.invoke("create-event", {
          serverUrl: this.state.serverUrl,
          username: this.state.username,
          password: this.state.password,
          calendarUrl,
          eventData: payload,
        });
        // Link the placeholder to the created resource (the reload then replaces
        // it with the server's copy), or drop it if creation failed
        this._updateCalendarEvents(calendarUrl, (list) =>
          result.success
            ? list.map((ev) => (ev.id === tempId ? { ...ev, url: result.eventUrl } : ev))
            : list.filter((ev) => ev.id !== tempId)
        );
        return result;
      },
      "Failed to create event"
    );
  };

  // Called by EventModal when creating
  handleCreateEvent = (eventData) => {
    this.setState({ showEventModal: false, isEditMode: false, editingEvent: null });
    this._createEvent(eventData);
  };

  // ── Changing and deleting events ──────────────────────────────────────

  /**
   * _updateEvent — Saves changes to an event.
   * For a recurring event, `scope` decides whether only this occurrence
   * ("occurrence") or the whole series ("series") changes.
   */
  _updateEvent = (event, changes, scope = "occurrence") => {
    if (!event.url) {
      this._notify("This event is still being saved. Try again in a moment.");
      return Promise.resolve({ success: false });
    }
    const isSeries = event.recurring && scope === "series";
    const applyOptimistic = (list) =>
      list.map((ev) => {
        if (isSeries) {
          // Text changes apply to every occurrence; new times come from the reload
          if (ev.url !== event.url) return ev;
          return {
            ...ev,
            title: changes.title !== undefined ? changes.title : ev.title,
            description: changes.description !== undefined ? changes.description : ev.description,
            location: changes.location !== undefined ? changes.location : ev.location,
          };
        }
        if (ev.id !== event.id) return ev;
        return {
          ...ev,
          ...changes,
          start: new Date(changes.start || ev.start),
          end: new Date(changes.end || ev.end),
        };
      });

    const eventData = { ...changes };
    if (changes.start) eventData.start = new Date(changes.start).toISOString();
    if (changes.end) eventData.end = new Date(changes.end).toISOString();

    return this._syncChange(
      event.calendarUrl,
      applyOptimistic,
      () =>
        ipcRenderer.invoke("update-event", {
          username: this.state.username,
          password: this.state.password,
          calendarUrl: event.calendarUrl,
          eventId: event.uid || event.id,
          eventUrl: event.url,
          recurrenceId: event.recurrenceId,
          scope,
          originalStart: new Date(event.start).toISOString(),
          eventData,
        }),
      "Failed to save event"
    );
  };

  /**
   * handleEventDrop — Event dragged to a new time (single occurrence for
   * recurring events). Dropping into the all-day row of the week/day view
   * makes the event all-day; dropping an all-day event into the time grid
   * gives it a one-hour slot.
   */
  handleEventDrop = ({ event, start, end, isAllDay }) => {
    start = new Date(start);
    end = new Date(end);
    let allDay = !!event.allDay;
    const inTimeGrid = this.state.currentView !== "month" && !isAllDay;

    if (isAllDay && !allDay) {
      allDay = true;
      start = startOfDay(start);
      end = addDays(start, 1);
    } else if (inTimeGrid && allDay) {
      allDay = false;
      end = new Date(start.getTime() + 60 * 60000);
    }

    if (
      new Date(event.start).getTime() === start.getTime() &&
      new Date(event.end).getTime() === end.getTime() &&
      !!event.allDay === allDay
    ) {
      return; // Dropped where it was
    }
    this._updateEvent(event, { start, end, allDay }, "occurrence");
  };

  // Handles event resize in week/day view
  handleEventResize = ({ event, start, end }) => {
    this._updateEvent(event, { start: new Date(start), end: new Date(end) }, "occurrence");
  };

  // Called by EventModal when saving an existing event
  handleUpdateEvent = (eventData) => {
    const { editingEvent } = this.state;
    if (!editingEvent) return;
    this.setState({ showEventModal: false, isEditMode: false, editingEvent: null });
    this._updateEvent(
      editingEvent,
      {
        title: eventData.title,
        start: eventData.start,
        end: eventData.end,
        allDay: !!eventData.allDay,
        description: eventData.description || "",
        location: eventData.location || "",
      },
      eventData.scope || "occurrence"
    );
  };

  /**
   * handleDeleteEvent — Deletes an event. For a recurring event, `scope`
   * "occurrence" removes just this occurrence; "series" removes all of them.
   */
  handleDeleteEvent = (event, scope = "series") => {
    if (!event.url) {
      this._notify("This event is still being saved. Try again in a moment.");
      return;
    }
    const occurrenceOnly = event.recurring && scope === "occurrence";
    this.setState({ showEventModal: false, isEditMode: false, editingEvent: null });
    this._syncChange(
      event.calendarUrl,
      (list) =>
        list.filter((ev) => (occurrenceOnly ? ev.id !== event.id : ev.url !== event.url)),
      () =>
        ipcRenderer.invoke("delete-event", {
          serverUrl: this.state.serverUrl,
          username: this.state.username,
          password: this.state.password,
          calendarUrl: event.calendarUrl,
          eventId: event.uid || event.id,
          eventUrl: event.url,
          recurrenceId: occurrenceOnly ? event.recurrenceId : undefined,
        }),
      "Failed to delete event"
    );
  };

  // Shows the event popover on click; Alt+Click = quick delete shortcut
  handleContextMenu = (event, jsEvent) => {
    if (jsEvent && jsEvent.altKey) {
      jsEvent.preventDefault();
      const what = event.recurring
        ? `this occurrence of "${event.title}"`
        : `"${event.title}"`;
      if (confirm(`Delete ${what}?`)) {
        this.handleDeleteEvent(event, "occurrence");
      }
      return;
    }

    if (jsEvent) jsEvent.preventDefault();
    // Anchor the popover beside the clicked event so it doesn't cover it
    // (a popover under the cursor would swallow the second click of a double-click)
    const target = jsEvent && jsEvent.target;
    const eventEl =
      target && target.closest ? target.closest(".rbc-event, .rbc-agenda-event-cell") : null;
    const rect = eventEl ? eventEl.getBoundingClientRect() : null;
    this.setState({
      contextMenu: {
        visible: true,
        x: jsEvent ? jsEvent.clientX : window.innerWidth / 2,
        y: jsEvent ? jsEvent.clientY : window.innerHeight / 2,
        anchor: rect
          ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
          : null,
        event: event,
      },
    });
  };

  handleCloseContextMenu = () => {
    if (!this.state.contextMenu.visible) return;
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
    if (event.isPreview) return;
    this.setState({
      isEditMode: true,
      editingEvent: event,
      newEvent: {
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: !!event.allDay,
        description: event.description || "",
        location: event.location || "",
        calendarUrl: event.calendarUrl,
      },
      showEventModal: true,
      contextMenu: { visible: false, x: 0, y: 0, event: null },
    });
  };

  // ── Calendars ─────────────────────────────────────────────────────────

  /** Reloads the calendar list from the server (after creating/deleting one). */
  refreshCalendarList = async () => {
    const result = await ipcRenderer.invoke("connect-caldav", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
    });
    if (!result.success) return null;
    this.setState((prevState) => ({
      calendars: result.calendars,
      homeUrl: result.homeUrl || prevState.homeUrl,
      selectedCalendarIds: prevState.selectedCalendarIds.filter((url) =>
        result.calendars.some((cal) => cal.url === url)
      ),
    }));
    return result.calendars;
  };

  /**
   * handleCreateCalendar — Creates a new calendar on the server (MKCALENDAR),
   * then reloads the calendar list and shows the new calendar.
   */
  handleCreateCalendar = async (calendarName, calendarColor) => {
    this.setState({ showCreateCalendarModal: false });

    const result = await ipcRenderer.invoke("create-calendar", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendarName: calendarName,
      calendarColor: calendarColor,
      homeUrl: this.state.homeUrl,
    });

    if (!result.success) {
      console.error("Calendar creation failed:", result.error);
      this._notify("Failed to create calendar: " + result.error, "error");
      return;
    }

    const calendars = await this.refreshCalendarList();
    const created =
      calendars && calendars.find((cal) => cal.url === result.calendarUrl);
    if (created) {
      this.setState((prevState) => ({
        selectedCalendarIds: [...prevState.selectedCalendarIds, created.url],
        allCalendarEvents: { ...prevState.allCalendarEvents, [created.url]: [] },
      }));
    }
    this._notify(`Calendar "${calendarName}" created`);
  };

  handleCalendarSettings = (calendar) => {
    this.setState({
      showCalendarSettingsModal: true,
      selectedCalendarForSettings: calendar,
    });
  };

  handleUpdateCalendarColor = async (calendarUrl, color) => {
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

    if (!result.success) {
      this._notify("Failed to update calendar color: " + result.error, "error");
      // Revert on failure by re-fetching calendars
      this.refreshCalendarList();
    }
  };

  handleUpdateCalendarName = async (calendarUrl, newName) => {
    if (!newName || !newName.trim()) {
      this._notify("Calendar name cannot be empty", "error");
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

    if (!result.success) {
      this._notify("Failed to update calendar name: " + result.error, "error");
      // Revert on failure
      this.refreshCalendarList();
    }
  };

  /**
   * handleDeleteCalendar — Deletes a calendar from both the UI and the Nextcloud server.
   *
   * Workflow:
   *   1. Optimistically remove the calendar and its events from state
   *   2. Send IPC request to main process → caldavService.deleteCalendar()
   *   3. On success: confirm with a notice and refresh the calendar list
   *   4. On failure: show the error and restore the list from the server
   *
   * @param {string} calendarUrl - The full URL of the calendar to delete
   */
  handleDeleteCalendar = async (calendarUrl) => {
    const calendarName =
      this.state.calendars.find((cal) => cal.url === calendarUrl)
        ?.displayName || "Calendar";

    // Optimistic update - remove from state immediately
    this.setState((prevState) => {
      const allCalendarEvents = { ...prevState.allCalendarEvents };
      delete allCalendarEvents[calendarUrl];
      return {
        calendars: prevState.calendars.filter((cal) => cal.url !== calendarUrl),
        selectedCalendarIds: prevState.selectedCalendarIds.filter(
          (id) => id !== calendarUrl
        ),
        showCalendarSettingsModal: false,
        selectedCalendarForSettings: null,
        allCalendarEvents,
      };
    });

    // Delete on server
    const result = await ipcRenderer.invoke("delete-calendar", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
    });

    if (result.success) {
      this._notify(`"${calendarName}" has been deleted.`);
      this.refreshCalendarList();
    } else {
      console.error("Calendar deletion failed:", result.error);
      this._notify("Failed to delete calendar: " + result.error, "error");
      // Revert on failure: restore the list, re-show the calendar and its events
      const calendars = await this.refreshCalendarList();
      if (calendars && calendars.some((cal) => cal.url === calendarUrl)) {
        this.setState((prevState) => ({
          selectedCalendarIds: [...prevState.selectedCalendarIds, calendarUrl],
        }));
        this.loadCalendarEvents(calendarUrl);
      }
    }
  };

  handleAddCalendarShare = async (calendarUrl, shareEmail, permission) => {
    const result = await ipcRenderer.invoke("share-calendar", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      shareWithEmail: shareEmail,
      permission: permission,
    });

    if (result.success) {
      this._notify(`Calendar shared with ${shareEmail}!`);

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
      console.error("Calendar share failed:", result.error);
      this._notify("Failed to share calendar: " + result.error, "error");
    }
  };

  handleRemoveCalendarShare = async (calendarUrl, shareId) => {
    const result = await ipcRenderer.invoke("remove-calendar-share", {
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl,
      shareEmail: shareId,
    });

    if (result.success) {
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
      console.error("Calendar share removal failed:", result.error);
      this._notify("Failed to remove calendar share: " + result.error, "error");
    }
  };

  handleLogout = () => {
    // Clear saved credentials (preferences stay)
    ipcRenderer.invoke("save-settings", {
      serverUrl: this.state.serverUrl, // Keep serverUrl pre-filled for convenience
      username: "",
      password: "",
    });

    this.setState({
      isConnected: false,
      calendars: [],
      selectedCalendarIds: [],
      allCalendarEvents: {},
      homeUrl: null,
      showLoginForm: true,
      username: "",
      password: "",
      contextMenu: { visible: false, x: 0, y: 0, event: null },
    });
  };

  // ============================================
  // Task Management Handlers
  // ============================================

  // Creates a new task list (stored locally; TODO: sync via CalDAV VTODO)
  handleCreateList = (listName) => {
    const newList = {
      id: newId(),
      name: listName,
      tasks: [],
      createdAt: new Date().toISOString(),
    };

    this.setState((prevState) => ({
      taskLists: [...prevState.taskLists, newList],
    }));
  };

  // Creates a new task within a list (stored locally; TODO: sync via CalDAV VTODO)
  handleCreateTask = (listId, taskName) => {
    const newTask = {
      id: newId(),
      name: taskName,
      completed: false,
      createdAt: new Date().toISOString(),
    };

    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((list) =>
        list.id === listId ? { ...list, tasks: [...list.tasks, newTask] } : list
      ),
    }));
  };

  // Toggles task completion (events scheduled from the task are struck through)
  handleToggleTask = (listId, taskId) => {
    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((l) =>
        l.id === listId
          ? {
              ...l,
              tasks: l.tasks.map((t) =>
                t.id === taskId ? { ...t, completed: !t.completed } : t
              ),
            }
          : l
      ),
    }));
  };

  /** Deletes the calendar events that were scheduled from the given tasks. */
  _deleteTaskEvents(taskNames) {
    if (taskNames.length === 0) return;
    Object.values(this.state.allCalendarEvents).forEach((list) =>
      list
        .filter((ev) => taskNames.includes(ev.title) && isTaskEvent(ev) && ev.url)
        .forEach((ev) => this.handleDeleteEvent(ev, "occurrence"))
    );
  }

  handleDeleteTask = (listId, taskId) => {
    const list = this.state.taskLists.find((l) => l.id === listId);
    const task = list?.tasks.find((t) => t.id === taskId);

    this.setState((prevState) => ({
      taskLists: prevState.taskLists.map((l) =>
        l.id === listId
          ? { ...l, tasks: l.tasks.filter((t) => t.id !== taskId) }
          : l
      ),
    }));
    if (task) this._deleteTaskEvents([task.name]);
  };

  handleDeleteList = (listId) => {
    const list = this.state.taskLists.find((l) => l.id === listId);
    const taskNames = list?.tasks ? list.tasks.map((t) => t.name) : [];

    this.setState((prevState) => ({
      taskLists: prevState.taskLists.filter((l) => l.id !== listId),
    }));
    this._deleteTaskEvents(taskNames);
  };

  handleToggleTaskManager = () => {
    this.setState((prevState) => ({
      showTaskManager: !prevState.showTaskManager,
    }));
  };

  // Calendar button on a task: opens the event modal pre-filled with the task
  handleTaskToCalendar = (listId, taskId) => {
    const list = this.state.taskLists.find((l) => l.id === listId);
    const task = list?.tasks.find((t) => t.id === taskId);
    if (!task) return;

    const duration = this.state.settings?.defaultTaskDuration || 15;
    const start = new Date(this.state.currentDate || new Date());
    if (startOfDay(start).getTime() === startOfDay(new Date()).getTime()) {
      start.setHours(new Date().getHours() + 1, 0, 0, 0);
    } else {
      start.setHours(9, 0, 0, 0);
    }

    this._openNewEventModal({
      title: task.name,
      start,
      end: new Date(start.getTime() + duration * 60000),
      description: `Task from list: ${list.name}`,
    });
  };

  /**
   * handleTaskDroppedOnCalendar — A task was dragged from the sidebar onto
   * the calendar: creates an event at the drop time with the task's name and
   * the configured default task duration.
   */
  handleTaskDroppedOnCalendar = (dragData, slotInfo) => {
    if (!dragData || !dragData.task || !dragData.task.name) {
      console.error("Invalid drag data:", dragData);
      return;
    }

    const calendarUrl = this._getDefaultCalendarUrl();
    if (!calendarUrl) {
      this._notify("No calendar available. Please create a calendar first.", "error");
      return;
    }

    const taskDuration = this.state.settings?.defaultTaskDuration || 15;
    const start = new Date(slotInfo?.start || new Date());
    this._createEvent({
      title: dragData.task.name,
      start,
      end: new Date(start.getTime() + taskDuration * 60000),
      description: `Task from list: ${dragData.listName || "Unknown"}`,
      location: "",
      calendarUrl,
    });
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

  /** Saves edits made in the task modal. */
  _saveTaskEdits(taskData) {
    const { editingTaskListId, editingTask } = this.state;
    if (!editingTask) return;
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
    }));
  }

  handleTaskModalSubmit = (taskData) => {
    this._saveTaskEdits(taskData);
    this._closeTaskModal();
  };

  handleTaskModalAddToCalendar = (eventData, taskData) => {
    if (taskData) this._saveTaskEdits(taskData);
    this.setState({ showTaskModal: false, editingTaskListId: null, editingTask: null });
    this._openNewEventModal(eventData);
  };

  // ============================================
  // End Task Management Handlers
  // ============================================

  handleChangeView = (view) => {
    this.setState({ currentView: view });
  };

  handleDateNavigate = (date) => {
    this.setState({ currentDate: date });
  };

  // Updates a single setting, applies it to the DOM, and persists (debounced)
  handleSettingChange = (key, value) => {
    this.setState(
      (prevState) => ({
        settings: { ...prevState.settings, [key]: value },
        // Show the new default view right away
        currentView: key === "defaultView" ? value : prevState.currentView,
      }),
      () => {
        this.applySettings();
        // Debounce saving to avoid frequent synchronous work in main process
        this._debouncedSaveSettings(this.state.settings);
      }
    );
  };

  // Resets all settings to factory defaults and persists immediately
  handleResetSettings = () => {
    const defaults = { ...DEFAULT_SETTINGS };
    this.setState({ settings: defaults }, () => {
      this.applySettings();
      ipcRenderer.invoke("save-settings", defaults);
    });
  };

  // ── Stable callback references for render (avoid inline arrows) ──
  _openCreateCalendarModal = () => this.setState({ showCreateCalendarModal: true });
  _openSettings = () => this.setState({ showSettings: true });
  _closeSettings = () => this.setState({ showSettings: false });
  _closeCreateCalendarModal = () => this.setState({ showCreateCalendarModal: false });
  _closeEventModal = () => this.setState({ showEventModal: false, isEditMode: false, editingEvent: null });
  _closeCalendarSettingsModal = () => this.setState({ showCalendarSettingsModal: false, selectedCalendarForSettings: null });
  _closeTaskModal = () => this.setState({ showTaskModal: false, editingTaskListId: null, editingTask: null });
  _handleRefresh = () => this.fetchAllCalendarEvents();

  /**
   * render — Renders either the login form or the full app layout.
   * The app layout consists of:
   *   - CalendarView (sidebar + calendar grid)
   *   - ContextMenu (event details + actions)
   *   - EventModal (create/edit events)
   *   - Settings, CreateCalendarModal, CalendarSettingsModal
   *   - TaskModal (edit task details)
   *   - A transient notice for confirmations and errors
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
    }

    const events = this._getVisibleEvents();
    const { notice } = this.state;

    return h(
      "div",
      { className: "kalendar-app-wrapper" },
      h(CalendarView, {
        localizer: localizer,
        events: events,
        calendars: this.state.calendars,
        selectedCalendarIds: this.state.selectedCalendarIds,
        settings: this.state.settings,
        currentDate: this.state.currentDate,
        isLoading: this.state.isLoading,
        taskLists: this.state.taskLists,
        showTaskManager: this.state.showTaskManager,
        currentView: this.state.currentView,
        onSelectSlot: this.handleSelectSlot,
        onSelectEvent: this.handleContextMenu,
        onDoubleClickEvent: this.handleEditEvent,
        onNewEvent: this.handleNewEvent,
        onEventDrop: this.handleEventDrop,
        onEventResize: this.handleEventResize,
        onCalendarToggle: this.handleCalendarToggle,
        onAddCalendar: this._openCreateCalendarModal,
        onCalendarSettings: this.handleCalendarSettings,
        onDateNavigate: this.handleDateNavigate,
        onRefresh: this._handleRefresh,
        onSettingsClick: this._openSettings,
        onLogout: this.handleLogout,
        onToggleTaskManager: this.handleToggleTaskManager,
        onCreateList: this.handleCreateList,
        onCreateTask: this.handleCreateTask,
        onDeleteTask: this.handleDeleteTask,
        onDeleteList: this.handleDeleteList,
        onToggleTask: this.handleToggleTask,
        onTaskToCalendar: this.handleTaskToCalendar,
        onTaskClick: this.handleTaskClick,
        onTaskDroppedOnCalendar: this.handleTaskDroppedOnCalendar,
        onViewChange: this.handleChangeView,
      }),

      h(ContextMenu, {
        visible: this.state.contextMenu.visible,
        x: this.state.contextMenu.x,
        y: this.state.contextMenu.y,
        anchor: this.state.contextMenu.anchor,
        event: this.state.contextMenu.event,
        calendars: this.state.calendars,
        timeFormat: this.state.settings.timeFormat,
        onEdit: this.handleEditEvent,
        onDelete: this.handleDeleteEvent,
        onClose: this.handleCloseContextMenu,
      }),
      this.state.showEventModal &&
        h(EventModal, {
          newEvent: this.state.newEvent,
          isEditMode: this.state.isEditMode,
          isRecurring: !!(this.state.isEditMode && this.state.editingEvent?.recurring),
          calendars: this._getEventCalendars(),
          onSubmit: this.state.isEditMode
            ? this.handleUpdateEvent
            : this.handleCreateEvent,
          onDelete: this.state.isEditMode
            ? (scope) => this.handleDeleteEvent(this.state.editingEvent, scope)
            : null,
          onClose: this._closeEventModal,
        }),
      this.state.showSettings &&
        h(Settings, {
          settings: this.state.settings,
          onSettingChange: this.handleSettingChange,
          onClose: this._closeSettings,
          onReset: this.handleResetSettings,
        }),

      this.state.showCreateCalendarModal &&
        h(CreateCalendarModal, {
          onSubmit: this.handleCreateCalendar,
          onClose: this._closeCreateCalendarModal,
        }),
      this.state.showCalendarSettingsModal &&
        h(CalendarSettingsModal, {
          calendar: this.state.selectedCalendarForSettings,
          onUpdateColor: this.handleUpdateCalendarColor,
          onUpdateName: this.handleUpdateCalendarName,
          onDeleteCalendar: this.handleDeleteCalendar,
          onAddShare: this.handleAddCalendarShare,
          onRemoveShare: this.handleRemoveCalendarShare,
          onClose: this._closeCalendarSettingsModal,
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
          onClose: this._closeTaskModal,
        }),

      notice &&
        h(
          "div",
          {
            key: notice.id,
            className: `kal-notice kal-notice--${notice.type}`,
            role: notice.type === "error" ? "alert" : "status",
          },
          h("span", { className: "kal-notice-text" }, notice.text),
          h(
            "button",
            {
              className: "kal-notice-close",
              onClick: this._dismissNotice,
              "aria-label": "Dismiss",
            },
            "×"
          )
        )
    );
  }
}

// Bootstrap — Mount the KalendarApp component into the DOM (React 17 API)
ReactDOM.render(h(KalendarApp), document.getElementById("app"));
