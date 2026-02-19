const electron = require("electron");
const fs = require("fs");
const path = require("path");

class CacheService {
  constructor() {
    const userDataPath = (electron.app || electron.remote.app).getPath("userData");
    this.cachePath = path.join(userDataPath, "calendar-cache.json");
  }

  loadCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        const data = fs.readFileSync(this.cachePath, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading cache:", error);
    }
    return null;
  }

  saveCache(data) {
    try {
      const json = JSON.stringify(data, null, 2);
      if (fs.promises && typeof fs.promises.writeFile === "function") {
        return fs.promises.writeFile(this.cachePath, json, "utf8")
          .then(() => ({ success: true }))
          .catch((error) => {
            console.error("Error saving cache:", error);
            return { success: false, error: error.message };
          });
      }
      fs.writeFileSync(this.cachePath, json, "utf8");
      return { success: true };
    } catch (error) {
      console.error("Error saving cache:", error);
      return { success: false, error: error.message };
    }
  }

  clearCache() {
    try {
      if (fs.existsSync(this.cachePath)) {
        fs.unlinkSync(this.cachePath);
      }
      return { success: true };
    } catch (error) {
      console.error("Error clearing cache:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new CacheService();
