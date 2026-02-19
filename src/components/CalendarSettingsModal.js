// ============================================================================
// CalendarSettingsModal Component — CalendarSettingsModal.js
// ============================================================================
// Per-calendar settings modal with two tabs:
//   1. General: Rename calendar, change color (16-color palette)
//   2. Sharing: Share with other Nextcloud users (read/write permissions)
// ============================================================================

class CalendarSettingsModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      activeTab: "general", // 'general' or 'sharing'
      selectedColor: props.calendar?.color || "#5e72e4",
      calendarName: props.calendar?.displayName || "",
      shareUser: "",
      sharePermission: "read", // 'read' or 'write'
      shares: props.calendar?.shares || [],
      searchResults: [],
      showSuggestions: false,
      isSearching: false,
    };
    this._searchTimeout = null;
  }

  // Update shares when parent fetches them from server
  static getDerivedStateFromProps(nextProps, prevState) {
    const newShares = nextProps.calendar?.shares || [];
    if (newShares.length !== prevState.shares.length) {
      return { shares: newShares };
    }
    return null;
  }

  componentWillUnmount() {
    if (this._searchTimeout) clearTimeout(this._searchTimeout);
  }

  // Handle change in calendar color
  handleColorChange = (color) => {
    this.setState({ selectedColor: color });
  };
  // Handle change in calendar name
  handleNameChange = (e) => {
    this.setState({ calendarName: e.target.value });
  };
  // Handle save for calendar color
  handleSaveColor = () => {
    const { calendar, onUpdateColor } = this.props;
    if (onUpdateColor) {
      onUpdateColor(calendar.url, this.state.selectedColor);
    }
  };
  // Handle save for calendar name
  handleSaveName = () => {
    const { calendar, onUpdateName } = this.props;
    if (onUpdateName) {
      onUpdateName(calendar.url, this.state.calendarName);
    }
  };

  // Handle typing in the share input — triggers debounced user search
  handleShareInputChange = (e) => {
    const value = e.target.value;
    this.setState({ shareUser: value });

    if (this._searchTimeout) clearTimeout(this._searchTimeout);

    if (value.length >= 2 && this.props.onSearchUsers) {
      this.setState({ isSearching: true });
      this._searchTimeout = setTimeout(async () => {
        const users = await this.props.onSearchUsers(value);
        this.setState({
          searchResults: users || [],
          showSuggestions: (users || []).length > 0,
          isSearching: false,
        });
      }, 300);
    } else {
      this.setState({ searchResults: [], showSuggestions: false, isSearching: false });
    }
  };

  // Select a user from the suggestions dropdown
  handleSelectUser = (username) => {
    this.setState({ shareUser: username, showSuggestions: false, searchResults: [] });
  };

  // Handle adding a new share — accepts Nextcloud username or email
  handleAddShare = () => {
    const { shareUser, sharePermission } = this.state;
    if (!shareUser) {
      alert("Please enter a Nextcloud username or email address");
      return;
    }

    if (!this.isValidShareTarget(shareUser)) {
      alert("Please enter a valid Nextcloud username or email address");
      return;
    }

    const { calendar, onAddShare } = this.props;
    if (onAddShare) {
      onAddShare(calendar.url, shareUser, sharePermission);
      this.setState({ shareUser: "", sharePermission: "read", showSuggestions: false, searchResults: [] });
    }
  };

  handleRemoveShare = (shareId) => {
    const { calendar, onRemoveShare } = this.props;
    if (onRemoveShare && confirm("Remove this share?")) {
      onRemoveShare(calendar.url, shareId);
    }
  };

  // Accept Nextcloud usernames (alphanumeric, dots, dashes, underscores) or emails
  isValidShareTarget = (input) => {
    if (input.includes("@")) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
    }
    return /^[a-zA-Z0-9._-]+$/.test(input);
  };

  /**
   * handleDeleteCalendar — Triggers calendar deletion after user confirmation.
   * Prompts the user with a confirmation dialog showing the calendar name.
   * If confirmed, calls the onDeleteCalendar callback passed via props.
   * This callback is handled by the parent KalendarApp component.
   */
  handleDeleteCalendar = () => {
    const { calendar, onDeleteCalendar } = this.props;
    if (
      confirm(
        `Are you sure you want to delete "${calendar?.displayName || "Calendar"}"? This cannot be undone.`
      )
    ) {
      if (onDeleteCalendar) {
        onDeleteCalendar(calendar.url);
      }
    }
  };
  render() {
    const { calendar, onClose } = this.props;
    const {
      activeTab,
      selectedColor,
      calendarName,
      shareUser,
      sharePermission,
      shares,
      searchResults,
      showSuggestions,
      isSearching,
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
    // Settings modal for calendar name, color, and sharing with other Nextcloud users
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
        ),
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
                  style: { marginTop: "1rem", marginBottom: "2rem" },
                },
                "Save Color"
              ),
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Delete Calendar"),
                React.createElement(
                  "p",
                  { style: { fontSize: "0.85rem", color: "var(--text-tertiary)", marginBottom: "0.5rem" } },
                  "⚠️ This action cannot be undone. The calendar will be permanently deleted."
                ),
                React.createElement(
                  "button",
                  {
                    className: "btn-danger",
                    onClick: this.handleDeleteCalendar,
                    style: { width: "100%", marginTop: "0.5rem" },
                  },
                  "🗑️ Delete Calendar"
                )
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
                  "Share this calendar with other Nextcloud users. Start typing to search for users."
                )
              ),
              React.createElement(
                "div",
                { className: "form-group" },
                React.createElement("label", null, "Share with"),
                React.createElement(
                  "div",
                  { className: "share-input-group" },
                  React.createElement(
                    "div",
                    { className: "share-input-wrapper" },
                    React.createElement("input", {
                      type: "text",
                      placeholder: "Search for a user...",
                      value: shareUser,
                      onChange: this.handleShareInputChange,
                      onKeyPress: (e) => {
                        if (e.key === "Enter") {
                          this.handleAddShare();
                        }
                      },
                      onBlur: () => {
                        // Delay hiding so click on suggestion registers first
                        setTimeout(() => this.setState({ showSuggestions: false }), 200);
                      },
                      onFocus: () => {
                        if (searchResults.length > 0) {
                          this.setState({ showSuggestions: true });
                        }
                      },
                      autoComplete: "off",
                    }),
                    // Suggestions dropdown
                    (showSuggestions || isSearching) &&
                      React.createElement(
                        "div",
                        { className: "user-suggestions" },
                        isSearching
                          ? React.createElement(
                              "div",
                              { className: "suggestion-item suggestion-loading" },
                              "Searching..."
                            )
                          : searchResults.map((user) =>
                              React.createElement(
                                "div",
                                {
                                  key: user,
                                  className: "suggestion-item",
                                  onMouseDown: (e) => e.preventDefault(),
                                  onClick: () => this.handleSelectUser(user),
                                },
                                React.createElement("span", { className: "suggestion-icon" }, "👤"),
                                React.createElement("span", null, user)
                              )
                            )
                      )
                  ),
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
                          { key: share.id || index, className: "share-item" },
                          React.createElement(
                            "div",
                            { className: "share-info-row" },
                            React.createElement(
                              "span",
                              { className: "share-email" },
                              share.principal || share.email || share.id
                            ),
                            React.createElement(
                              "span",
                              { className: "share-permission" },
                              (share.permission === "write"
                                ? "Can edit"
                                : "Can view") +
                              (share.status === "pending" ? " (pending)" : "")
                            )
                          ),
                          React.createElement(
                            "button",
                            {
                              className: "btn-icon-small",
                              onClick: () =>
                                this.handleRemoveShare(share.id || share.email || share.principal),
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
        // Footer with close button
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
