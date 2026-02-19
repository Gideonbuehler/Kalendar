// ============================================================================
// CalendarView Component — CalendarView.js
// ============================================================================
// The main calendar display component. Wraps react-big-calendar and provides:
//   - Sidebar with MiniCalendar, calendar list, and task manager
//   - Header with title, next-event countdown, refresh/settings buttons
//   - Full-size calendar grid (month/week/day/agenda views)
//   - Drag-and-drop: tasks onto calendar, Ctrl+Drag event moving
//   - Time-of-day gradient coloring for events
//   - Calendar color strips on events (via inset box-shadow)
//   - Live preview while dragging (ghost element + dashed preview event)
// ============================================================================

/**
 * CustomWeekHeader — Minimal day column header for week/day views.
 * Single line: "Mon 17" with a subtle accent for today.
 */
function CustomWeekHeader({ date }) {
  const dayNum = date.getDate();
  const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  return h(
    "div",
    { className: "week-header-cell" + (isToday ? " week-header-today" : "") },
    h("span", { className: "week-header-label" }, dayName),
    h("span", { className: "week-header-num" }, dayNum)
  );
}

class CalendarView extends React.Component {
  constructor(props) {
    super(props);
    // Use the base Calendar component from the CDN-loaded ReactBigCalendar
    this.CalendarComponent = ReactBigCalendar.Calendar;
    this.state = {
      isDraggingOver: false,   // True while a task is being dragged over the calendar
      previewEvent: null,      // Temporary event shown at the drop position
    };
    this._draggedTask = null;    // Currently dragged task data (kept outside state to avoid re-renders)
    this._rafId = null;          // requestAnimationFrame ID for smooth drag-over updates
    this._lastPreviewTime = null; // Prevents redundant setState when preview time hasn't changed
    this._dropHandled = false;   // Prevents handleGlobalDragEnd from clearing after a successful drop
  }
  shouldComponentUpdate(nextProps, nextState) {
    // Only re-render when state that affects the view actually changes
    if (this.state.isDraggingOver !== nextState.isDraggingOver) return true;
    if (this.state.previewEvent !== nextState.previewEvent) return true;

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

  /**
   * componentDidMount — Sets up native event listeners for drag-and-drop.
   *
   * Why native listeners? React's synthetic onDrop fires via bubbling, but
   * react-big-calendar's internal elements swallow drop events. Using
   * capture-phase native listeners ensures we intercept drops first.
   *
   * Also sets up Ctrl+Drag event moving (mousedown → mousemove → mouseup).
   */
  componentDidMount() {
    // Native dragover handler — prevents default to allow dropping
    this._nativeDragOver = (e) => {
      // Only intercept if we have a task being dragged
      if (this._draggedTask) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    };
    this._nativeDrop = (e) => {
      if (
        this._draggedTask ||
        (e.dataTransfer && e.dataTransfer.types.includes("application/json"))
      ) {
        this.handleDrop(e);
      }
    };

    // --- Ctrl+Drag event moving ---
    this._handleEventMouseDown = (e) => {
      // Only start drag if Ctrl key is held and clicking on an event
      if (!e.ctrlKey) return;

      const eventEl = e.target.closest(".rbc-event");
      if (!eventEl || eventEl.classList.contains("rbc-event-preview")) return;

      // Find which event was clicked by matching title text
      const eventContent = eventEl.querySelector(".rbc-event-content");
      if (!eventContent) return;
      const eventTitle = eventContent.textContent.trim();

      const matchedEvent = (this.props.events || []).find(
        (ev) => ev.title === eventTitle && !ev.isPreview
      );
      if (!matchedEvent) return;

      e.preventDefault();
      e.stopPropagation();

      const startRect = eventEl.getBoundingClientRect();
      this._eventDrag = {
        event: matchedEvent,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - startRect.left,
        offsetY: e.clientY - startRect.top,
        ghost: null,
        moved: false,
      };
      this._cacheDropLayout(); // Cache DOM measurements once at drag start

      document.addEventListener("mousemove", this._handleEventMouseMove);
      document.addEventListener("mouseup", this._handleEventMouseUp);
    };

    this._handleEventMouseMove = (e) => {
      if (!this._eventDrag) return;
      const drag = this._eventDrag;

      // Only start showing ghost after moving a few pixels (prevents accidental drags)
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      drag.moved = true;

      // Create ghost element on first move
      if (!drag.ghost) {
        const ghost = document.createElement("div");
        ghost.className = "event-drag-ghost";
        ghost.textContent = drag.event.title;
        ghost.style.cssText = `
          position: fixed;
          z-index: 9999;
          padding: 4px 10px;
          background: var(--primary-color, #5e72e4);
          color: white;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          pointer-events: none;
          opacity: 0.9;
          box-shadow: 0 4px 16px rgba(0,0,0,0.25);
          white-space: nowrap;
          transform: scale(1.04);
          transition: transform 100ms ease;
        `;
        document.body.appendChild(ghost);
        drag.ghost = ghost;
        document.body.style.cursor = "grabbing";
      }

      drag.ghost.style.left = e.clientX - drag.offsetX + "px";
      drag.ghost.style.top = e.clientY - drag.offsetY + "px";

      // Update preview position on the calendar
      if (this.calendarWrapperRef) {
        const slot = this.calculateDropSlot({
          clientX: e.clientX,
          clientY: e.clientY,
          currentTarget: this.calendarWrapperRef,
        });
        const taskDuration = this.props.settings?.defaultTaskDuration || 60;
        // Preserve original event duration
        const origDuration = drag.event.end
          ? new Date(drag.event.end).getTime() -
            new Date(drag.event.start).getTime()
          : taskDuration * 60000;
        const endTime = new Date(slot.start.getTime() + origDuration);

        this.setState({
          previewEvent: {
            title: drag.event.title,
            start: slot.start,
            end: endTime,
            isPreview: true,
            id: "drag-preview",
          },
        });
      }
    };

    this._handleEventMouseUp = (e) => {
      const drag = this._eventDrag;
      if (!drag) return;

      // Clean up listeners
      document.removeEventListener("mousemove", this._handleEventMouseMove);
      document.removeEventListener("mouseup", this._handleEventMouseUp);
      document.body.style.cursor = "";

      // Remove ghost
      if (drag.ghost) {
        drag.ghost.remove();
      }

      // Clear preview and layout cache
      this._dropLayoutCache = null;
      this.setState({ previewEvent: null });

      // If we actually moved, calculate drop target and fire onEventDrop
      if (drag.moved && this.calendarWrapperRef) {
        const rect = this.calendarWrapperRef.getBoundingClientRect();
        const isOverCalendar =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;

        if (isOverCalendar) {
          const slot = this.calculateDropSlot({
            clientX: e.clientX,
            clientY: e.clientY,
            currentTarget: this.calendarWrapperRef,
          });
          // Preserve original duration
          const origDuration = drag.event.end
            ? new Date(drag.event.end).getTime() -
              new Date(drag.event.start).getTime()
            : 60 * 60000;
          const newEnd = new Date(slot.start.getTime() + origDuration);

              if (this.props.onEventDrop) {
            this.props.onEventDrop({
              event: drag.event,
              start: slot.start,
              end: newEnd,
            });
          }
        }
      }

      this._eventDrag = null;
    };

    // Attach after a tick so ref is set
    setTimeout(() => {
      if (this.calendarWrapperRef) {
        this.calendarWrapperRef.addEventListener(
          "dragover",
          this._nativeDragOver,
          true
        );
        this.calendarWrapperRef.addEventListener(
          "drop",
          this._nativeDrop,
          true
        );
        // Ctrl+Drag: capture mousedown on events
        this.calendarWrapperRef.addEventListener(
          "mousedown",
          this._handleEventMouseDown,
          true
        );
      }
    }, 0);
  }

  componentDidUpdate(prevProps, prevState) {
    // Re-attach native listeners if the ref changed (shouldn't normally happen)
    if (this.calendarWrapperRef && !this._listenersAttached) {
      this.calendarWrapperRef.addEventListener(
        "dragover",
        this._nativeDragOver,
        true
      );
      this.calendarWrapperRef.addEventListener("drop", this._nativeDrop, true);
      this._listenersAttached = true;
    }
  }
  componentWillUnmount() {
    if (this.calendarWrapperRef) {
      this.calendarWrapperRef.removeEventListener(
        "dragover",
        this._nativeDragOver,
        true
      );
      this.calendarWrapperRef.removeEventListener(
        "drop",
        this._nativeDrop,
        true
      );
      this.calendarWrapperRef.removeEventListener(
        "mousedown",
        this._handleEventMouseDown,
        true
      );
    }
    // Clean up any in-progress event drag
    if (this._eventDrag) {
      document.removeEventListener("mousemove", this._handleEventMouseMove);
      document.removeEventListener("mouseup", this._handleEventMouseUp);
      if (this._eventDrag.ghost) this._eventDrag.ghost.remove();
      this._eventDrag = null;
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
    }
  }
  handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    // Capture mouse position synchronously (React synthetic events are pooled)
    const clientX = e.clientX;
    const clientY = e.clientY;

    // Always store the last known drag position so we can use it in dragend
    // (the drop event is unreliable with ReactBigCalendar swallowing events)
    this._lastDragPosition = { clientX, clientY };

    // Track whether the cursor is currently over the calendar wrapper
    this._isOverCalendar = true;

    // Use requestAnimationFrame for smooth, non-blocking preview updates
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
    }

    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      const taskData = this._draggedTask;

      if (taskData) {
        // Calculate where it would drop and show preview
        const mouseEvent = {
          clientX,
          clientY,
          currentTarget: this.calendarWrapperRef,
        };
        const slotInfo = this.calculateDropSlot(mouseEvent);

        // Get task duration from settings
        const taskDuration = this.props.settings?.defaultTaskDuration || 15;
        const endTime = new Date(slotInfo.start);
        endTime.setMinutes(endTime.getMinutes() + taskDuration);

        // Only update state if the start time actually changed
        const newStartMs = slotInfo.start.getTime();
        if (this._lastPreviewTime !== newStartMs) {
          this._lastPreviewTime = newStartMs;

          // Create preview event
          const previewEvent = {
            title: taskData.task.name,
            start: slotInfo.start,
            end: endTime,
            isPreview: true,
            id: "preview-temp-id",
          };

          this.setState({
            isDraggingOver: true,
            previewEvent: previewEvent,
          });
        } else if (!this.state.isDraggingOver) {
          this.setState({ isDraggingOver: true });
        }
      } else {
        if (!this.state.isDraggingOver) {
          this.setState({ isDraggingOver: true });
        }
      }
    });
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
          backgroundColor: this.props.settings?.themeColor || "#007bff",
          border: "2px dashed white",
          pointerEvents: "none",
        },
      };
    }

    // Look up the calendar color for this event
    const calColor = this._getEventCalendarColor(event);

    // Completed task events get a special visual treatment
    if (event.completed) {
      return {
        className: "rbc-event-completed",
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

    if (hour >= 5 && hour < 9) {
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
    if (calColor) {
      style.boxShadow = `inset 5px 0 0 0 ${calColor}, 0 1px 3px rgba(0,0,0,0.1)`;
      style.paddingLeft = '12px';
    }

    return {
      className: timeClass,
      style,
    };
  };
  // Called when a task starts being dragged from the sidebar TaskManager
  handleTaskDragStart = (dragData) => {
    this._dropHandled = false;
    this._lastPreviewTime = null;
    this._lastDragPosition = null;
    this._isOverCalendar = false;
    this._draggedTask = dragData;
    this._cacheDropLayout(); // Cache DOM measurements once at drag start
    // Add global listener to clear drag state if dropped elsewhere (not on calendar)
    document.addEventListener("dragend", this.handleGlobalDragEnd, {
      once: true,
    });
  };
  /**
   * handleGlobalDragEnd — Fallback handler for when the native drop event
   * doesn't fire (e.g., react-big-calendar swallows it).
   *
   * Checks if the drag ended over the calendar using the last known
   * mouse position, and if so, treats it as a drop.
   */
  handleGlobalDragEnd = (e) => {
    // If the drop was already handled on the calendar, don't do anything
    if (this._dropHandled) {
      this._dropHandled = false;
      return;
    }

    const draggedTask = this._draggedTask;

    // Determine if the drag ended over the calendar.
    // We can't rely on _isOverCalendar because handleDragLeave often fires
    // right before dragend when dropping onto a child element.
    // Instead, check if the last drag position is within the calendar wrapper bounds.
    let isOverCalendar = false;
    if (draggedTask && this._lastDragPosition && this.calendarWrapperRef) {
      const rect = this.calendarWrapperRef.getBoundingClientRect();
      const { clientX, clientY } = this._lastDragPosition;
      isOverCalendar =
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom;
    }

    if (draggedTask && isOverCalendar && this._lastDragPosition) {
  
      // Use the last preview position to calculate the drop slot
      const dropEvent = {
        clientX: this._lastDragPosition.clientX,
        clientY: this._lastDragPosition.clientY,
        currentTarget: this.calendarWrapperRef,
      };

      const slotInfo = this.calculateDropSlot(dropEvent);

      // Clear drag state
      this._draggedTask = null;
      this._dropLayoutCache = null;
      this.setState({
        isDraggingOver: false,
        previewEvent: null,
      });
      this._lastPreviewTime = null;
      this._lastDragPosition = null;
      this._isOverCalendar = false;

      // Pass the drop event and slot info to parent handler
      if (this.props.onTaskDroppedOnCalendar) {
        this.props.onTaskDroppedOnCalendar(draggedTask, slotInfo);
      }
      return;
    }

    // Drag ended outside the calendar — clear state
    this._draggedTask = null;
    this._dropLayoutCache = null;
    this.setState({
      isDraggingOver: false,
      previewEvent: null,
    });
    this._lastPreviewTime = null;
    this._lastDragPosition = null;
    this._isOverCalendar = false;
  };
  handleDragLeave = (e) => {
    // Only clear visual state if we're actually leaving the calendar-wrapper element
    // Use relatedTarget to check if we're moving to a child — if so, don't clear
    const wrapper = this.calendarWrapperRef;
    if (wrapper && e.relatedTarget && wrapper.contains(e.relatedTarget)) {
      // Still inside the wrapper, just moving between children — do nothing
      return;
    }

    // Mark that we've left the calendar area
    this._isOverCalendar = false;

    // Cancel any pending animation frame
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // Only clear visual state, keep _draggedTask so drop still works
    this.setState({
      isDraggingOver: false,
      previewEvent: null,
    });
    this._lastPreviewTime = null;
  };

  /**
   * handleDrop — Processes a task dropped onto the calendar.
   * Reads drag data from dataTransfer or the stored _draggedTask reference,
   * calculates the target time slot, and calls onTaskDroppedOnCalendar.
   */
  handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent duplicate drop handling (can fire from both native and React)
    if (this._dropProcessed) {
      return;
    }
    this._dropProcessed = true;
    // Reset flag after current event loop completes
    setTimeout(() => {
      this._dropProcessed = false;
    }, 0);


    // Mark that drop was handled so handleGlobalDragEnd won't clear state
    this._dropHandled = true;

    // Cancel any pending animation frame
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    // Capture mouse position and currentTarget synchronously before clearing state
    const dropEvent = {
      clientX: e.clientX,
      clientY: e.clientY,
      currentTarget: this.calendarWrapperRef,
      target: e.target,
    }; // Clear drag visual state but keep task data until we process it
    const draggedTask = this._draggedTask;
    this._draggedTask = null;
    this._dropLayoutCache = null;

    this.setState({
      isDraggingOver: false,
      previewEvent: null,
    });
    this._lastPreviewTime = null;
    this._lastDragPosition = null;
    this._isOverCalendar = false;

    try {
      // Try to get data from dataTransfer first, fall back to stored draggedTask
      let data = null;
      const rawData = e.dataTransfer.getData("application/json");
      if (rawData) {
        data = JSON.parse(rawData);
      } else if (draggedTask) {
        // Fallback: use the draggedTask from state
        data = draggedTask;
      }

      if (!data) {
        console.warn("No task data available for drop");
        return;
      }

      if (data.type === "task") {
        // Calculate the time slot from the drop position
        const slotInfo = this.calculateDropSlot(dropEvent);

        // Pass the drop event and slot info to parent handler
        if (this.props.onTaskDroppedOnCalendar) {
          this.props.onTaskDroppedOnCalendar(data, slotInfo);
        }
      }
    } catch (error) {
      console.error("Error handling drop:", error);
    }
  };
  /**
   * _cacheDropLayout — Measures and caches all DOM positions needed for
   * calculateDropSlot. Called once at drag start instead of on every frame.
   */
  _cacheDropLayout = () => {
    this._dropLayoutCache = null;
    const wrapper = this.calendarWrapperRef;
    if (!wrapper) return;

    const calendarEl = wrapper.querySelector(".rbc-calendar");
    if (!calendarEl) return;

    const timeContent = calendarEl.querySelector(".rbc-time-content");
    const isTimeView = !!timeContent;

    if (isTimeView) {
      const rect = timeContent.getBoundingClientRect();
      const dayColumns = calendarEl.querySelectorAll(".rbc-day-slot");
      const headers = calendarEl.querySelectorAll(".rbc-header");

      // Measure all day column bounds + header dates once
      const columns = [];
      for (let i = 0; i < dayColumns.length; i++) {
        const colRect = dayColumns[i].getBoundingClientRect();
        let headerDay = null;
        if (headers[i]) {
          const dateMatch = headers[i].textContent.match(/\/(\d+)|(\d+)\s/);
          if (dateMatch) headerDay = parseInt(dateMatch[1] || dateMatch[2]);
        }
        columns.push({ left: colRect.left, right: colRect.right, headerDay });
      }

      // Parse calendar start hour from time labels
      let calendarStartHour = 0;
      const timeGutter = calendarEl.querySelector(".rbc-time-gutter");
      const timeLabels = timeGutter ? timeGutter.querySelectorAll(".rbc-label") : [];
      for (let i = 0; i < timeLabels.length; i++) {
        const labelText = timeLabels[i].textContent.trim();
        if (!labelText) continue;
        const timeMatch = labelText.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1]);
          const isPM = timeMatch[3].toLowerCase() === "pm";
          if (isPM && hour !== 12) hour += 12;
          else if (!isPM && hour === 12) hour = 0;
          calendarStartHour = hour;
          break;
        }
      }

      // Measure slot height
      const daySlotForMeasure = calendarEl.querySelector(".rbc-day-slot");
      const timeSlotGroups = daySlotForMeasure
        ? daySlotForMeasure.querySelectorAll(".rbc-timeslot-group")
        : calendarEl.querySelectorAll(".rbc-timeslot-group");
      let slotHeight = 12;
      if (timeSlotGroups.length > 1) {
        slotHeight = timeSlotGroups[0].offsetHeight / 4;
      }

      this._dropLayoutCache = {
        isTimeView: true,
        timeContentEl: timeContent,
        rectTop: rect.top,
        columns,
        calendarStartHour,
        slotHeight,
      };
    } else {
      this._dropLayoutCache = { isTimeView: false };
    }
  };

  /**
   * calculateDropSlot — Converts a mouse position to a calendar date/time.
   * Uses cached DOM measurements from _cacheDropLayout for performance.
   */
  calculateDropSlot = (e) => {
    const cache = this._dropLayoutCache;

    // If no cache, fall back to a single DOM query
    if (!cache) {
      this._cacheDropLayout();
      if (!this._dropLayoutCache) {
        return { start: new Date(), action: "auto" };
      }
      return this.calculateDropSlot(e);
    }

    if (cache.isTimeView) {
      let targetDate = new Date(this.props.currentDate || new Date());

      // Find which day column the cursor is over using cached bounds
      for (let i = 0; i < cache.columns.length; i++) {
        const col = cache.columns[i];
        if (e.clientX >= col.left && e.clientX <= col.right) {
          if (col.headerDay != null) {
            targetDate = new Date(this.props.currentDate || new Date());
            targetDate.setDate(col.headerDay);
          }
          break;
        }
      }

      // Calculate time from Y position using cached measurements
      const scrollTop = cache.timeContentEl.scrollTop || 0;
      const relativeY = e.clientY - cache.rectTop + scrollTop;
      const slotsFromTop = Math.floor(relativeY / cache.slotHeight);
      const totalMinutes = cache.calendarStartHour * 60 + slotsFromTop * 15;

      targetDate.setHours(Math.floor(totalMinutes / 60));
      targetDate.setMinutes(totalMinutes % 60);
      targetDate.setSeconds(0);
      targetDate.setMilliseconds(0);

      return { start: targetDate, action: "time-slot" };
    } else {
      // MONTH VIEW
      // ...existing month view code...
      let target = e.target;
      let attempts = 0;

      while (target && attempts < 10) {
        if (
          target.className &&
          typeof target.className === "string" &&
          target.className.includes("rbc-date-cell")
        ) {
          const dateEl = target.querySelector(".rbc-button-link");
          if (dateEl) {
            const dateText = dateEl.textContent;
            const date = new Date(this.props.currentDate || new Date());
            date.setDate(parseInt(dateText));
            date.setHours(9, 0, 0, 0);
            return { start: date, action: "date-cell" };
          }
        }
        target = target.parentElement;
        attempts++;
      }

      const fallbackDate = new Date();
      fallbackDate.setHours(9, 0, 0, 0);
      return { start: fallbackDate, action: "fallback" };
    }
  };

  render() {
    const {
      localizer,
      events,
      calendars,
      calendarUrl,
      selectedCalendarIds,
      settings,
      selectedDate,
      currentDate,
      isLoading,
      onSelectSlot,
      onSelectEvent,
      onEventDrop,
      onEventResize,
      onCalendarToggle,
      onCalendarChange,
      onDateNavigate,
      onRefresh,
      onSettingsClick,
      onLogout,
    } = this.props;

    // Filter to get event calendars only
    const eventCalendars = calendars
      ? calendars.filter(
          (cal) => cal.components && cal.components.includes("VEVENT")
        )
      : [];
    const CalendarComponent = this.CalendarComponent;

    // Include preview event if dragging
    const displayEvents = this.state.previewEvent
      ? [...events, this.state.previewEvent]
      : events;
    return h(
      "div",
      { className: "app-container" }, // Mini Calendar Sidebar
      h(MiniCalendar, {
        selectedDate: currentDate || selectedDate || new Date(),
        events: events,
        calendars: calendars,
        selectedCalendarIds: selectedCalendarIds,
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
          { className: "app-header" },          h(
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
            { className: "header-controls" },            // Action Buttons
            h(
              "div",
              { className: "action-buttons" },
              h(
                "button",
                {
                  onClick: onRefresh,
                  className: "btn-icon",
                  disabled: isLoading,
                  title: `Refresh events (${
                    events ? events.length : 0
                  } loaded)`,
                },
                isLoading ? "⏳" : "🔄"
              ),
              h(
                "button",
                {
                  onClick: onSettingsClick,
                  className: "btn-icon",
                  title: "Settings",
                },
                "⚙️"
              )
            )
          )
        ), // Calendar Container
        h(
          "div",
          {
            className: `calendar-wrapper ${
              this.state.isDraggingOver ? "drag-over" : ""
            } ${this.state.previewEvent ? "has-preview" : ""}`,
            ref: (el) => {
              if (el && el !== this.calendarWrapperRef) {
                // Clean up old listeners if ref changes
                if (this.calendarWrapperRef) {
                  this.calendarWrapperRef.removeEventListener(
                    "dragover",
                    this._nativeDragOver,
                    true
                  );
                  this.calendarWrapperRef.removeEventListener(
                    "drop",
                    this._nativeDrop,
                    true
                  );
                  this.calendarWrapperRef.removeEventListener(
                    "mousedown",
                    this._handleEventMouseDown,
                    true
                  );
                }
                this.calendarWrapperRef = el;
                // Attach capture-phase listeners
                if (this._nativeDragOver) {
                  el.addEventListener("dragover", this._nativeDragOver, true);
                  el.addEventListener("drop", this._nativeDrop, true);
                  this._listenersAttached = true;
                }
                if (this._handleEventMouseDown) {
                  el.addEventListener(
                    "mousedown",
                    this._handleEventMouseDown,
                    true
                  );
                }
              } else if (!el) {
                this.calendarWrapperRef = null;
              }
            },
            onDragOver: this.handleDragOver,
            onDragLeave: this.handleDragLeave,
            onDrop: this.handleDrop,
          },
          h(
            "div",
            { className: "calendar-container" },            h(CalendarComponent, {
              localizer: localizer,
              events: displayEvents,
              startAccessor: "start",
              endAccessor: "end",
              titleAccessor: "title",
              style: { height: "100%" },
              date: currentDate || new Date(),
              onNavigate: onDateNavigate,
              selectable: true,
              onSelectSlot: onSelectSlot,
              onSelectEvent: onSelectEvent,
              // Note: Drag and drop requires npm install
              view: this.props.currentView || settings.defaultView || "month",
              onView: this.props.onViewChange || (() => {}),
              views: ["month", "week", "day", "agenda"],
              step: 15, // 15 minute increments
              timeslots: 4, // 4 slots per hour (15 min each)
              showMultiDayTimes: true,
              popup: true,
              components: {
                week: { header: CustomWeekHeader },
                day: { header: CustomWeekHeader },
              },
              // Add CSS class for hover effects
              eventPropGetter: this.eventPropGetter,
            })
          ),
          // Keyboard shortcuts hint
          h(
            "div",
            { className: "keyboard-hint" },
            h(
              "div",
              null,
              h("kbd", null, "Alt"),
              "+Click delete • ",
              h("kbd", null, "Ctrl"),
              "+Drag move"
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
    const index = calendarName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  }
}

window.CalendarView = CalendarView;
