// ============================================================================
// CalendarView Component — CalendarView.js
// ============================================================================
// The main calendar display component. Wraps react-big-calendar and provides:
//   - Sidebar with MiniCalendar, calendar list, and task manager
//   - Header with title, next-event countdown, refresh/settings buttons
//   - Full-size calendar grid (month/week/day/agenda views)
//   - Drag-and-drop via react-big-calendar's DnD addon: move events by
//     dragging, resize them by their edges, drop tasks from the sidebar
//   - Time-of-day gradient coloring for events
//   - Calendar color strips on events (via inset box-shadow)
//   - Settings-driven time format (12h/24h) and week numbers
// ============================================================================

// Calendar component with drag & drop (move + resize) support
const DnDCalendar = ReactBigCalendar.withDragAndDrop(ReactBigCalendar.Calendar);

// Week and day views open scrolled to the morning instead of midnight
const SCROLL_TO_TIME = new Date(1970, 0, 1, 7, 0, 0);

class CalendarView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      isDraggingTask: false, // True while a task from the sidebar is being dragged
    };
    this._draggedTask = null; // Currently dragged task data (kept outside state to avoid re-renders)

    // Custom components are created once: the DnD addon reads them only on mount.
    // They read this.props at render time, so settings changes still apply.
    const view = this;
    this._components = {
      event: function KalendarEvent(props) {
        const { event, title } = props;
        return h(
          "span",
          {
            className: "kal-event-content",
            onContextMenu: (e) => view._handleEventContextMenu(event, e),
          },
          event.recurring &&
            h("span", { className: "kal-event-recurring", title: "Repeating event" }, "↻"),
          title
        );
      },
      month: {
        dateHeader: function KalendarDateHeader(props) {
          return view._renderMonthDateHeader(props);
        },
      },
    };
  }

  shouldComponentUpdate(nextProps, nextState) {
    // Only re-render when state that affects the view actually changes
    if (this.state.isDraggingTask !== nextState.isDraggingTask) return true;

    // Check props that affect the rendered output
    if (this.props.events !== nextProps.events) return true;
    if (this.props.calendars !== nextProps.calendars) return true;
    if (this.props.selectedCalendarIds !== nextProps.selectedCalendarIds) return true;
    if (this.props.isLoading !== nextProps.isLoading) return true;
    if (this.props.currentView !== nextProps.currentView) return true;
    if (this.props.settings !== nextProps.settings) return true;
    if (this.props.showTaskManager !== nextProps.showTaskManager) return true;
    if (this.props.taskLists !== nextProps.taskLists) return true;

    // Compare dates by value
    const curDate = this.props.currentDate;
    const nextDate = nextProps.currentDate;
    if (curDate !== nextDate) {
      if (!curDate || !nextDate) return true;
      if (curDate.getTime() !== nextDate.getTime()) return true;
    }

    return false;
  }

  componentWillUnmount() {
    document.removeEventListener("dragend", this._handleTaskDragEnd);
  }

  // ── Dragging tasks from the sidebar onto the calendar ─────────────────

  // Called when a task starts being dragged from the sidebar TaskManager
  handleTaskDragStart = (dragData) => {
    this._draggedTask = dragData;
    this.setState({ isDraggingTask: true });
    // Clear drag state if the task is dropped somewhere other than the calendar
    document.addEventListener("dragend", this._handleTaskDragEnd, { once: true });
  };

  _handleTaskDragEnd = () => {
    this._draggedTask = null;
    this.setState({ isDraggingTask: false });
  };

  /**
   * _dragFromOutsideItem — The event the DnD addon previews while a task is
   * dragged over the calendar. Its length matches the default task duration.
   */
  _dragFromOutsideItem = () => {
    const dragData = this._draggedTask;
    if (!dragData) return null;
    const minutes = this.props.settings?.defaultTaskDuration || 15;
    const start = new Date();
    return {
      title: dragData.task.name,
      start,
      end: new Date(start.getTime() + minutes * 60000),
      isPreview: true,
    };
  };

  /** Creates an event from a task dropped onto a day (month view) or time slot. */
  _handleDropFromOutside = ({ start }) => {
    const dragData = this._draggedTask;
    this._handleTaskDragEnd();
    if (!dragData || !this.props.onTaskDroppedOnCalendar) return;

    const dropStart = new Date(start);
    // Month view drops land on midnight of the day: schedule at 9:00 instead
    if (this.props.currentView === "month") dropStart.setHours(9, 0, 0, 0);
    this.props.onTaskDroppedOnCalendar(dragData, { start: dropStart });
  };

  // ── Event interactions ────────────────────────────────────────────────

  _isEditable = (event) =>
    !event.isPreview && !event._isOptimistic && !event.tempId;

  _isResizable = (event) => this._isEditable(event) && !event.allDay;

  _handleEventContextMenu = (event, e) => {
    if (!this.props.onSelectEvent || event.isPreview) return;
    e.preventDefault();
    e.stopPropagation();
    this.props.onSelectEvent(event, e);
  };

  /**
   * eventPropGetter — Custom styling callback for react-big-calendar.
   *
   * Determines the CSS class and inline style for each event based on:
   *   1. Preview events: semi-transparent with dashed border
   *   2. Completed events: greyed out with line-through
   *   3. Regular events: time-of-day gradient (warm→cool) + calendar color strip
   *
   * Calendar color is rendered as an inset box-shadow (5px left strip)
   * rather than borderLeft, because CSS hover rules can't override inline borders.
   */
  eventPropGetter = (event, start, end, isSelected) => {
    if (event.isPreview) {
      return {
        className: "rbc-event-preview",
        style: {
          opacity: 0.5,
          backgroundColor: this.props.settings?.primaryColor || "#5e72e4",
          border: "2px dashed white",
          pointerEvents: "none",
        },
      };
    }

    // Look up the calendar color for this event
    const calColor = this._getEventCalendarColor(event);
    const pendingClass = event._isOptimistic ? " rbc-event-pending" : "";

    // Completed task events get a special visual treatment
    if (event.completed) {
      return {
        className: "rbc-event-completed" + pendingClass,
        style: {
          opacity: 0.6,
          textDecoration: "line-through",
          filter: "grayscale(40%)",
          boxShadow: calColor ? `inset 5px 0 0 0 ${calColor}` : undefined,
          paddingLeft: calColor ? '12px' : undefined,
        },
      };
    }

    // Time-of-day gradient coloring — morning=warm, afternoon=neutral, evening=cool
    const eventStart = new Date(event.start);
    const hour = eventStart.getHours();
    let timeClass = "";
    let timeBg = null;

    if (event.allDay) {
      timeClass = "rbc-event-allday";
      timeBg = calColor || "#5e72e4";
    } else if (hour >= 5 && hour < 9) {
      timeClass = "rbc-event-morning-early";
      timeBg = "linear-gradient(135deg, #f6d365 0%, #fda085 100%)";
    } else if (hour >= 9 && hour < 12) {
      timeClass = "rbc-event-morning";
      timeBg = "linear-gradient(135deg, #fa709a 0%, #fee140 100%)";
    } else if (hour >= 12 && hour < 14) {
      timeClass = "rbc-event-midday";
      timeBg = "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)";
    } else if (hour >= 14 && hour < 17) {
      timeClass = "rbc-event-afternoon";
      timeBg = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    } else if (hour >= 17 && hour < 20) {
      timeClass = "rbc-event-evening";
      timeBg = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
    } else {
      timeClass = "rbc-event-night";
      timeBg = "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)";
    }

    const style = timeBg
      ? { background: timeBg, color: "white" }
      : {};

    // Add calendar color left border strip via box-shadow
    if (calColor && !event.allDay) {
      style.boxShadow = `inset 5px 0 0 0 ${calColor}, 0 1px 3px rgba(0,0,0,0.1)`;
      style.paddingLeft = '12px';
    }

    // Short events show time and title on one line so the title isn't cut off
    const isShort =
      !event.allDay && new Date(event.end) - new Date(event.start) <= 30 * 60000;

    return {
      className: timeClass + pendingClass + (isShort ? " rbc-event-short" : ""),
      style,
    };
  };

  // ── Settings-driven formatting ────────────────────────────────────────

  /**
   * _getFormats — react-big-calendar display formats for the current
   * time format (12h/24h) and week-number settings. Cached per settings object.
   */
  _getFormats(settings) {
    if (this._formatsCache && this._formatsCache.settings === settings) {
      return this._formatsCache.formats;
    }
    const time = settings?.timeFormat === "24h" ? "HH:mm" : "h:mm A";
    const range = ({ start, end }, culture, loc) =>
      `${loc.format(start, time, culture)} – ${loc.format(end, time, culture)}`;

    const formats = {
      timeGutterFormat: settings?.timeFormat === "24h" ? "HH:mm" : "h A",
      eventTimeRangeFormat: range,
      eventTimeRangeStartFormat: ({ start }, culture, loc) =>
        `${loc.format(start, time, culture)} – `,
      eventTimeRangeEndFormat: ({ end }, culture, loc) =>
        ` – ${loc.format(end, time, culture)}`,
      selectRangeFormat: range,
      agendaTimeFormat: time,
      agendaTimeRangeFormat: range,
      dayRangeHeaderFormat: ({ start, end }, culture, loc) => {
        const sameMonth = start.getMonth() === end.getMonth();
        const label = `${loc.format(start, "MMMM D", culture)} – ${loc.format(
          end,
          sameMonth ? "D" : "MMMM D",
          culture
        )}`;
        return settings?.showWeekNumbers
          ? `${label} · Week ${moment(start).week()}`
          : label;
      },
    };
    this._formatsCache = { settings, formats };
    return formats;
  }

  /** Hover text for events: time range and title. */
  _tooltip = (event) => {
    if (event.allDay) return event.title;
    const time = this.props.settings?.timeFormat === "24h" ? "HH:mm" : "h:mm A";
    return `${moment(event.start).format(time)} – ${moment(event.end).format(time)}  ${event.title}`;
  };

  /** Month view day number, prefixed with the week number on the first day of each row. */
  _renderMonthDateHeader({ date, label, onDrillDown }) {
    const settings = this.props.settings || {};
    const firstDay = settings.firstDayOfWeek || 0;
    const showWeek = settings.showWeekNumbers && date.getDay() === firstDay;
    return h(
      React.Fragment,
      null,
      showWeek &&
        h("span", { className: "rbc-week-number" }, `W${moment(date).week()}`),
      h(
        "button",
        { type: "button", className: "rbc-button-link", onClick: onDrillDown },
        label
      )
    );
  }

  render() {
    const {
      localizer,
      events,
      calendars,
      selectedCalendarIds,
      settings,
      selectedDate,
      currentDate,
      isLoading,
      onSelectSlot,
      onSelectEvent,
      onDoubleClickEvent,
      onEventDrop,
      onEventResize,
      onCalendarToggle,
      onDateNavigate,
      onRefresh,
      onSettingsClick,
      onLogout,
    } = this.props;

    return h(
      "div",
      { className: "app-container" }, // Mini Calendar Sidebar
      h(MiniCalendar, {
        selectedDate: currentDate || selectedDate || new Date(),
        events: events,
        calendars: calendars,
        selectedCalendarIds: selectedCalendarIds,
        firstDayOfWeek: settings?.firstDayOfWeek || 0,
        onDateSelect: onDateNavigate,
        onCalendarToggle: onCalendarToggle,
        onAddCalendar: this.props.onAddCalendar,
        onCalendarSettings: this.props.onCalendarSettings,
        onToggleTaskManager: this.props.onToggleTaskManager,
        showTaskManager: this.props.showTaskManager,
        taskLists: this.props.taskLists,
        onCreateList: this.props.onCreateList,
        onCreateTask: this.props.onCreateTask,
        onDeleteTask: this.props.onDeleteTask,
        onDeleteList: this.props.onDeleteList,
        onToggleTask: this.props.onToggleTask,
        onTaskToCalendar: this.props.onTaskToCalendar,
        onTaskClick: this.props.onTaskClick,
        onTaskDragStart: this.handleTaskDragStart,
        onLogout: onLogout,
      }),

      // Main Content
      h(
        "div",
        { className: "main-content" },
        // Header
        h(
          "div",
          { className: "app-header" },
          h(
            "div",
            { className: "header-left" },
            h(
              "h1",
              { className: "app-title-header" },
              h("span", { className: "logo-icon" }),
              "Kalendar"
            ),
            // Next Event Countdown
            h(NextEventCountdown, { events: events })
          ),
          h(
            "div",
            { className: "header-controls" },
            // Action Buttons
            h(
              "div",
              { className: "action-buttons" },
              h(
                "button",
                {
                  onClick: this.props.onNewEvent,
                  className: "btn-new-event",
                  title: "New event (N)",
                },
                "+ New event"
              ),
              h(
                "button",
                {
                  onClick: onRefresh,
                  className: "btn-icon",
                  disabled: isLoading,
                  title: isLoading
                    ? "Refreshing…"
                    : `Refresh events (${events ? events.length : 0} loaded)`,
                  "aria-label": "Refresh events",
                },
                kalIcon("refresh", { size: 18, className: isLoading ? "kal-icon-spin" : "" })
              ),
              h(
                "button",
                {
                  onClick: onSettingsClick,
                  className: "btn-icon",
                  title: "Settings",
                  "aria-label": "Settings",
                },
                kalIcon("settings", { size: 18 })
              )
            )
          )
        ), // Calendar Container
        h(
          "div",
          {
            className: `calendar-wrapper ${
              this.state.isDraggingTask ? "drag-over" : ""
            }`,
          },
          h(
            "div",
            { className: "calendar-container" },
            h(DnDCalendar, {
              localizer: localizer,
              events: events,
              startAccessor: "start",
              endAccessor: "end",
              titleAccessor: "title",
              tooltipAccessor: this._tooltip,
              allDayAccessor: "allDay",
              style: { height: "100%" },
              date: currentDate || new Date(),
              onNavigate: onDateNavigate,
              selectable: true,
              onSelectSlot: onSelectSlot,
              onSelectEvent: onSelectEvent,
              onDoubleClickEvent: onDoubleClickEvent,
              view: this.props.currentView || settings.defaultView || "month",
              onView: this.props.onViewChange || (() => {}),
              views: ["month", "week", "day", "agenda"],
              step: 15, // 15 minute increments
              timeslots: 4, // 4 slots per hour (15 min each)
              scrollToTime: SCROLL_TO_TIME,
              showMultiDayTimes: true,
              popup: true,
              formats: this._getFormats(settings),
              components: this._components,
              eventPropGetter: this.eventPropGetter,
              // Drag & drop
              onEventDrop: onEventDrop,
              onEventResize: onEventResize,
              resizable: true,
              draggableAccessor: this._isEditable,
              resizableAccessor: this._isResizable,
              onDropFromOutside: this._handleDropFromOutside,
              dragFromOutsideItem: this._dragFromOutsideItem,
            })
          ),
          // Keyboard shortcuts hint
          h(
            "div",
            { className: "keyboard-hint" },
            h(
              "div",
              null,
              "Drag to move • Drag edge to resize • Double-click to edit • ",
              h("kbd", null, "Alt"),
              "+Click delete • ",
              h("kbd", null, "N"),
              " new • ",
              h("kbd", null, "T"),
              " today"
            )
          )
        )
      )
    );
  }

  /**
   * _getEventCalendarColor — Resolves the display color for an event's calendar.
   * Tries to match by calendarUrl first, then by calendarName.
   * Falls back to a hash-based consistent color from getCalendarColor().
   */
  _getEventCalendarColor(event) {
    // Try to match by calendarUrl first
    if (event.calendarUrl && this.props.calendars) {
      const cal = this.props.calendars.find((c) => c.url === event.calendarUrl);
      if (cal) {
        return cal.color || this.getCalendarColor(cal.displayName);
      }
    }
    // Fallback: use calendarName if available
    if (event.calendarName) {
      // Check if any calendar matches by displayName
      if (this.props.calendars) {
        const cal = this.props.calendars.find((c) => c.displayName === event.calendarName);
        if (cal) {
          return cal.color || this.getCalendarColor(cal.displayName);
        }
      }
      return this.getCalendarColor(event.calendarName);
    }
    return null;
  }

  /**
   * getCalendarColor — Generates a deterministic color for a calendar name.
   * Uses a simple character-code hash to pick from a preset palette.
   * Ensures the same calendar always gets the same color.
   */
  getCalendarColor(calendarName) {
    // Generate a consistent color for each calendar
    const colors = [
      "#5e72e4",
      "#11cdef",
      "#2dce89",
      "#fb6340",
      "#f5365c",
      "#ffd600",
      "#172b4d",
      "#8965e0",
    ];
    const index = (calendarName || "")
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  }
}

window.CalendarView = CalendarView;
