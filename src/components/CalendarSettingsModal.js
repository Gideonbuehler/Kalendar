// Calendar Settings Modal Component
class CalendarSettingsModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      activeTab: "general", // 'general' or 'sharing'
      selectedColor: props.calendar?.color || "#5e72e4",
      calendarName: props.calendar?.displayName || "",
      shareEmail: "",
      sharePermission: "read", // 'read' or 'write'
      shares: props.calendar?.shares || [],
    };
  }

  handleColorChange = (color) => {
    this.setState({ selectedColor: color });
  };

  handleNameChange = (e) => {
    this.setState({ calendarName: e.target.value });
  };

  handleSaveColor = () => {
    const { calendar, onUpdateColor } = this.props;
    if (onUpdateColor) {
      onUpdateColor(calendar.url, this.state.selectedColor);
    }
  };

  handleSaveName = () => {
    const { calendar, onUpdateName } = this.props;
    if (onUpdateName) {
      onUpdateName(calendar.url, this.state.calendarName);
    }
  };

  handleAddShare = () => {
    const { shareEmail, sharePermission } = this.state;
    if (!shareEmail) {
      alert("Please enter an email address");
      return;
    }

    if (!this.isValidEmail(shareEmail)) {
      alert("Please enter a valid email address");
      return;
    }

    const { calendar, onAddShare } = this.props;
    if (onAddShare) {
      onAddShare(calendar.url, shareEmail, sharePermission);
      this.setState({ shareEmail: "", sharePermission: "read" });
    }
  };

  handleRemoveShare = (shareId) => {
    const { calendar, onRemoveShare } = this.props;
    if (onRemoveShare && confirm("Remove this share?")) {
      onRemoveShare(calendar.url, shareId);
    }
  };

  isValidEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };
  render() {
    const { calendar, onClose } = this.props;
    const {
      activeTab,
      selectedColor,
      calendarName,
      shareEmail,
      sharePermission,
      shares,
    } = this.state;

    const colors = [
      "#5e72e4",
      "#11cdef",
      "#2dce89",
      "#fb6340",
      "#f5365c",
      "#ffd600",
      "#172b4d",
      "#8965e0",
      "#ff6b6b",
      "#4ecdc4",
      "#45b7d1",
      "#f7b731",
      "#5f27cd",
      "#00d2d3",
      "#ff9ff3",
      "#54a0ff",
    ];

    return React.createElement(
      "div",
      { className: "modal-overlay", onClick: onClose },
      React.createElement(
        "div",
        {
          className: "modal calendar-settings-modal",
          onClick: (e) => e.stopPropagation(),
        },
        React.createElement(
          "div",
          { className: "modal-header" },
          React.createElement("h2", null, "⚙️ Calendar Settings"),
          React.createElement(
            "div",
            { className: "calendar-name-preview" },
            React.createElement("span", {
              className: "color-dot",
              style: { backgroundColor: selectedColor },
            }),
            React.createElement(
              "span",
              null,
              calendar?.displayName || "Calendar"
            )
          ),
          React.createElement(
            "button",
            {
              className: "close-button",
              onClick: onClose,
              "aria-label": "Close",
            },
            "×"
          )
        ), // Tabs (Sharing disabled temporarily due to Nextcloud API compatibility issues)
        React.createElement(
          "div",
          { className: "settings-tabs" },
          React.createElement(
            "button",
            {
              className: `tab ${activeTab === "general" ? "active" : ""}`,
              onClick: () => this.setState({ activeTab: "general" }),
            },
            "🎨 General"
          ),
          //Sharing tab temporarily disabled - requires Nextcloud-specific configuration
          React.createElement(
            "button",
            {
              className: `tab ${activeTab === "sharing" ? "active" : ""}`,
              onClick: () => this.setState({ activeTab: "sharing" }),
            },
            "👥 Sharing"
          )
        ),

        React.createElement(
          "div",
          { className: "modal-body" },

          // General Tab
          activeTab === "general" &&
            React.createElement(
              "div",
              { className: "settings-content" },
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Calendar Name"),
                React.createElement("input", {
                  type: "text",
                  value: calendarName,
                  onChange: this.handleNameChange,
                  className: "calendar-name-input",
                  placeholder: "Enter calendar name",
                })
              ),
              React.createElement(
                "button",
                {
                  className: "btn-primary",
                  onClick: this.handleSaveName,
                  style: { marginBottom: "1rem" },
                },
                "Save Name"
              ),
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Color"),
                React.createElement(
                  "div",
                  { className: "color-picker-grid" },
                  colors.map((color) =>
                    React.createElement(
                      "div",
                      {
                        key: color,
                        className: `color-option ${
                          selectedColor === color ? "selected" : ""
                        }`,
                        style: { backgroundColor: color },
                        onClick: () => this.handleColorChange(color),
                        title: color,
                      },
                      selectedColor === color &&
                        React.createElement(
                          "span",
                          { className: "checkmark" },
                          "✓"
                        )
                    )
                  )
                )
              ),
              React.createElement(
                "button",
                {
                  className: "btn-primary",
                  onClick: this.handleSaveColor,
                  style: { marginTop: "1rem" },
                },
                "Save Color"
              )
            ),

          // Sharing Tab
          activeTab === "sharing" &&
            React.createElement(
              "div",
              { className: "settings-content" },
              React.createElement(
                "div",
                { className: "share-info" },
                React.createElement(
                  "p",
                  null,
                  "Share this calendar with other users. They will receive an invitation to access your calendar."
                )
              ),
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Share with"),
                React.createElement(
                  "div",
                  { className: "share-input-group" },
                  React.createElement("input", {
                    type: "email",
                    placeholder: "user@example.com",
                    value: shareEmail,
                    onChange: (e) =>
                      this.setState({ shareEmail: e.target.value }),
                    onKeyPress: (e) => {
                      if (e.key === "Enter") {
                        this.handleAddShare();
                      }
                    },
                  }),
                  React.createElement(
                    "select",
                    {
                      value: sharePermission,
                      onChange: (e) =>
                        this.setState({ sharePermission: e.target.value }),
                    },
                    React.createElement(
                      "option",
                      { value: "read" },
                      "Can view"
                    ),
                    React.createElement(
                      "option",
                      { value: "write" },
                      "Can edit"
                    )
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "btn-primary",
                      onClick: this.handleAddShare,
                    },
                    "Share"
                  )
                )
              ),
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Shared with"),
                React.createElement(
                  "div",
                  { className: "shares-list" },
                  shares.length === 0
                    ? React.createElement(
                        "p",
                        { className: "no-shares" },
                        "Not shared with anyone yet"
                      )
                    : shares.map((share, index) =>
                        React.createElement(
                          "div",
                          { key: index, className: "share-item" },
                          React.createElement(
                            "div",
                            { className: "share-info-row" },
                            React.createElement(
                              "span",
                              { className: "share-email" },
                              share.email || share.principal
                            ),
                            React.createElement(
                              "span",
                              { className: "share-permission" },
                              share.permission === "write"
                                ? "✏️ Can edit"
                                : "👁️ Can view"
                            )
                          ),
                          React.createElement(
                            "button",
                            {
                              className: "btn-icon-small",
                              onClick: () =>
                                this.handleRemoveShare(share.id || index),
                              title: "Remove share",
                            },
                            "🗑️"
                          )
                        )
                      )
                )
              )
            )
        ),

        React.createElement(
          "div",
          { className: "modal-footer" },
          React.createElement(
            "button",
            { className: "btn-secondary", onClick: onClose },
            "Close"
          )
        )
      )
    );
  }
}

window.CalendarSettingsModal = CalendarSettingsModal;
