// Context Menu Component for Event Actions
class ContextMenu extends React.Component {
  constructor(props) {
    super(props);
    this.menuRef = React.createRef();
    this.handleClickOutside = this.handleClickOutside.bind(this);
  }

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
