// Event Modal Component
class EventModal extends React.Component {
  render() {
    const {
      newEvent,
      onSubmit,
      onInputChange,
      onDateChange,
      onClose,
      formatDateTimeLocal,
      isLoading,
      isEditMode,
      calendars,
      selectedCalendarIds,
      onCalendarChange,
    } = this.props;

    return h(
      "div",
      { className: "modal-overlay" },
      h(
        "div",
        { className: "modal event-modal" },
        h(
          "div",
          { className: "modal-header" },
          h("h2", null, isEditMode ? "✏️ Edit Event" : "✨ Create New Event"),
          h(
            "button",
            {
              className: "close-button",
              onClick: onClose,
              disabled: isLoading,
              "aria-label": "Close",
            },
            "×"
          )
        ),
        h(
          "form",
          { onSubmit: onSubmit },
          h(
            "div",
            { className: "modal-body" },
            h(
              "div",
              { className: "form-group" },
              h("label", null, "📌 Title"),
              h("input", {
                type: "text",
                name: "title",
                value: newEvent.title,
                onChange: onInputChange,
                placeholder: "Event title",
                required: true,
                autoFocus: true,
                disabled: isLoading,
              })
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "📅 Calendar"),
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
                  className: "calendar-select",
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
                          {
                            key: cal.url,
                            value: cal.url,
                          },
                          cal.displayName || cal.name || "Unnamed Calendar"
                        )
                      )
                  : h("option", { value: "" }, "No calendars available")
              )
            ),
            h(
              "div",
              { className: "form-row" },
              h(
                "div",
                { className: "form-group" },
                h("label", null, "🕐 Start"),
                h("input", {
                  type: "datetime-local",
                  value: formatDateTimeLocal(newEvent.start),
                  onChange: (e) =>
                    onDateChange("start", new Date(e.target.value)),
                  required: true,
                  disabled: isLoading,
                })
              ),
              h(
                "div",
                { className: "form-group" },
                h("label", null, "🕐 End"),
                h("input", {
                  type: "datetime-local",
                  value: formatDateTimeLocal(newEvent.end),
                  onChange: (e) =>
                    onDateChange("end", new Date(e.target.value)),
                  required: true,
                  disabled: isLoading,
                })
              )
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "📍 Location"),
              h("input", {
                type: "text",
                name: "location",
                value: newEvent.location,
                onChange: onInputChange,
                placeholder: "Add location",
                disabled: isLoading,
              })
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "📝 Description"),
              h("textarea", {
                name: "description",
                value: newEvent.description,
                onChange: onInputChange,
                placeholder: "Add description",
                rows: 4,
                disabled: isLoading,
              })
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
                disabled: isLoading,
              },
              "Cancel"
            ),
            h(
              "button",
              {
                type: "submit",
                className: "btn-primary",
                disabled: isLoading,
              },
              isLoading
                ? isEditMode
                  ? "Updating..."
                  : "Creating..."
                : isEditMode
                ? "Update Event"
                : "Create Event"
            )
          )
        )
      )
    );
  }
}

window.EventModal = EventModal;
