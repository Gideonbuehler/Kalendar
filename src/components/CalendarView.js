// Calendar View Component
class CalendarView extends React.Component {
  constructor(props) {
    super(props);
    // Note: Drag and drop requires npm install react-dnd and react-dnd-html5-backend
    // For CDN usage, we'll use the base Calendar component
    this.CalendarComponent = ReactBigCalendar.Calendar;
    this.state = {
      isDraggingOver: false,
      draggedTask: null,
      previewEvent: null, // Preview of where task will be dropped
    };
    this._rafId = null; // For requestAnimationFrame-based drag over updates    this._lastPreviewTime = null; // Track last preview start time to avoid redundant setState
    this._dropHandled = false; // Flag to prevent handleGlobalDragEnd from clearing after a successful drop
  }
  componentDidMount() {
    // Use native event listeners in CAPTURE phase so that drop events
    // are intercepted before ReactBigCalendar's internal elements can
    // swallow them. React's synthetic onDrop uses bubbling, which doesn't
    // reach the wrapper when a child element prevents propagation.
    this._nativeDragOver = (e) => {
      // Only intercept if we have a task being dragged
      if (this.state.draggedTask) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    };
    this._nativeDrop = (e) => {
      if (
        this.state.draggedTask ||
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

      // Clear preview
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

          console.log("Ctrl+Drag drop:", drag.event.title, "→", slot.start);
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
      const taskData = this.state.draggedTask;

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
  // Helper to customize day/time slot rendering to show preview
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

    // Completed task events get a special visual treatment
    if (event.completed) {
      return {
        className: "rbc-event-completed",
        style: {
          opacity: 0.6,
          textDecoration: "line-through",
          filter: "grayscale(40%)",
        },
      };
    }

    // Time-of-day gradient coloring — morning=warm, afternoon=neutral, evening=cool
    const eventStart = new Date(event.start);
    const hour = eventStart.getHours();
    let timeClass = "";
    let timeBg = null;

    if (hour >= 5 && hour < 9) {
      // Early morning — sunrise warm orange
      timeClass = "rbc-event-morning-early";
      timeBg = "linear-gradient(135deg, #f6d365 0%, #fda085 100%)";
    } else if (hour >= 9 && hour < 12) {
      // Morning — energetic warm
      timeClass = "rbc-event-morning";
      timeBg = "linear-gradient(135deg, #fa709a 0%, #fee140 100%)";
    } else if (hour >= 12 && hour < 14) {
      // Midday — vibrant
      timeClass = "rbc-event-midday";
      timeBg = "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)";
    } else if (hour >= 14 && hour < 17) {
      // Afternoon — balanced
      timeClass = "rbc-event-afternoon";
      timeBg = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
    } else if (hour >= 17 && hour < 20) {
      // Evening — sunset cool
      timeClass = "rbc-event-evening";
      timeBg = "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)";
    } else {
      // Night — deep cool
      timeClass = "rbc-event-night";
      timeBg = "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)";
    }

    return {
      className: timeClass,
      style: timeBg ? { background: timeBg, border: "none", color: "white" } : {},
    };
  };
  handleTaskDragStart = (dragData) => {
    console.log("Task drag started:", dragData);
    this._dropHandled = false;
    this._lastPreviewTime = null;
    this._lastDragPosition = null;
    this._isOverCalendar = false;
    this.setState({ draggedTask: dragData });
    // Add global listener to clear drag state if dropped elsewhere (not on calendar)
    document.addEventListener("dragend", this.handleGlobalDragEnd, {
      once: true,
    });
  };
  handleGlobalDragEnd = (e) => {
    // If the drop was already handled on the calendar, don't do anything
    if (this._dropHandled) {
      this._dropHandled = false;
      return;
    }

    const draggedTask = this.state.draggedTask;

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
      console.log("dragend over calendar — treating as drop (fallback)");

      // Use the last preview position to calculate the drop slot
      const dropEvent = {
        clientX: this._lastDragPosition.clientX,
        clientY: this._lastDragPosition.clientY,
        currentTarget: this.calendarWrapperRef,
      };

      const slotInfo = this.calculateDropSlot(dropEvent);
      console.log("Drop completed (via dragend) — slot:", slotInfo);

      // Clear drag state
      this.setState({
        isDraggingOver: false,
        draggedTask: null,
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
    this.setState({
      isDraggingOver: false,
      draggedTask: null,
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

    // Only clear visual state, keep draggedTask so drop still works
    this.setState({
      isDraggingOver: false,
      previewEvent: null,
    });
    this._lastPreviewTime = null;
  };

  handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Prevent duplicate drop handling (drop events can bubble/fire twice)
    if (this._dropProcessed) {
      return;
    }
    this._dropProcessed = true;
    // Reset flag after current event loop completes
    setTimeout(() => {
      this._dropProcessed = false;
    }, 0);

    console.log("handleDrop FIRED — processing task drop");

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
    const draggedTask = this.state.draggedTask;

    this.setState({
      isDraggingOver: false,
      draggedTask: null,
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
        console.log("Drop completed — slot:", slotInfo);

        // Pass the drop event and slot info to parent handler
        if (this.props.onTaskDroppedOnCalendar) {
          this.props.onTaskDroppedOnCalendar(data, slotInfo);
        }
      }
    } catch (error) {
      console.error("Error handling drop:", error);
    }
  };
  calculateDropSlot = (e) => {
    // If e.currentTarget is not available or is not an element, fallback
    const currentTarget =
      e.currentTarget ||
      (this.calendarWrapperRef ? this.calendarWrapperRef : null);

    if (!currentTarget || !currentTarget.querySelector) {
      return { start: new Date(), action: "auto" };
    }

    const calendarEl = currentTarget.querySelector(".rbc-calendar");
    if (!calendarEl) {
      return { start: new Date(), action: "auto" };
    }

    const hasTimeSlots = calendarEl.querySelector(".rbc-time-content");

    if (hasTimeSlots) {
      // TIME-BASED VIEW (Week/Day)
      const timeContent = calendarEl.querySelector(".rbc-time-content");
      const rect = timeContent.getBoundingClientRect();

      // STEP 1: Find which DAY column was clicked
      const dayColumns = calendarEl.querySelectorAll(".rbc-day-slot");
      let targetDate = new Date(this.props.currentDate || new Date());

      for (let i = 0; i < dayColumns.length; i++) {
        const colRect = dayColumns[i].getBoundingClientRect();
        if (e.clientX >= colRect.left && e.clientX <= colRect.right) {
          // Found the column! Now get the date from the header
          const headers = calendarEl.querySelectorAll(".rbc-header");
          if (headers[i]) {
            const headerText = headers[i].textContent;
            // Extract day number from header (e.g., "Mon 2/10" -> "10")
            const dateMatch = headerText.match(/\/(\d+)|(\d+)\s/);
            if (dateMatch) {
              const day = parseInt(dateMatch[1] || dateMatch[2]);
              targetDate = new Date(this.props.currentDate || new Date());
              targetDate.setDate(day);
            }
          }
          break;
        }
      }

      // STEP 2: Calculate TIME from Y position
      // Find the start hour by looking at actual time labels (skip empty ones)
      const timeGutter = calendarEl.querySelector(".rbc-time-gutter");
      const timeLabels = timeGutter
        ? timeGutter.querySelectorAll(".rbc-label")
        : [];
      let calendarStartHour = 0;

      for (let i = 0; i < timeLabels.length; i++) {
        const labelText = timeLabels[i].textContent.trim();
        if (!labelText) continue; // Skip empty labels
        // Parse time like "12am", "1am", "12pm", "1pm", "12:00 AM", "1:00 PM"
        const timeMatch = labelText.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1]);
          const isPM = timeMatch[3].toLowerCase() === "pm";

          // Convert to 24-hour format
          if (isPM && hour !== 12) {
            hour += 12;
          } else if (!isPM && hour === 12) {
            hour = 0;
          }
          calendarStartHour = hour;
          break; // Use the first non-empty time label
        }
      }

      // Get the scroll position of the time content area
      const scrollTop = timeContent.scrollTop || 0;

      // Calculate Y position relative to the TIME CONTENT area
      const relativeY = e.clientY - rect.top + scrollTop;

      // Get slot height from the actual time slot groups
      // Each .rbc-timeslot-group represents one hour when step=15 and timeslots=4
      // So each group contains 4 individual time slots
      // Query from a day-slot column (not the gutter) to get accurate rendered heights
      const daySlotForMeasure = calendarEl.querySelector(".rbc-day-slot");
      const timeSlotGroups = daySlotForMeasure
        ? daySlotForMeasure.querySelectorAll(".rbc-timeslot-group")
        : calendarEl.querySelectorAll(".rbc-timeslot-group");
      let slotHeight;
      if (timeSlotGroups.length > 1) {
        // Use the actual rendered height of a single time slot
        // Each group = 1 hour, each slot within = step minutes (15 min)
        const groupHeight = timeSlotGroups[0].offsetHeight;
        const slotsPerGroup = 4; // timeslots: 4 means 4 slots per group
        slotHeight = groupHeight / slotsPerGroup;
      } else {
        slotHeight = 12; // Reasonable fallback for 15-min slot
      }

      const minutesPerSlot = 15;
      const slotsFromTop = Math.floor(relativeY / slotHeight);
      const minutesFromCalendarStart = slotsFromTop * minutesPerSlot;

      // Add calendar start time to the calculated offset
      const totalMinutes = calendarStartHour * 60 + minutesFromCalendarStart;

      targetDate.setHours(Math.floor(totalMinutes / 60));
      targetDate.setMinutes(totalMinutes % 60);
      targetDate.setSeconds(0);
      targetDate.setMilliseconds(0);

      console.log("Drop calculated:", {
        date: targetDate.toLocaleString(),
        calendarStartHour,
        relativeY,
        scrollTop,
        clientY: e.clientY,
        rectTop: rect.top,
        slotHeight,
        slotsFromTop,
        minutesFromCalendarStart,
        totalMinutes,
        groupCount: timeSlotGroups.length,
        groupHeight:
          timeSlotGroups.length > 0 ? timeSlotGroups[0].offsetHeight : "N/A",
      });

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

    console.log("CalendarView rendering with events:", events); // Filter to get event calendars only
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
        onAddTaskList: this.props.onAddTaskList,
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
