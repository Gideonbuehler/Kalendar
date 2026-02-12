// ============================================================================
// CreateCalendarModal Component — CreateCalendarModal.js
// ============================================================================
// Simple modal for creating a new calendar on the Nextcloud server.
// Collects a name and color (from a preset palette), then delegates
// to the parent's onSubmit handler which calls the CalDAV MKCALENDAR API.
// ============================================================================

class CreateCalendarModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      calendarName: "",
      calendarColor: "#5e72e4",
      isCreating: false,
      error: "",
    };
  }

  handleSubmit = (e) => {
    e.preventDefault();
    const { calendarName, calendarColor } = this.state;

    if (!calendarName.trim()) {
      this.setState({ error: "Calendar name is required" });
      return;
    }

    this.props.onSubmit(calendarName.trim(), calendarColor);
  };

  render() {
    const { onClose } = this.props;
    const { calendarName, calendarColor, error } = this.state;

    const colorOptions = [
      { value: "#5e72e4", name: "Blue" },
      { value: "#11cdef", name: "Cyan" },
      { value: "#2dce89", name: "Green" },
      { value: "#fb6340", name: "Orange" },
      { value: "#f5365c", name: "Red" },
      { value: "#ffd600", name: "Yellow" },
      { value: "#172b4d", name: "Dark Blue" },
      { value: "#8965e0", name: "Purple" },
    ];

    return h(
      "div",
      { className: "modal-overlay" },
      h(
        "div",
        { className: "modal create-calendar-modal" },
        h(
          "div",
          { className: "modal-header" },
          h("h2", null, "Create New Calendar"),
          h(
            "button",
            {
              className: "close-button",
              onClick: onClose,
              "aria-label": "Close",
            },
            "×"
          )
        ),
        h(
          "form",
          { onSubmit: this.handleSubmit },
          h(
            "div",
            { className: "modal-body" },
            error &&
              h(
                "div",
                { className: "error-message", style: { marginBottom: "1rem" } },
                error
              ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "📝 Calendar Name"),
              h("input", {
                type: "text",
                value: calendarName,
                onChange: (e) =>
                  this.setState({ calendarName: e.target.value, error: "" }),
                placeholder: "e.g., Work, Personal, Family",
                required: true,
                autoFocus: true,
              })
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "🎨 Calendar Color"),
              h(
                "div",
                { className: "color-picker-grid" },
                colorOptions.map((color) =>
                  h(
                    "label",
                    {
                      key: color.value,
                      className: `color-option ${
                        calendarColor === color.value ? "selected" : ""
                      }`,
                      title: color.name,
                    },
                    h("input", {
                      type: "radio",
                      name: "calendarColor",
                      value: color.value,
                      checked: calendarColor === color.value,
                      onChange: (e) =>
                        this.setState({ calendarColor: e.target.value }),
                    }),
                    h("span", {
                      className: "color-swatch",
                      style: { backgroundColor: color.value },
                    })
                  )
                )
              )
            ),
            h(
              "div",
              { className: "info-message" },
              h("span", null, "💡 "),
              "Calendars are created on your Nextcloud server and will sync across all devices."
            )
          ),
          h(
            "div",
            { className: "modal-footer" },
            h(
              "button",
              {
                type: "button",
                className: "btn-secondary",
                onClick: onClose,
              },
              "Cancel"
            ),
            h(
              "button",
              {
                type: "submit",
                className: "btn-primary",
              },
              "Create Calendar"
            )
          )
        )
      )
    );
  }
}

window.CreateCalendarModal = CreateCalendarModal;
