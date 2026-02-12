// ============================================================================
// ContextMenu Component — ContextMenu.js
// ============================================================================
// A floating right-click context menu for event actions (Edit / Delete).
// Positioned at the click coordinates and automatically repositioned if
// it would overflow the viewport edges. Closes on outside click.
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

  // Reposition menu if it would extend beyond the viewport edges
  componentDidUpdate(prevProps) {
    // Reposition menu if it would go off-screen
    if (this.props.visible && this.menuRef.current) {
      const menu = this.menuRef.current;
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = 8;
      let newLeft = this.props.x;
      let newTop = this.props.y;

      if (rect.right > vw - pad) {
        newLeft = vw - rect.width - pad;
      }
      if (rect.bottom > vh - pad) {
        newTop = vh - rect.height - pad;
      }
      if (newLeft < pad) newLeft = pad;
      if (newTop < pad) newTop = pad;

      if (newLeft !== this.props.x || newTop !== this.props.y) {
        menu.style.left = `${newLeft}px`;
        menu.style.top = `${newTop}px`;
      }
    }
  }

  render() {
    const { visible, x, y, onEdit, onDelete, onClose, event } = this.props;

    if (!visible || !event) return null;

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
        h("div", { className: "context-menu-title" }, event.title || "Event"),
        h(
          "button",
          {
            className: "context-menu-close",
            onClick: onClose,
            title: "Close",
          },
          "×"
        )
      ),
      h(
        "div",
        { className: "context-menu-items" },
        h(
          "button",
          {
            className: "context-menu-item",
            onClick: () => {
              onEdit(event);
              onClose();
            },
          },
          h("span", { className: "context-menu-icon" }, "✏️"),
          h("span", { className: "context-menu-text" }, "Edit Event")
        ),
        h(
          "button",
          {
            className: "context-menu-item context-menu-item-danger",
            onClick: () => {
              if (
                confirm(`Are you sure you want to delete "${event.title}"?`)
              ) {
                onDelete(event);
                onClose();
              }
            },
          },
          h("span", { className: "context-menu-icon" }, "🗑️"),
          h("span", { className: "context-menu-text" }, "Delete Event")
        )
      )
    );
  }
}

window.ContextMenu = ContextMenu;
