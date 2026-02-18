// ============================================================================
// EventModal Component — EventModal.js
// ============================================================================
// Nextcloud-inspired modal for creating and editing calendar events.
// Manages its own local form state to avoid triggering root re-renders on
// every keystroke. Only communicates with the parent on submit/close.
//
// CSS class prefix: em-* (event modal) to avoid conflicts with base modal styles.
// ============================================================================

class EventModal extends React.Component {
  constructor(props) {
    super(props);
    // Initialize local form state from props — all changes stay local until submit
    const ev = props.newEvent || {};
    this.state = {
      title: ev.title || "",
      start: ev.start || new Date(),
      end: ev.end || new Date(),
      description: ev.description || "",
      location: ev.location || "",
      calendarUrl: ev.calendarUrl || (props.calendars && props.calendars.length > 0 ? props.calendars[0].url : ""),
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    return (
      this.state.title !== nextState.title ||
      this.state.start !== nextState.start ||
      this.state.end !== nextState.end ||
      this.state.description !== nextState.description ||
      this.state.location !== nextState.location ||
      this.state.calendarUrl !== nextState.calendarUrl ||
      this.props.isLoading !== nextProps.isLoading ||
      this.props.calendars !== nextProps.calendars
    );
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

  _handleDateChange = (field, date) => {
    this.setState({ [field]: date });
  };

  _handleSubmit = (e) => {
    e.preventDefault();
    // Pass local form state up to parent on submit
    if (this.props.onSubmit) {
      this.props.onSubmit({
        title: this.state.title,
        start: this.state.start,
        end: this.state.end,
        description: this.state.description,
        location: this.state.location,
        calendarUrl: this.state.calendarUrl,
      });
    }
  };

  render() {
    const { calendars, onClose, isLoading, isEditMode } = this.props;
    const { title, start, end, description, location, calendarUrl } = this.state;

    const calColor = this._getCalColor();

    const startVal = formatDateTimeLocal(start) || "";
    const endVal = formatDateTimeLocal(end) || "";
    const startDate = startVal.split("T")[0] || "";
    const startTime = startVal.split("T")[1] || "";
    const endDate = endVal.split("T")[0] || "";
    const endTime = endVal.split("T")[1] || "";

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
          { onSubmit: this._handleSubmit },

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
              value: title,
              onChange: this._handleInputChange,
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
                    if (d && !isNaN(d.getTime())) this._handleDateChange("start", d);
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
                    if (d && !isNaN(d.getTime())) this._handleDateChange("start", d);
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
                    if (d && !isNaN(d.getTime())) this._handleDateChange("end", d);
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
                    if (d && !isNaN(d.getTime())) this._handleDateChange("end", d);
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
                value: location,
                onChange: this._handleInputChange,
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
                value: description,
                onChange: this._handleInputChange,
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
