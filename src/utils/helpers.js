// ============================================================================
// Utility Functions — helpers.js
// ============================================================================
// Shared utility functions used across the renderer process.
// Exported globally via window.KalendarUtils for use in any component.
//
// Categories:
//   - Date/Time formatting (formatDateTimeLocal, formatDate, formatTime)
//   - Color utilities (hex validation, hex↔rgb conversion)
//   - Theme detection (system dark/light mode)
//   - Input validation (email, URL)
//   - LocalStorage persistence helpers
// ============================================================================

// ── Date/Time Formatting ───────────────────────────────────────────────

/**
 * Converts a Date to "YYYY-MM-DDTHH:MM" for <input type="datetime-local">.
 */
const formatDateTimeLocal = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Formats a date for display.
 * @param {'short'|'long'} format - "short" = locale default, "long" = full weekday + month
 */
const formatDate = (date, format = "short") => {
  const d = new Date(date);
  if (format === "short") {
    return d.toLocaleDateString();
  } else if (format === "long") {
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
  return d.toISOString();
};

/** Formats a time string, optionally in 24-hour format. */
const formatTime = (date, use24Hour = false) => {
  const d = new Date(date);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: !use24Hour,
  });
};

// ── Color Utilities ───────────────────────────────────────────────────

/** Validates that a string is a 6-digit hex color (e.g., "#5e72e4"). */
const isValidHexColor = (color) => {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
};

/** Converts a hex color string to an {r, g, b} object. Returns null on invalid input. */
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

/** Converts individual r, g, b values (0–255) to a hex color string. */
const rgbToHex = (r, g, b) => {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

// ── Theme Detection ──────────────────────────────────────────────────

/** Returns "dark" or "light" based on the OS-level color scheme preference. */
const getSystemTheme = () => {
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
};

// ── Validation ───────────────────────────────────────────────────────

/** Basic email format validation (not RFC 5322 compliant). */
const isValidEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/** Checks if a string is a valid URL using the native URL constructor. */
const isValidUrl = (url) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// ── Local Storage Helpers ────────────────────────────────────────────
// Used for persisting lightweight data in the renderer (e.g., saved credentials).
// For heavy/structured settings, settingsService.js (main process) is preferred.

/** Serializes a value as JSON and writes it to localStorage. */
const saveToLocalStorage = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("Error saving to localStorage:", error);
    return false;
  }
};

/** Reads and deserializes a JSON value from localStorage. Returns defaultValue if missing. */
const loadFromLocalStorage = (key, defaultValue = null) => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error("Error loading from localStorage:", error);
    return defaultValue;
  }
};

// ── Icons ────────────────────────────────────────────────────────────
// Simple monochrome line icons; the stroke follows the surrounding text color.
// Shapes adapted from Feather Icons (MIT License, https://feathericons.com).

const ICON_SHAPES = {
  calendar: [
    ["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2, ry: 2 }],
    ["line", { x1: 16, y1: 2, x2: 16, y2: 6 }],
    ["line", { x1: 8, y1: 2, x2: 8, y2: 6 }],
    ["line", { x1: 3, y1: 10, x2: 21, y2: 10 }],
  ],
  refresh: [
    ["polyline", { points: "23 4 23 10 17 10" }],
    ["path", { d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }],
  ],
  settings: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    [
      "path",
      {
        d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z",
      },
    ],
  ],
};

/** Renders a line icon: kalIcon("calendar", { size: 16, className: "..." }). */
const kalIcon = (name, { size = 16, className = "" } = {}) =>
  h(
    "svg",
    {
      className: `kal-icon ${className}`.trim(),
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
    },
    (ICON_SHAPES[name] || []).map(([tag, attrs], i) => h(tag, { key: i, ...attrs }))
  );

// Export all utilities as a global namespace for use in CDN-loaded components
if (typeof window !== "undefined") {
  window.KalendarUtils = {
    formatDateTimeLocal,
    formatDate,
    formatTime,
    isValidHexColor,
    hexToRgb,
    rgbToHex,
    getSystemTheme,
    isValidEmail,
    isValidUrl,
    saveToLocalStorage,
    loadFromLocalStorage,
  };
}
