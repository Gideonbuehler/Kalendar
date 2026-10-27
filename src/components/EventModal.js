// ============================================================================
// EventModal Component — EventModal.js
// ============================================================================
// Nextcloud-inspired modal for creating and editing calendar events.
// Manages its own local form state to avoid triggering root re-renders on
// every keystroke. Only communicates with the parent on submit/close/delete.
//
// Dates are kept as Date objects. For all-day events `start` is midnight of
// the first day and `end` is midnight after the last day (exclusive), which
// is how CalDAV stores them; the "To" field shows the last day itself.
//
// CSS class prefix: em-* (event modal) to avoid conflicts with base modal styles.
// ============================================================================

const EM_DAY_MS = 24 * 60 * 60 * 1000;

function emStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function emAddDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** "YYYY-MM-DD" and "HH:MM" parts of a date for <input type="date"/"time">. */
function emSplit(date) {
  const value = formatDateTimeLocal(date) || "";
  return { date: value.split("T")[0] || "", time: value.split("T")[1] || "" };
}

function emJoin(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T${timeStr || "00:00"}`);
  return isNaN(d.getTime()) ? null : d;
}

class EventModal extends React.Component {
  constructor(props) {
    super(props);
    // Initialize local form state from props — all changes stay local until submit
    const ev = props.newEvent || {};
    const start = new Date(ev.start || new Date());
    let end = new Date(ev.end || start);
    const allDay = !!ev.allDay;
    if (allDay && end <= start) end = emAddDays(emStartOfDay(start), 1);

    this.state = {
      title: ev.title || "",
      start,
      end,
      allDay,
      description: ev.description || "",
      location: ev.location || "",
      calendarUrl: ev.calendarUrl || (props.calendars && props.calendars.length > 0 ? props.calendars[0].url : ""),
      scope: "occurrence", // For recurring events: "occurrence" | "series"
    };
    this._original = { start, end, allDay };
    this._lastTimed = allDay ? null : { start, end }; // Restored when unticking "All day"
  }

  /**
   * _getCalColor — Resolves the color for the currently selected calendar.
   * Looks up by URL in the calendars array, falling back to a hash-based color.
   */
  _getCalColor() {
    const { calendars } = this.props;
    const url = this.state.calendarUrl || (calendars && calendars.length > 0 ? calendars[0].url : "");
    if (calendars) {
      const cal = calendars.find((c) => c.url === url);
      if (cal) {
        if (cal.color) return cal.color;
        const colors = ["#5e72e4","#11cdef","#2dce89","#fb6340","#f5365c","#ffd600","#8965e0","#f3a4b5"];
        const name = cal.displayName || "";
        const idx = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        return colors[idx % colors.length];
      }
    }
    return "#5e72e4";
  }

  _handleInputChange = (e) => {
    const { name, value } = e.target;
    this.setState({ [name]: value });
  };

  _handleCalendarChange = (e) => {
    this.setState({ calendarUrl: e.target.value });
  };

  /** Moving the start moves the end too, so the event keeps its length. */
  _setStart(newStart) {
    if (!newStart) return;
    this.setState((s) => {
      const duration = s.end - s.start;
      return { start: newStart, end: new Date(newStart.getTime() + Math.max(duration, 0)) };
    });
  }

  _setEnd(newEnd) {
    if (!newEnd) return;
    this.setState({ end: newEnd });
  }

  _handleAllDayChange = (e) => {
    const allDay = e.target.checked;
    this.setState((s) => {
      if (allDay) {
        this._lastTimed = { start: s.start, end: s.end };
        const start = emStartOfDay(s.start);
        // The last day the timed event touches (an end at exactly midnight doesn't count)
        const lastDay = emStartOfDay(new Date(Math.max(s.end - 1, s.start)));
        return { allDay, start, end: emAddDays(lastDay, 1) };
      }
      const day = emStartOfDay(s.start);
      if (this._lastTimed && emStartOfDay(this._lastTimed.start).getTime() === day.getTime()) {
        return { allDay, start: this._lastTimed.start, end: this._lastTimed.end };
      }
      const start = new Date(day);
      start.setHours(9, 0, 0, 0);
      return { allDay, start, end: new Date(start.getTime() + 60 * 60000) };
    });
  };

  _handleScopeChange = (e) => {
    const scope = e.target.value;
    // Turning a whole series into all-day (or back) isn't supported
    if (scope === "series" && this.state.allDay !== this._original.allDay) {
      this.setState({ scope, allDay: this._original.allDay, start: this._original.start, end: this._original.end });
    } else {
      this.setState({ scope });
    }
  };

  /** Returns a message when the dates are invalid, otherwise null. */
  _validate() {
    const { start, end, allDay } = this.state;
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return "Please enter a valid date.";
    if (end <= start) {
      return allDay ? "The end date can't be before the start date." : "The event must end after it starts.";
    }
    return null;
  }

  _handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (this._validate() || !this.state.title.trim()) return;
    // Pass local form state up to parent on submit
    if (this.props.onSubmit) {
      this.props.onSubmit({
        title: this.state.title.trim(),
        start: this.state.start,
        end: this.state.end,
        allDay: this.state.allDay,
        description: this.state.description,
        location: this.state.location,
        calendarUrl: this.state.calendarUrl,
        scope: this.state.scope,
      });
    }
  };

  // Ctrl/Cmd+Enter saves from anywhere in the form (including the description)
  _handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this._handleSubmit();
    }
  };

  _handleDelete = () => {
    const { isRecurring, onDelete } = this.props;
    if (!onDelete) return;
    const title = this.state.title || "this event";
    const message = !isRecurring
      ? `Delete "${title}"?`
      : this.state.scope === "series"
      ? `Delete ALL occurrences of "${title}"?`
      : `Delete this occurrence of "${title}"?`;
    if (confirm(message)) onDelete(this.state.scope);
  };

  render() {
    const { calendars, onClose, isEditMode, isRecurring, onDelete } = this.props;
    const { title, start, end, allDay, description, location, calendarUrl, scope } = this.state;

    const calColor = this._getCalColor();
    const error = this._validate();

    const startParts = emSplit(start);
    // All-day events show their last day, not the exclusive end
    const endParts = emSplit(allDay ? new Date(end.getTime() - EM_DAY_MS / 2) : end);

    return h(
      "div",
      { className: "modal-overlay" },
      h(
        "div",
        { className: "modal event-modal" },
        h(
          "form",
          { onSubmit: this._handleSubmit, onKeyDown: this._handleKeyDown },

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
                  value: calendarUrl || (calendars && calendars.length > 0 ? calendars[0].url : ""),
                  onChange: this._handleCalendarChange,
                  required: true,
                  disabled: isEditMode,
                  title: isEditMode ? "Events can't be moved to another calendar" : "Calendar",
                  className: "em-cal-select",
                },
                calendars && calendars.length > 0
                  ? calendars.map((cal) =>
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
                "aria-label": "Close",
                title: "Close (Esc)",
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
              value: title,
              onChange: this._handleInputChange,
              placeholder: "Event title",
              required: true,
              autoFocus: true,
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
                  value: startParts.date,
                  onChange: (e) => this._setStart(emJoin(e.target.value, startParts.time)),
                  required: true,
                }),
                !allDay &&
                  h("input", {
                    type: "time",
                    className: "em-time-input",
                    value: startParts.time,
                    onChange: (e) => this._setStart(emJoin(startParts.date, e.target.value)),
                    required: true,
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
                  value: endParts.date,
                  onChange: (e) => {
                    const d = emJoin(e.target.value, allDay ? "00:00" : endParts.time);
                    this._setEnd(d && allDay ? emAddDays(d, 1) : d);
                  },
                  required: true,
                }),
                !allDay &&
                  h("input", {
                    type: "time",
                    className: "em-time-input",
                    value: endParts.time,
                    onChange: (e) => this._setEnd(emJoin(endParts.date, e.target.value)),
                    required: true,
                  })
              ),
              h(
                "label",
                { className: "em-allday" },
                h("input", {
                  type: "checkbox",
                  checked: allDay,
                  onChange: this._handleAllDayChange,
                  disabled: isRecurring && scope === "series",
                }),
                "All day"
              ),
              error && h("div", { className: "em-error", role: "alert" }, error)
            ),

            // ── Recurring events: which occurrences to change ──
            isRecurring &&
              h(
                "div",
                { className: "em-scope" },
                h("span", { className: "em-scope-label" }, "Repeating event. Apply changes to:"),
                h(
                  "label",
                  null,
                  h("input", {
                    type: "radio",
                    name: "scope",
                    value: "occurrence",
                    checked: scope === "occurrence",
                    onChange: this._handleScopeChange,
                  }),
                  "This occurrence"
                ),
                h(
                  "label",
                  null,
                  h("input", {
                    type: "radio",
                    name: "scope",
                    value: "series",
                    checked: scope === "series",
                    onChange: this._handleScopeChange,
                  }),
                  "All occurrences"
                )
              ),

            // ── Location ──
            h(
              "div",
              { className: "em-field-row" },
              h("input", {
                type: "text",
                name: "location",
                className: "em-field-input",
                value: location,
                onChange: this._handleInputChange,
                placeholder: "Add a location",
              })
            ),

            // ── Description ──
            h(
              "div",
              { className: "em-field-row em-field-row--top" },
              h("textarea", {
                name: "description",
                className: "em-field-input em-desc",
                value: description,
                onChange: this._handleInputChange,
                placeholder: "Add a description",
                rows: 3,
              })
            )
          ),

          // ── Footer ──
          h(
            "div",
            { className: "em-footer" },
            isEditMode &&
              onDelete &&
              h(
                "button",
                {
                  type: "button",
                  className: "em-btn em-btn--danger",
                  onClick: this._handleDelete,
                },
                "Delete"
              ),
            h(
              "button",
              {
                type: "button",
                className: "em-btn em-btn--secondary",
                onClick: onClose,
              },
              "Cancel"
            ),
            h(
              "button",
              {
                type: "submit",
                className: "em-btn em-btn--primary",
                disabled: !!error,
                title: "Save (Ctrl+Enter)",
                style: { background: calColor },
              },
              isEditMode ? "Save" : "Create"
            )
          )
        )
      )
    );
  }
}

window.EventModal = EventModal;
