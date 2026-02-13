// ============================================================================
// Tasks Service — tasksService.js
// ============================================================================
// Manages persistent task lists stored as a JSON file in the Electron
// userData directory (e.g., %APPDATA%/kalendar/tasks.json).
//
// Runs in the main process. The renderer communicates with this service
// through IPC handlers registered in main.js.
// ============================================================================

const electron = require("electron");
const fs = require("fs");
const path = require("path");

class TasksService {
  constructor() {
    const userDataPath = (electron.app || electron.remote.app).getPath(
      "userData"
    );
    this.tasksPath = path.join(userDataPath, "tasks.json");
    this.taskLists = this.loadTasks();
  }

  /** Reads task lists from disk, or returns an empty array if none exist. */
  loadTasks() {
    try {
      if (fs.existsSync(this.tasksPath)) {
        const data = fs.readFileSync(this.tasksPath, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading tasks:", error);
    }
    return [];
  }

  /** Overwrites the task lists on disk with the provided array. */
  saveTasks(taskLists) {
    try {
      this.taskLists = taskLists;
      if (fs.promises && typeof fs.promises.writeFile === "function") {
        return fs.promises
          .writeFile(
            this.tasksPath,
            JSON.stringify(this.taskLists, null, 2),
            "utf8"
          )
          .then(() => ({ success: true }))
          .catch((error) => {
            console.error("Error saving tasks:", error);
            return { success: false, error: error.message };
          });
      }

      // Fallback to sync write
      fs.writeFileSync(
        this.tasksPath,
        JSON.stringify(this.taskLists, null, 2),
        "utf8"
      );
      return { success: true };
    } catch (error) {
      console.error("Error saving tasks:", error);
      return { success: false, error: error.message };
    }
  }

  /** Returns the in-memory task lists (no disk read). */
  getTasks() {
    return this.taskLists;
  }
}

module.exports = new TasksService();
