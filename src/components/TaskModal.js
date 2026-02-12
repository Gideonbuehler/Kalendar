// Task Modal Component - Edit tasks and add them to calendar
class TaskModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      taskName: props.task?.name || "",
      dueDate: props.task?.dueDate || "",
      dueTime: props.task?.dueTime || "09:00",
      duration: props.task?.duration || 60, // minutes
      notes: props.task?.notes || "",
      addToCalendar: false,
    };
  }

  handleSubmit = (e) => {
    e.preventDefault();
    const { taskName, dueDate, dueTime, duration, notes, addToCalendar } =
      this.state;

    if (!taskName.trim()) {
      alert("Please enter a task name");
      return;
    }

    const taskData = {
      name: taskName,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      duration: parseInt(duration),
      notes: notes,
      completed: this.props.task?.completed || false,
    };

    if (addToCalendar && dueDate && dueTime) {
      // Create calendar event from task
      const [year, month, day] = dueDate.split("-").map(Number);
      const [hours, minutes] = dueTime.split(":").map(Number);

      const startDate = new Date(year, month - 1, day, hours, minutes);
      const endDate = new Date(startDate.getTime() + duration * 60000);

      this.props.onAddToCalendar({
        title: taskName,
        start: startDate,
        end: endDate,
        description: notes || `Task from list: ${this.props.listName}`,
        location: "",
      });
    } else {
      this.props.onSubmit(taskData);
    }
  };

  render() {
    const { onClose, listName, isEdit } = this.props;
    const { taskName, dueDate, dueTime, duration, notes, addToCalendar } =
      this.state;

    return React.createElement(
      "div",
      { className: "modal-overlay", onClick: onClose },
      React.createElement(
        "div",
        {
          className: "modal task-modal",
          onClick: (e) => e.stopPropagation(),
        },
        React.createElement(
          "div",
          { className: "modal-header" },
          React.createElement("h2", null, isEdit ? "Edit Task" : "Add Task"),
          React.createElement(
            "span",
            { className: "modal-subtitle" },
            `in ${listName}`
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
          "form",
          {
            className: "modal-body",
            onSubmit: this.handleSubmit,
          },
          React.createElement(
            "div",
            { className: "form-group" },
            React.createElement("label", null, "Task Name *"),
            React.createElement("input", {
              type: "text",
              value: taskName,
              onChange: (e) => this.setState({ taskName: e.target.value }),
              placeholder: "e.g., Complete homework",
              required: true,
              autoFocus: true,
            })
          ),
          React.createElement(
            "div",
            { className: "form-row" },
            React.createElement(
              "div",
              { className: "form-group" },
              React.createElement("label", null, "Due Date"),
              React.createElement("input", {
                type: "date",
                value: dueDate,
                onChange: (e) => this.setState({ dueDate: e.target.value }),
              })
            ),
            React.createElement(
              "div",
              { className: "form-group" },
              React.createElement("label", null, "Time"),
              React.createElement("input", {
                type: "time",
                value: dueTime,
                onChange: (e) => this.setState({ dueTime: e.target.value }),
                disabled: !dueDate,
              })
            )
          ),
          React.createElement(
            "div",
            { className: "form-group" },
            React.createElement("label", null, "Duration (minutes)"),
            React.createElement("input", {
              type: "number",
              value: duration,
              onChange: (e) => this.setState({ duration: e.target.value }),
              min: 5,
              step: 5,
            })
          ),
          React.createElement(
            "div",
            { className: "form-group" },
            React.createElement("label", null, "Notes"),
            React.createElement("textarea", {
              value: notes,
              onChange: (e) => this.setState({ notes: e.target.value }),
              placeholder: "Add any additional details...",
              rows: 3,
            })
          ),
          dueDate &&
            React.createElement(
              "div",
              { className: "form-group" },
              React.createElement(
                "label",
                { className: "checkbox-label" },
                React.createElement("input", {
                  type: "checkbox",
                  checked: addToCalendar,
                  onChange: (e) =>
                    this.setState({ addToCalendar: e.target.checked }),
                }),
                React.createElement("span", null, "📅 Add to calendar")
              )
            ),
          React.createElement(
            "div",
            { className: "modal-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "btn-secondary",
                onClick: onClose,
              },
              "Cancel"
            ),
            React.createElement(
              "button",
              {
                type: "submit",
                className: "btn-primary",
              },
              addToCalendar ? "Add to Calendar" : isEdit ? "Save" : "Add Task"
            )
          )
        )
      )
    );
  }
}

window.TaskModal = TaskModal;
