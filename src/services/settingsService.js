// ============================================================================
// Settings Service — settingsService.js
// ============================================================================
// Manages persistent application settings stored as a JSON file in the
// Electron userData directory (e.g., %APPDATA%/kalendar/settings.json).
//
// Runs in the main process. The renderer communicates with this service
// through IPC handlers registered in main.js.
//
// Default settings include theme, colors, font size, calendar preferences,
// and task duration. Settings are loaded synchronously on startup and
// written asynchronously (with sync fallback) on save.
// ============================================================================

const electron = require("electron");
const fs = require("fs");
const path = require("path");

/**
 * SettingsService — Singleton service for reading/writing user preferences.
 * Instantiated once and exported as a module-level singleton.
 */
class SettingsService {
  constructor() {
    // Resolve the platform-specific userData path (e.g., %APPDATA% on Windows)
    const userDataPath = (electron.app || electron.remote.app).getPath(
      "userData"
    );
    this.settingsPath = path.join(userDataPath, "settings.json");
    this.settings = this.loadSettings(); // Load from disk on startup
  }

  /**
   * loadSettings — Reads settings from disk, or returns defaults if the file
   * doesn't exist or is corrupt.
   */
  loadSettings() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading settings:", error);
    } // Default settings
    return {
      theme: "light",
      primaryColor: "#5e72e4",
      accentColor: "#11cdef",
      fontSize: "medium",
      firstDayOfWeek: 0, // 0 = Sunday, 1 = Monday
      timeFormat: "12h",
      defaultView: "month",
      showWeekNumbers: false,
      compactMode: false,
      animations: true,
      defaultTaskDuration: 15, // minutes
    };
  }

  /**
   * saveSettings — Merges new settings into existing ones and writes to disk.
   * Prefers async fs.promises.writeFile to avoid blocking the main process;
   * falls back to synchronous writeFileSync if the promises API is unavailable.
   */
  saveSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      // Write settings asynchronously to avoid blocking the main process
      if (fs.promises && typeof fs.promises.writeFile === "function") {
        return fs.promises
          .writeFile(
            this.settingsPath,
            JSON.stringify(this.settings, null, 2),
            "utf8"
          )
          .then(() => ({ success: true }))
          .catch((error) => {
            console.error("Error saving settings:", error);
            return { success: false, error: error.message };
          });
      }

      // Fallback to sync write if promises API is unavailable
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify(this.settings, null, 2),
        "utf8"
      );
      return { success: true };
    } catch (error) {
      console.error("Error saving settings:", error);
      return { success: false, error: error.message };
    }
  }

  /** Returns the in-memory settings object (no disk read). */
  getSettings() {
    return this.settings;
  }

  /**
   * resetSettings — Deletes the settings file from disk, causing loadSettings()
   * to return factory defaults on next call.
   */
  resetSettings() {
    this.settings = this.loadSettings();
    try {
      if (fs.promises && typeof fs.promises.unlink === "function") {
        return fs.promises
          .unlink(this.settingsPath)
          .then(() => ({ success: true }))
          .catch((error) => ({ success: false, error: error.message }));
      }

      // Fallback to sync unlink if promises API is unavailable
      fs.unlinkSync(this.settingsPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export a singleton instance — all IPC handlers share the same settings state
module.exports = new SettingsService();
