// ============================================================================
// Electron Main Process — main.js
// ============================================================================
// Entry point for the Electron desktop application.
// Responsibilities:
//   1. Create and manage the main BrowserWindow
//   2. Register IPC handlers that bridge the renderer process to backend services
//   3. Route CalDAV operations (connect, CRUD events/calendars, sharing)
//   4. Route settings operations (load, save, reset from JSON file)
//
// Architecture:
//   Renderer (src/app.js) ──IPC──▶ main.js ──▶ caldavService / settingsService
// ============================================================================

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Performance: enable GPU rasterization for smoother rendering
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Backend services — loaded in the main process (Node.js context)
const caldavService = require("./src/services/caldavService");
const settingsService = require("./src/services/settingsService");
const cacheService = require("./src/services/cacheService");

/** @type {BrowserWindow|null} Reference to the main application window */
let mainWindow;

/**
 * createWindow — Initializes the Electron BrowserWindow.
 * Starts maximized with node integration enabled so that
 * the renderer can use `require('electron')` for IPC.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Do not show the window until it's ready
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.maximize(); // Maximize the window
  mainWindow.loadFile("index.html");
  mainWindow.show(); // Show the window when it's ready

  // Open DevTools only in development
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

// Launch the window once Electron is ready
app.whenReady().then(createWindow);

// Quit the app when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// macOS: re-create window when dock icon is clicked and no windows exist
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ── IPC Handlers — CalDAV Operations ─────────────────────────────────────
// Each handler receives arguments from the renderer via ipcRenderer.invoke()
// and delegates to the corresponding caldavService method.
ipcMain.handle(
  "connect-caldav",
  async (event, { serverUrl, username, password }) => {
    return await caldavService.connect(serverUrl, username, password);
  }
);

ipcMain.handle(
  "fetch-events",
  async (event, { serverUrl, username, password, calendar, calendarUrl }) => {
    return await caldavService.fetchEvents(
      username,
      password,
      calendar,
      calendarUrl
    );
  }
);

ipcMain.handle(
  "create-event",
  async (
    event,
    { serverUrl, username, password, calendar, calendarUrl, eventData }
  ) => {
    return await caldavService.createEvent(
      username,
      password,
      calendar,
      calendarUrl,
      eventData
    );
  }
);

ipcMain.handle(
  "delete-event",
  async (event, { serverUrl, username, password, calendarUrl, eventId }) => {
    return await caldavService.deleteEvent(
      username,
      password,
      calendarUrl,
      eventId
    );
  }
);

ipcMain.handle(
  "create-calendar",
  async (
    event,
    { serverUrl, username, password, calendarName, calendarColor }
  ) => {
    return await caldavService.createCalendar(
      username,
      password,
      serverUrl,
      calendarName,
      calendarColor
    );
  }
);

ipcMain.handle(
  "update-calendar-color",
  async (event, { username, password, calendarUrl, color }) => {
    return await caldavService.updateCalendarColor(
      username,
      password,
      calendarUrl,
      color
    );
  }
);

ipcMain.handle(
  "update-calendar-name",
  async (event, { username, password, calendarUrl, displayName }) => {
    return await caldavService.updateCalendarName(
      username,
      password,
      calendarUrl,
      displayName
    );
  }
);

ipcMain.handle(
  "delete-calendar",
  async (event, { username, password, calendarUrl }) => {
    return await caldavService.deleteCalendar(
      username,
      password,
      calendarUrl
    );
  }
);

ipcMain.handle(
  "share-calendar",
  async (
    event,
    { username, password, calendarUrl, shareWithEmail, permission }
  ) => {
    return await caldavService.shareCalendar(
      username,
      password,
      calendarUrl,
      shareWithEmail,
      permission
    );
  }
);

ipcMain.handle(
  "get-calendar-shares",
  async (event, { username, password, calendarUrl }) => {
    return await caldavService.getCalendarShares(
      username,
      password,
      calendarUrl
    );
  }
);

ipcMain.handle(
  "remove-calendar-share",
  async (event, { username, password, calendarUrl, shareEmail }) => {
    return await caldavService.removeCalendarShare(
      username,
      password,
      calendarUrl,
      shareEmail
    );
  }
);

ipcMain.handle(
  "update-event",
  async (
    event,
    { username, password, calendarUrl, eventId, eventData }
  ) => {
    return await caldavService.updateEvent(
      username,
      password,
      calendarUrl,
      eventId,
      eventData
    );
  }
);

// ── IPC Handlers — Settings ─────────────────────────────────────────────
// Persists user preferences (theme, colors, calendar defaults) to a JSON
// file in the Electron userData directory.

ipcMain.handle("get-settings", async () => {
  try {
    const settings = settingsService.getSettings();
    return { success: true, settings };
  } catch (error) {
    console.error("Error getting settings:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("save-settings", async (event, settings) => {
  return settingsService.saveSettings(settings);
});

ipcMain.handle("reset-settings", async () => {
  const result = settingsService.resetSettings();
  if (result.success) {
    const settings = settingsService.getSettings();
    return { success: true, settings };
  }
  return result;
});

// ── IPC Handlers — Calendar Cache ───────────────────────────────────────
// Caches calendar data locally so the app can display instantly on startup.

ipcMain.handle("load-calendar-cache", async () => {
  try {
    const cache = cacheService.loadCache();
    return { success: true, cache };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle("save-calendar-cache", async (event, data) => {
  return cacheService.saveCache(data);
});

ipcMain.handle("clear-calendar-cache", async () => {
  return cacheService.clearCache();
});

// ── IPC Handler — User Search ───────────────────────────────────────────
// Searches for Nextcloud users via OCS API for sharing autocomplete.

ipcMain.handle(
  "search-users",
  async (event, { serverUrl, username, password, query }) => {
    return await caldavService.searchUsers(username, password, serverUrl, query);
  }
);
