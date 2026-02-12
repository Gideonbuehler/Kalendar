// ============================================================================
// MiniCalendar Component — MiniCalendar.js
// ============================================================================
// Left sidebar component that provides:
//   - Tabbed navigation (Calendar / Activity views)
//   - Compact month grid with event dots and today highlighting
//   - DayTimeline showing today's events at a glance
//   - Calendar list with color swatches, checkboxes, and settings buttons
//   - Task manager section with expandable lists
//   - ProductivityHeatmap and EventInsights in the Activity tab
// ============================================================================

class MiniCalendar extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      displayMonth: new Date(),    // The month currently shown in the mini grid
      activeTab: "calendar",       // Which tab is selected: "calendar" | "activity"
    };
  }

  /**
   * getDaysInMonth — Builds a 6-week (42-cell) array for the mini calendar grid.
   * Includes trailing days from the previous month and leading days from the
   * next month so the grid is always a complete rectangle.
   */
  getDaysInMonth(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];

    // Previous month days
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      days.push({
        day: prevMonthLastDay - i,
        isCurrentMonth: false,
        date: new Date(year, month - 1, prevMonthLastDay - i),
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i),
      });
    }

    // Next month days
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i),
      });
    }

    return days;
  }

  isToday(date) {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  }

  isSameDay(date1, date2) {
    if (!date1 || !date2) return false;
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return false;
    return (
      d1.getDate() === d2.getDate() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getFullYear() === d2.getFullYear()
    );
  }

  hasEvents(date) {
    const { events } = this.props;
    if (!events) return false;
    return events.some((event) => {
      const eventStart = new Date(event.start);
      return this.isSameDay(eventStart, date);
    });
  }

  handlePrevMonth = () => {
    const newDate = new Date(this.state.displayMonth);
    newDate.setMonth(newDate.getMonth() - 1);
    this.setState({ displayMonth: newDate });
  };

  handleNextMonth = () => {
    const newDate = new Date(this.state.displayMonth);
    newDate.setMonth(newDate.getMonth() + 1);
    this.setState({ displayMonth: newDate });
  };

  handleDayClick = (date) => {
    if (this.props.onDateSelect) {
      this.props.onDateSelect(date);
    }
  };

  getCalendarColor(calendarName) {
    const colors = [
      "#5e72e4", "#11cdef", "#2dce89", "#fb6340",
      "#f5365c", "#ffd600", "#172b4d", "#8965e0",
    ];
    const index = calendarName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  }

  /** Renders the Calendar tab: mini month grid + DayTimeline below it. */
  renderCalendarTab() {
    const { displayMonth } = this.state;
    const { selectedDate } = this.props;
    const days = this.getDaysInMonth(displayMonth);
    const monthName = displayMonth.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    return h(
      "div",
      { className: "mini-calendar" },
      h(
        "div",
        { className: "mini-calendar-header" },
        h("span", { className: "mini-calendar-month" }, monthName),
        h(
          "div",
          { className: "mini-calendar-nav" },
          h("button", { onClick: this.handlePrevMonth, title: "Previous month" }, "‹"),
          h("button", { onClick: this.handleNextMonth, title: "Next month" }, "›")
        )
      ),
      h(
        "div",
        { className: "mini-calendar-grid" },
        ["S", "M", "T", "W", "T", "F", "S"].map((day, idx) =>
          h("div", { key: `header-${idx}`, className: "mini-calendar-day-header" }, day)
        ),
        days.map((dayInfo, idx) => {
          const classNames = ["mini-calendar-day"];
          if (this.isToday(dayInfo.date)) classNames.push("today");
          if (!dayInfo.isCurrentMonth) classNames.push("other-month");
          if (this.isSameDay(selectedDate, dayInfo.date)) classNames.push("selected");
          if (this.hasEvents(dayInfo.date)) classNames.push("has-events");

          return h(
            "div",
            {
              key: idx,
              className: classNames.join(" "),
              onClick: () => dayInfo.isCurrentMonth && this.handleDayClick(dayInfo.date),
            },
            dayInfo.day
          );
        })
      ),
      // Day Timeline below the mini calendar
      h(DayTimeline, {
        events: this.props.events,
        selectedDate: selectedDate,
        onDateSelect: this.props.onDateSelect,
      })
    );
  }

  /** Renders the Activity tab: ProductivityHeatmap + EventInsights widgets. */
  renderActivityTab() {
    return h(
      "div",
      { className: "sidebar-tab-content" },
      h(ProductivityHeatmap, {
        events: this.props.events,
        taskLists: this.props.taskLists,
      }),
      h(EventInsights, {
        events: this.props.events,
        taskLists: this.props.taskLists,
      })
    );
  }

  render() {
    const { activeTab } = this.state;
    const {
      onLogout,
      calendars,
      selectedCalendarIds,
      onCalendarToggle,
      onAddCalendar,
    } = this.props;

    const eventCalendars = calendars
      ? calendars.filter(
          (cal) => cal.components && cal.components.includes("VEVENT")
        )
      : [];

    return h(
      "div",
      { className: "sidebar" },

      // App Title
      h(
        "div",
        { className: "sidebar-header" },
        h(
          "h1",
          { className: "app-title-sidebar" },
          h("span", { className: "logo-icon" }, "📅"),
          "Kalendar"
        )
      ),

      // Tabbed Navigation
      h(
        "div",
        { className: "sidebar-tabs" },
        h(
          "button",
          {
            className: `sidebar-tab ${activeTab === "calendar" ? "active" : ""}`,
            onClick: () => this.setState({ activeTab: "calendar" }),
          },
          h("span", { className: "sidebar-tab-icon" }, "📅"),
          "Calendar"
        ),
        h(
          "button",
          {
            className: `sidebar-tab ${activeTab === "activity" ? "active" : ""}`,
            onClick: () => this.setState({ activeTab: "activity" }),
          },
          h("span", { className: "sidebar-tab-icon" }, "📊"),
          "Activity"
        )
      ),

      // Tab Content (scrollable area)
      h(
        "div",
        { className: "sidebar-tab-panel" },
        activeTab === "calendar"
          ? this.renderCalendarTab()
          : this.renderActivityTab()
      ),

      // Calendar List Section (always visible below tabs)
      h(
        "div",
        { className: "sidebar-calendars" },
        h(
          "div",
          { className: "sidebar-section-header" },
          h("span", { className: "sidebar-section-title" }, "Calendars"),
          h(
            "button",
            {
              className: "sidebar-add-calendar",
              onClick: onAddCalendar,
              title: "Add calendar",
            },
            "+"
          )
        ),
        h(
          "div",
          { className: "sidebar-calendar-list" },
          eventCalendars.length > 0
            ? eventCalendars.map((cal) => {
                const isActive = selectedCalendarIds.includes(cal.url);
                const color = cal.color || this.getCalendarColor(cal.displayName);
                return h(
                  "div",
                  {
                    key: cal.url,
                    className: `sidebar-calendar-item ${isActive ? "active" : ""}`,
                  },
                  h("input", {
                    type: "checkbox",
                    className: "sidebar-calendar-checkbox",
                    checked: isActive,
                    onChange: () => onCalendarToggle(cal.url),
                  }),
                  h("span", {
                    className: "sidebar-calendar-color",
                    style: { backgroundColor: color },
                  }),
                  h(
                    "span",
                    { className: "sidebar-calendar-name", title: cal.displayName },
                    cal.displayName || "Unknown"
                  ),
                  h(
                    "button",
                    {
                      className: "calendar-settings-btn",
                      onClick: (e) => {
                        e.stopPropagation();
                        if (this.props.onCalendarSettings) {
                          this.props.onCalendarSettings(cal);
                        }
                      },
                      title: "Calendar settings",
                    },
                    "⚙"
                  )
                );
              })
            : h("div", { className: "no-calendars-msg" }, "No calendars found")
        )
      ),

      // Task Manager (inline in sidebar, below calendars)
      h(TaskManager, {
        taskLists: this.props.taskLists,
        showTaskManager: this.props.showTaskManager,
        onToggleTaskManager: this.props.onToggleTaskManager,
        onCreateList: this.props.onCreateList,
        onCreateTask: this.props.onCreateTask,
        onDeleteTask: this.props.onDeleteTask,
        onDeleteList: this.props.onDeleteList,
        onToggleTask: this.props.onToggleTask,
        onTaskToCalendar: this.props.onTaskToCalendar,
        onTaskClick: this.props.onTaskClick,
        onDragStart: this.props.onTaskDragStart,
      }),

      // Logout Footer
      h(
        "div",
        { className: "sidebar-footer" },
        h(
          "button",
          {
            className: "btn btn-outline-danger btn-block",
            onClick: onLogout,
            style: { width: "100%", marginTop: "auto" },
          },
          h("i", { className: "fas fa-sign-out-alt" }),
          " Logout"
        )
      )
    );
  }
}
window.MiniCalendar = MiniCalendar;
