// ============================================================================
// ContextMenu Component — ContextMenu.js
// ============================================================================
// A floating popover shown when an event is clicked (or right-clicked).
// Shows the event's details (time, calendar, location, description) and its
// actions: Edit, and Delete (this occurrence / all occurrences for repeating
// events). Positioned at the click coordinates and automatically repositioned
// if it would overflow the viewport edges. Closes on outside click.
// ============================================================================

class ContextMenu extends React.Component {
  constructor(props) {
    super(props);
    this.menuRef = React.createRef();
    this.handleClickOutside = this.handleClickOutside.bind(this);
  }

  // Register global listeners to detect clicks outside the menu
  componentDidMount() {
    document.addEventListener("mousedown", this.handleClickOutside);
    document.addEventListener("contextmenu", this.handleContextMenu);
  }

  componentWillUnmount() {
    document.removeEventListener("mousedown", this.handleClickOutside);
    document.removeEventListener("contextmenu", this.handleContextMenu);
  }

  handleClickOutside(event) {
    if (this.menuRef.current && !this.menuRef.current.contains(event.target)) {
      this.props.onClose();
    }
  }

  handleContextMenu = (e) => {
    // Prevent default context menu when our custom menu is open
    if (this.props.visible) {
      e.preventDefault();
    }
  };

  /**
   * Places the menu next to the clicked event (right side, or left if there's
   * no room), falling back to the click position, and keeps it on screen.
   */
  componentDidUpdate(prevProps) {
    if (this.props.visible && this.menuRef.current) {
      const menu = this.menuRef.current;
      const { width, height } = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 8;
      const gap = 8;
      const { anchor, x, y } = this.props;

      let left = x + gap;
      let top = y + gap;
      if (anchor) {
        top = anchor.top;
        if (anchor.right + gap + width <= vw - pad) left = anchor.right + gap;
        else if (anchor.left - gap - width >= pad) left = anchor.left - gap - width;
        else top = anchor.bottom + gap; // No room beside it: go below
      }

      left = Math.max(pad, Math.min(left, vw - width - pad));
      top = Math.max(pad, Math.min(top, vh - height - pad));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }
  }

  /** Human-readable date/time range, e.g. "Tue, Oct 27 · 9:00 AM – 10:30 AM". */
  _formatWhen(event) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const dayFmt = { weekday: "short", month: "short", day: "numeric" };
    const day = (d) => d.toLocaleDateString(undefined, dayFmt);

    if (event.allDay) {
      const lastDay = new Date(end.getTime() - 12 * 60 * 60 * 1000);
      return lastDay.toDateString() === start.toDateString()
        ? `${day(start)} · All day`
        : `${day(start)} – ${day(lastDay)} · All day`;
    }

    const timeFmt = {
      hour: "numeric",
      minute: "2-digit",
      hour12: this.props.timeFormat !== "24h",
    };
    const time = (d) => d.toLocaleTimeString(undefined, timeFmt);
    return start.toDateString() === end.toDateString()
      ? `${day(start)} · ${time(start)} – ${time(end)}`
      : `${day(start)} ${time(start)} – ${day(end)} ${time(end)}`;
  }

  _renderItem(text, onClick, danger) {
    return h(
      "button",
      {
        className: `context-menu-item${danger ? " context-menu-item-danger" : ""}`,
        onClick,
      },
      h("span", { className: "context-menu-text" }, text)
    );
  }

  render() {
    const { visible, x, y, onEdit, onDelete, onClose, event, calendars } = this.props;

    if (!visible || !event) return null;

    const calendar = (calendars || []).find((c) => c.url === event.calendarUrl);
    const title = event.title || "Event";
    const confirmDelete = (message, scope) => {
      if (confirm(message)) {
        onDelete(event, scope);
        onClose();
      }
    };

    return h(
      "div",
      {
        ref: this.menuRef,
        className: "context-menu",
        style: {
          position: "fixed",
          top: `${y}px`,
          left: `${x}px`,
          zIndex: 10000,
        },
      },
      h(
        "div",
        { className: "context-menu-header" },
        h("div", { className: "context-menu-title", title }, title),
        h(
          "button",
          {
            className: "context-menu-close",
            onClick: onClose,
            title: "Close (Esc)",
          },
          "×"
        )
      ),
      h(
        "div",
        { className: "context-menu-details" },
        h("div", { className: "context-menu-when" }, this._formatWhen(event)),
        event.recurring &&
          h("div", { className: "context-menu-detail" }, "↻ Repeating event"),
        calendar &&
          h(
            "div",
            { className: "context-menu-detail" },
            h("span", {
              className: "context-menu-cal-dot",
              style: { backgroundColor: calendar.color || "var(--primary-color)" },
            }),
            calendar.displayName
          ),
        event.location &&
          h("div", { className: "context-menu-detail" }, event.location),
        event.description &&
          h("div", { className: "context-menu-description" }, event.description)
      ),
      h(
        "div",
        { className: "context-menu-items" },
        this._renderItem("Edit Event", () => onEdit(event)),
        event.recurring
          ? [
              h(
                React.Fragment,
                { key: "occurrence" },
                this._renderItem(
                  "Delete This Occurrence",
                  () => confirmDelete(`Delete this occurrence of "${title}"?`, "occurrence"),
                  true
                )
              ),
              h(
                React.Fragment,
                { key: "series" },
                this._renderItem(
                  "Delete All Occurrences",
                  () => confirmDelete(`Delete ALL occurrences of "${title}"?`, "series"),
                  true
                )
              ),
            ]
          : this._renderItem(
              "Delete Event",
              () => confirmDelete(`Are you sure you want to delete "${title}"?`, "series"),
              true
            )
      )
    );
  }
}

window.ContextMenu = ContextMenu;
