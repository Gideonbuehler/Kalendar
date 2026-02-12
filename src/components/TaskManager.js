// ============================================================================
// TaskManager Component — TaskManager.js
// ============================================================================
// Inline sidebar section for managing task lists and individual tasks.
// Features:
//   - Expandable/collapsible task lists with colored dots
//   - Inline forms for creating new lists and tasks
//   - Task completion toggles with progress counters
//   - Drag-and-drop tasks onto the calendar (creates calendar events)
//   - Custom drag images with themed styling
//
// Task data is currently stored locally in state. TODO: Sync via CalDAV VTODO.
// ============================================================================

class TaskManager extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      expandedLists: {},
      showNewListForm: false,
      showNewTaskForm: {},
      newListName: "",
      newTaskName: "",
      selectedList: null,
    };
  }

  toggleList = (listId) => {
    this.setState((prevState) => ({
      expandedLists: {
        ...prevState.expandedLists,
        [listId]: !prevState.expandedLists[listId],
      },
    }));
  };

  handleCreateList = () => {
    const { newListName } = this.state;
    if (newListName.trim()) {
      if (this.props.onCreateList) this.props.onCreateList(newListName.trim());
      if (this.props.onAddTaskList)
        this.props.onAddTaskList(newListName.trim());
      this.setState({ newListName: "", showNewListForm: false });
    }
  };

  handleCreateTask = (listId) => {
    const { newTaskName } = this.state;
    if (newTaskName.trim()) {
      if (this.props.onCreateTask)
        this.props.onCreateTask(listId, newTaskName.trim());
      this.setState({
        newTaskName: "",
        showNewTaskForm: { ...this.state.showNewTaskForm, [listId]: false },
      });
    }
  };

  /**
   * handleDragStart — Initiates a native HTML5 drag from a task element.
   * Sets application/json data for the drop handler, creates a styled
   * drag image (ghost), and notifies the parent CalendarView to start
   * tracking the drag for preview rendering.
   */
  handleDragStart = (e, task, list) => {
    const dragData = JSON.stringify({
      type: "task",
      task: task,
      listId: list.id,
      listName: list.name,
    });
    console.log("Drag started for task:", task.name);

    e.dataTransfer.setData("application/json", dragData);
    e.dataTransfer.effectAllowed = "copy";

    // Create a nicer drag image
    const dragEl = e.target.cloneNode(true);
    dragEl.style.position = "absolute";
    dragEl.style.top = "-1000px";
    dragEl.style.background = "var(--primary-color)";
    dragEl.style.color = "white";
    dragEl.style.padding = "6px 12px";
    dragEl.style.borderRadius = "6px";
    dragEl.style.fontSize = "12px";
    dragEl.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
    dragEl.style.width = "auto";
    document.body.appendChild(dragEl);
    e.dataTransfer.setDragImage(dragEl, 0, 0);
    setTimeout(() => document.body.removeChild(dragEl), 0);

    // Call parent handler to update global drag state
    if (this.props.onDragStart) {
      this.props.onDragStart({
        type: "task",
        task: task,
        listId: list.id,
        listName: list.name,
      });
    }
  };

  getListColor(listName) {
    const colors = [
      "#5e72e4", "#11cdef", "#2dce89", "#fb6340",
      "#f5365c", "#ffd600", "#172b4d", "#8965e0",
    ];
    const index = listName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[index % colors.length];
  }

  render() {
    const { taskLists, onToggleTask, onDeleteTask, onDeleteList } = this.props;
    const {
      expandedLists,
      showNewListForm,
      showNewTaskForm,
      newListName,
      newTaskName,
    } = this.state;

    const h = React.createElement;

    return h(
      "div",
      { className: "sidebar-tasks" },

      // Section Header
      h(
        "div",
        { className: "sidebar-section-header" },
        h("span", { className: "sidebar-section-title" }, "Tasks"),
        h(
          "button",
          {
            className: "sidebar-add-calendar",
            onClick: () => this.setState({ showNewListForm: !showNewListForm }),
            title: "Add task list",
          },
          "+"
        )
      ),

      // New List Form
      showNewListForm &&
        h(
          "div",
          { className: "new-task-inline-form" },
          h("input", {
            type: "text",
            placeholder: "New list name...",
            value: newListName,
            onChange: (e) => this.setState({ newListName: e.target.value }),
            onKeyPress: (e) => {
              if (e.key === "Enter") this.handleCreateList();
            },
            autoFocus: true,
            className: "inline-input",
          }),
          h(
            "div",
            { className: "inline-form-actions" },
            h(
              "button",
              {
                className: "inline-btn-confirm",
                onClick: this.handleCreateList,
              },
              "✓"
            ),
            h(
              "button",
              {
                className: "inline-btn-cancel",
                onClick: () =>
                  this.setState({ showNewListForm: false, newListName: "" }),
              },
              "✕"
            )
          )
        ),

      // Task Lists
      h(
        "div",
        { className: "sidebar-task-lists" },
        taskLists && taskLists.length > 0
          ? taskLists.map((list) =>
              h(
                "div",
                { key: list.id, className: "sidebar-task-list" },

                // List Header
                h(
                  "div",
                  {
                    className: "task-list-header-compact",
                    onClick: () => this.toggleList(list.id),
                  },
                  h(
                    "span",
                    { className: "expand-icon" },
                    expandedLists[list.id] ? "▾" : "▸"
                  ),
                  h("span", {
                    className: "list-color-dot",
                    style: { backgroundColor: this.getListColor(list.name) },
                  }),
                  h("span", { className: "list-name-compact" }, list.name),
                  h(
                    "span",
                    { className: "task-count-compact" },
                    `${
                      list.tasks
                        ? list.tasks.filter((t) => t.completed).length
                        : 0
                    }/${list.tasks ? list.tasks.length : 0}`
                  ),
                  h(
                    "button",
                    {
                      className: "sidebar-add-task-btn",
                      onClick: (e) => {
                        e.stopPropagation();
                        this.setState((prev) => ({
                          showNewTaskForm: {
                            ...prev.showNewTaskForm,
                            [list.id]: true,
                          },
                          expandedLists: {
                            ...prev.expandedLists,
                            [list.id]: true,
                          },
                        }));
                      },
                      title: "Add task",
                    },
                    "+"
                  )
                ),

                // Expanded: New Task Form + Tasks
                expandedLists[list.id] && [
                  // New Task Form
                  showNewTaskForm[list.id] &&
                    h(
                      "div",
                      { key: "form", className: "new-task-inline-form" },
                      h("input", {
                        type: "text",
                        placeholder: "New task...",
                        value: newTaskName,
                        onChange: (e) =>
                          this.setState({ newTaskName: e.target.value }),
                        onKeyPress: (e) => {
                          if (e.key === "Enter") this.handleCreateTask(list.id);
                        },
                        autoFocus: true,
                        className: "inline-input",
                      }),
                      h(
                        "div",
                        { className: "inline-form-actions" },
                        h(
                          "button",
                          {
                            className: "inline-btn-confirm",
                            onClick: () => this.handleCreateTask(list.id),
                          },
                          "✓"
                        ),
                        h(
                          "button",
                          {
                            className: "inline-btn-cancel",
                            onClick: () =>
                              this.setState((prev) => ({
                                showNewTaskForm: {
                                  ...prev.showNewTaskForm,
                                  [list.id]: false,
                                },
                                newTaskName: "",
                              })),
                          },
                          "✕"
                        )
                      )
                    ),

                  // Task Items
                  h(
                    "div",
                    { key: "tasks", className: "sidebar-task-items" },
                    list.tasks && list.tasks.length > 0
                      ? list.tasks.map((task) =>
                          h(
                            "div",
                            {
                              key: task.id,
                              className: `sidebar-task-item ${
                                task.completed ? "completed" : ""
                              }`,
                              style: { '--list-color': this.getListColor(list.name) },
                              draggable: true,
                              onDragStart: (e) =>
                                this.handleDragStart(e, task, list),
                              onClick: () => {
                                if (this.props.onTaskClick) {
                                  this.props.onTaskClick(list.id, task.id);
                                }
                              },
                            },
                            h("span", { className: "task-drag-handle" }, "⠿"),
                            h("input", {
                              type: "checkbox",
                              className: "sidebar-task-checkbox",
                              checked: task.completed || false,
                              onClick: (e) => {
                                e.stopPropagation();
                              },
                              onChange: (e) => {
                                e.stopPropagation();
                                if (onToggleTask)
                                  onToggleTask(list.id, task.id);
                              },
                            }),
                            h(
                              "span",
                              { className: "sidebar-task-name" },
                              task.name
                            ),
                            h(
                              "button",
                              {
                                className: "task-to-calendar-btn",
                                onClick: (e) => {
                                  e.stopPropagation();
                                  if (this.props.onTaskToCalendar) {
                                    this.props.onTaskToCalendar(
                                      list.id,
                                      task.id
                                    );
                                  }
                                },
                                title: "Add to calendar",
                              },
                              "📅"
                            )
                          )
                        )
                      : h(
                          "div",
                          { className: "no-tasks-sidebar" },
                          "No tasks yet"
                        )
                  ),
                ]
              )
            )
          : h(
              "div",
              { className: "no-tasks-sidebar" },
              "No task lists. Click + to create one."
            )
      )
    );
  }
}

window.TaskManager = TaskManager;
