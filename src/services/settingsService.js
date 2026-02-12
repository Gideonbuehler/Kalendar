// Settings Service - Manages app settings and preferences
const electron = require("electron");
const fs = require("fs");
const path = require("path");

class SettingsService {
  constructor() {
    const userDataPath = (electron.app || electron.remote.app).getPath(
      "userData"
    );
    this.settingsPath = path.join(userDataPath, "settings.json");
    this.settings = this.loadSettings();
  }

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

  saveSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
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

  getSettings() {
    return this.settings;
  }

  resetSettings() {
    this.settings = this.loadSettings();
    try {
      fs.unlinkSync(this.settingsPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = new SettingsService();
