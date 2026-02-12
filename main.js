const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// Import services
const caldavService = require("./src/services/caldavService");
const settingsService = require("./src/services/settingsService");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false, // Do not show the window until it's ready
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.maximize(); // Maximize the window
  mainWindow.loadFile("index.html");
  mainWindow.show(); // Show the window when it's ready

  // Open DevTools in development
  mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for CalDAV operations
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

// IPC handlers for Settings
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
