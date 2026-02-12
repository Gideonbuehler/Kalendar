// ============================================================================
// EventModal Component — EventModal.js
// ============================================================================
// Nextcloud-inspired modal for creating and editing calendar events.
// Features:
//   - Calendar color dot + dropdown selector in header
//   - Split date/time inputs (separate <input type="date"> and <input type="time">)
//   - Icon-prefixed fields for location (📍) and description (📝)
//   - Calendar-colored save button for visual association
//   - Invalid Date guard on all date/time change handlers
//
// CSS class prefix: em-* (event modal) to avoid conflicts with base modal styles.
// ============================================================================

class EventModal extends React.Component {
  /**
   * _getCalColor — Resolves the color for the currently selected calendar.
   * Looks up by URL in the calendars array, falling back to a hash-based color.
   */
  _getCalColor() {
    const { newEvent, calendars } = this.props;
    const url = newEvent.calendarUrl || (calendars && calendars.length > 0 ? calendars[0].url : "");
    if (calendars) {
      const cal = calendars.find((c) => c.url === url);
      if (cal) {
        if (cal.color) return cal.color;
        // Hash-based fallback
        const colors = ["#5e72e4","#11cdef","#2dce89","#fb6340","#f5365c","#ffd600","#8965e0","#f3a4b5"];
        const name = cal.displayName || "";
        const idx = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        return colors[idx % colors.length];
      }
    }
    return "#5e72e4";
  }

  /**
   * render — Builds the modal layout.
   * Structure: overlay → modal → form → [header, body, footer]
   *
   * Date handling: formatDateTimeLocal() returns "YYYY-MM-DDTHH:MM",
   * which is split into separate date and time parts for the two inputs.
   * On change, makeDate() recombines them and calls onDateChange().
   */
  render() {
    const { newEvent, calendars, onSubmit, onClose, onInputChange, onDateChange, onCalendarChange, isLoading, isEditMode } = this.props;

    // Resolve calendar color for the header dot and save button
    const calColor = this._getCalColor();

    // Split ISO datetime strings into separate date and time parts
    // e.g., "2024-01-15T14:30" → date="2024-01-15", time="14:30"
    const startVal = formatDateTimeLocal(newEvent.start) || "";
    const endVal = formatDateTimeLocal(newEvent.end) || "";
    const startDate = startVal.split("T")[0] || "";
    const startTime = startVal.split("T")[1] || "";
    const endDate = endVal.split("T")[0] || "";
    const endTime = endVal.split("T")[1] || "";

    // Helper: recombines separate date + time strings into a single Date object
    // Returns null if either part is missing (prevents Invalid Date)
    const makeDate = (dateStr, timeStr) => {
      if (dateStr && timeStr) return new Date(`${dateStr}T${timeStr}`);
      return null;
    };

    return h(
      "div",
      { className: "modal-overlay" },
      h(
        "div",
        { className: "modal event-modal" },
        h(
          "form",
          { onSubmit: onSubmit },

          // ── Header: Calendar dot + selector + close ──
          h(
            "div",
            { className: "em-header" },
            h(
              "div",
              { className: "em-cal-picker" },
              h("span", {
                className: "em-cal-dot",
                style: { backgroundColor: calColor },
              }),
              h(
                "select",
                {
                  name: "calendarUrl",
                  value:
                    newEvent.calendarUrl ||
                    (calendars && calendars.length > 0 ? calendars[0].url : ""),
                  onChange: onCalendarChange || onInputChange,
                  required: true,
                  disabled: isLoading || isEditMode,
                  className: "em-cal-select",
                },
                calendars && calendars.length > 0
                  ? calendars
                      .filter(
                        (cal) =>
                          !cal.components || cal.components.includes("VEVENT")
                      )
                      .map((cal) =>
                        h(
                          "option",
                          { key: cal.url, value: cal.url },
                          cal.displayName || cal.name || "Unnamed Calendar"
                        )
                      )
                  : h("option", { value: "" }, "No calendars available")
              )
            ),
            h(
              "button",
              {
                type: "button",
                className: "em-close",
                onClick: onClose,
                disabled: isLoading,
                "aria-label": "Close",
              },
              "×"
            )
          ),

          // ── Body ──
          h(
            "div",
            { className: "em-body" },

            // Title — large prominent input
            h("input", {
              type: "text",
              name: "title",
              className: "em-title-input",
              value: newEvent.title,
              onChange: onInputChange,
              placeholder: "Event title",
              required: true,
              autoFocus: true,
              disabled: isLoading,
              style: { borderLeftColor: calColor },
            }),

            // ── Date / Time rows ──
            h(
              "div",
              { className: "em-datetime-section" },
              // From row
              h(
                "div",
                { className: "em-dt-row" },
                h("span", { className: "em-dt-label" }, "From"),
                h("input", {
                  type: "date",
                  className: "em-date-input",
                  value: startDate,
                  onChange: (e) => {
                    const d = makeDate(e.target.value, startTime);
                    if (d && !isNaN(d.getTime())) onDateChange("start", d);
                  },
                  required: true,
                  disabled: isLoading,
                }),
                h("input", {
                  type: "time",
                  className: "em-time-input",
                  value: startTime,
                  onChange: (e) => {
                    const d = makeDate(startDate, e.target.value);
                    if (d && !isNaN(d.getTime())) onDateChange("start", d);
                  },
                  required: true,
                  disabled: isLoading,
                })
              ),
              // To row
              h(
                "div",
                { className: "em-dt-row" },
                h("span", { className: "em-dt-label" }, "To"),
                h("input", {
                  type: "date",
                  className: "em-date-input",
                  value: endDate,
                  onChange: (e) => {
                    const d = makeDate(e.target.value, endTime);
                    if (d && !isNaN(d.getTime())) onDateChange("end", d);
                  },
                  required: true,
                  disabled: isLoading,
                }),
                h("input", {
                  type: "time",
                  className: "em-time-input",
                  value: endTime,
                  onChange: (e) => {
                    const d = makeDate(endDate, e.target.value);
                    if (d && !isNaN(d.getTime())) onDateChange("end", d);
                  },
                  required: true,
                  disabled: isLoading,
                })
              )
            ),

            // ── Location ──
            h(
              "div",
              { className: "em-field-row" },
              h("span", { className: "em-field-icon" }, "📍"),
              h("input", {
                type: "text",
                name: "location",
                className: "em-field-input",
                value: newEvent.location,
                onChange: onInputChange,
                placeholder: "Add a location",
                disabled: isLoading,
              })
            ),

            // ── Description ──
            h(
              "div",
              { className: "em-field-row em-field-row--top" },
              h("span", { className: "em-field-icon" }, "📝"),
              h("textarea", {
                name: "description",
                className: "em-field-input em-desc",
                value: newEvent.description,
                onChange: onInputChange,
                placeholder: "Add a description",
                rows: 3,
                disabled: isLoading,
              })
            )
          ),

          // ── Footer ──
          h(
            "div",
            { className: "em-footer" },
            h(
              "button",
              {
                type: "button",
                className: "em-btn em-btn--secondary",
                onClick: onClose,
                disabled: isLoading,
              },
              "Cancel"
            ),
            h(
              "button",
              {
                type: "submit",
                className: "em-btn em-btn--primary",
                disabled: isLoading,
                style: { background: calColor },
              },
              isLoading
                ? "…"
                : h(
                    React.Fragment,
                    null,
                    h("span", null, "✓"),
                    isEditMode ? "Save" : "Create"
                  )
            )
          )
        )
      )
    );
  }
}

window.EventModal = EventModal;
