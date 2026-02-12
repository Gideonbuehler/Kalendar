// ============================================================================
// Settings Component — Settings.js
// ============================================================================
// Full-screen modal for configuring application preferences.
// Organized into two sections:
//   1. Appearance: Theme, primary/accent colors, font size, animations, compact mode
//   2. Calendar: First day of week, time format, default view, task duration
// Changes are applied in real-time via onSettingChange (debounced save).
// Includes a "Reset to Defaults" button.
// ============================================================================

class Settings extends React.Component {
  render() {
    const { settings, onSettingChange, onClose, onReset } = this.props;

    return h(
      "div",
      { className: "modal-overlay settings-overlay" },
      h(
        "div",
        { className: "modal settings-modal" },
        h(
          "div",
          { className: "settings-header" },
          h("h2", null, "Settings"),
          h(
            "button",
            {
              className: "close-button",
              onClick: onClose,
              "aria-label": "Close settings",
            },
            "×"
          )
        ),
        h(
          "div",
          { className: "settings-content" },
          // Appearance Section
          h(
            "div",
            { className: "settings-section" },
            h("h3", null, "Appearance"),

            // Theme
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Theme"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.theme,
                    onChange: (e) => onSettingChange("theme", e.target.value),
                  },
                  h("option", { value: "light" }, "Light"),
                  h("option", { value: "dark" }, "Dark"),
                  h("option", { value: "auto" }, "System Default")
                )
              )
            ),

            // Primary Color
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Primary Color"),
              h(
                "div",
                { className: "setting-control color-picker-group" },
                h("input", {
                  type: "color",
                  value: settings.primaryColor,
                  onChange: (e) =>
                    onSettingChange("primaryColor", e.target.value),
                  className: "color-input",
                }),
                h("input", {
                  type: "text",
                  value: settings.primaryColor,
                  onChange: (e) =>
                    onSettingChange("primaryColor", e.target.value),
                  className: "color-text",
                  pattern: "^#[0-9A-Fa-f]{6}$",
                })
              )
            ),

            // Accent Color
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Accent Color"),
              h(
                "div",
                { className: "setting-control color-picker-group" },
                h("input", {
                  type: "color",
                  value: settings.accentColor,
                  onChange: (e) =>
                    onSettingChange("accentColor", e.target.value),
                  className: "color-input",
                }),
                h("input", {
                  type: "text",
                  value: settings.accentColor,
                  onChange: (e) =>
                    onSettingChange("accentColor", e.target.value),
                  className: "color-text",
                  pattern: "^#[0-9A-Fa-f]{6}$",
                })
              )
            ),

            // Font Size
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Font Size"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.fontSize,
                    onChange: (e) =>
                      onSettingChange("fontSize", e.target.value),
                  },
                  h("option", { value: "small" }, "Small"),
                  h("option", { value: "medium" }, "Medium"),
                  h("option", { value: "large" }, "Large")
                )
              )
            ),

            // Animations
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Animations"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "label",
                  { className: "toggle-switch" },
                  h("input", {
                    type: "checkbox",
                    checked: settings.animations,
                    onChange: (e) =>
                      onSettingChange("animations", e.target.checked),
                  }),
                  h("span", { className: "toggle-slider" })
                )
              )
            ),

            // Compact Mode
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Compact Mode"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "label",
                  { className: "toggle-switch" },
                  h("input", {
                    type: "checkbox",
                    checked: settings.compactMode,
                    onChange: (e) =>
                      onSettingChange("compactMode", e.target.checked),
                  }),
                  h("span", { className: "toggle-slider" })
                )
              )
            )
          ),

          // Calendar Section
          h(
            "div",
            { className: "settings-section" },
            h("h3", null, "Calendar"),

            // First Day of Week
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "First Day of Week"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.firstDayOfWeek,
                    onChange: (e) =>
                      onSettingChange(
                        "firstDayOfWeek",
                        parseInt(e.target.value)
                      ),
                  },
                  h("option", { value: "0" }, "Sunday"),
                  h("option", { value: "1" }, "Monday")
                )
              )
            ),

            // Time Format
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Time Format"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.timeFormat,
                    onChange: (e) =>
                      onSettingChange("timeFormat", e.target.value),
                  },
                  h("option", { value: "12h" }, "12-hour (2:00 PM)"),
                  h("option", { value: "24h" }, "24-hour (14:00)")
                )
              )
            ),

            // Default View
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Default View"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.defaultView,
                    onChange: (e) =>
                      onSettingChange("defaultView", e.target.value),
                  },
                  h("option", { value: "month" }, "Month"),
                  h("option", { value: "week" }, "Week"),
                  h("option", { value: "day" }, "Day"),
                  h("option", { value: "agenda" }, "Agenda")
                )
              )
            ),

            // Default Task Duration
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Default Task Duration (minutes)"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "select",
                  {
                    value: settings.defaultTaskDuration || 15,
                    onChange: (e) =>
                      onSettingChange(
                        "defaultTaskDuration",
                        parseInt(e.target.value)
                      ),
                  },
                  h("option", { value: "5" }, "5 minutes"),
                  h("option", { value: "15" }, "15 minutes"),
                  h("option", { value: "30" }, "30 minutes"),
                  h("option", { value: "45" }, "45 minutes"),
                  h("option", { value: "60" }, "1 hour"),
                  h("option", { value: "90" }, "1.5 hours"),
                  h("option", { value: "120" }, "2 hours")
                )
              )
            ),

            // Show Week Numbers
            h(
              "div",
              { className: "setting-item" },
              h("label", null, "Show Week Numbers"),
              h(
                "div",
                { className: "setting-control" },
                h(
                  "label",
                  { className: "toggle-switch" },
                  h("input", {
                    type: "checkbox",
                    checked: settings.showWeekNumbers,
                    onChange: (e) =>
                      onSettingChange("showWeekNumbers", e.target.checked),
                  }),
                  h("span", { className: "toggle-slider" })
                )
              )
            )
          )
        ),

        h(
          "div",
          { className: "settings-footer" },
          h(
            "button",
            {
              className: "btn-secondary",
              onClick: onReset,
            },
            "Reset to Defaults"
          ),
          h(
            "button",
            {
              className: "btn-primary",
              onClick: onClose,
            },
            "Done"
          )
        )
      )
    );
  }
}

window.Settings = Settings;
