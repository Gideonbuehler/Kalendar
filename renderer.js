const { ipcRenderer } = require("electron");

// Use globals from CDN
const { Component, createElement: h } = React;
const { Calendar, momentLocalizer } = ReactBigCalendar;

const localizer = momentLocalizer(moment);

class CalendarApp extends Component {
  constructor(props) {
    super(props);
    this.state = {
      events: [],
      isConnected: false,
      serverUrl: "",
      username: "",
      password: "",
      calendarUrl: "",
      calendars: [],
      showLoginForm: true,
      showEventModal: false,
      newEvent: {
        title: "",
        start: new Date(),
        end: new Date(),
        description: "",
        location: "",
      },
    };
  }

  handleLogin = async (e) => {
    e.preventDefault();

    const result = await ipcRenderer.invoke("connect-caldav", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
    });

    if (result.success) {
      this.setState({
        isConnected: true,
        calendars: result.calendars,
        showLoginForm: false,
      });

      // Make sure we have calendars before trying to fetch events
      if (result.calendars && result.calendars.length > 0) {
        const calUrl = result.calendars[0].url;
        console.log("Calendar URL:", calUrl);
        console.log("Server URL:", this.state.serverUrl);
        this.setState({ calendarUrl: calUrl });
        // Wait for state to update before fetching events
        setTimeout(() => this.fetchEvents(calUrl), 100);
      } else {
        alert("No calendars found in your account");
      }
    } else {
      alert("Connection failed: " + result.error);
    }
  };

  fetchEvents = async (calendarUrl) => {
    console.log("Fetching events with:", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      hasPassword: !!this.state.password,
      calendarUrl: calendarUrl || this.state.calendarUrl,
    });

    const result = await ipcRenderer.invoke("fetch-events", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendarUrl: calendarUrl || this.state.calendarUrl,
    });

    if (result.success) {
      console.log("Events fetched:", result.events.length);
      this.setState({ events: result.events });
    } else {
      console.error("Failed to fetch events:", result.error);
      alert("Failed to fetch events: " + result.error);
    }
  };

  handleSelectSlot = ({ start, end }) => {
    this.setState({
      showEventModal: true,
      newEvent: {
        ...this.state.newEvent,
        start: start,
        end: end,
      },
    });
  };

  handleCreateEvent = async (e) => {
    e.preventDefault();

    const result = await ipcRenderer.invoke("create-event", {
      serverUrl: this.state.serverUrl,
      username: this.state.username,
      password: this.state.password,
      calendarUrl: this.state.calendarUrl,
      eventData: this.state.newEvent,
    });

    if (result.success) {
      this.setState({
        showEventModal: false,
        newEvent: {
          title: "",
          start: new Date(),
          end: new Date(),
          description: "",
          location: "",
        },
      });
      this.fetchEvents();
    } else {
      alert("Failed to create event: " + result.error);
    }
  };

  handleInputChange = (e) => {
    const { name, value } = e.target;
    this.setState({ [name]: value });
  };

  handleEventInputChange = (e) => {
    const { name, value } = e.target;
    this.setState({
      newEvent: {
        ...this.state.newEvent,
        [name]: value,
      },
    });
  };

  formatDateTimeLocal = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  render() {
    if (this.state.showLoginForm) {
      return h(
        "div",
        { className: "login-container" },
        h(
          "div",
          { className: "login-form" },
          h("h1", null, "Nextcloud Calendar"),
          h(
            "form",
            { onSubmit: this.handleLogin },
            h(
              "div",
              { className: "form-group" },
              h("label", null, "Nextcloud Server URL"),
              h("input", {
                type: "text",
                name: "serverUrl",
                value: this.state.serverUrl,
                onChange: this.handleInputChange,
                placeholder: "https://cloud.example.com",
                required: true,
              }),
              h(
                "small",
                {
                  style: {
                    color: "#666",
                    fontSize: "12px",
                    marginTop: "4px",
                    display: "block",
                  },
                },
                "Example: https://your-nextcloud-server.com (CalDAV path will be added automatically)"
              )
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "Username"),
              h("input", {
                type: "text",
                name: "username",
                value: this.state.username,
                onChange: this.handleInputChange,
                required: true,
              })
            ),
            h(
              "div",
              { className: "form-group" },
              h("label", null, "Password / App Password"),
              h("input", {
                type: "password",
                name: "password",
                value: this.state.password,
                onChange: this.handleInputChange,
                required: true,
              })
            ),
            h("button", { type: "submit", className: "btn-primary" }, "Connect")
          )
        )
      );
    }

    return h(
      "div",
      { className: "app-container" },
      h(
        "div",
        { className: "header" },
        h("h1", null, "Nextcloud Calendar"),
        h(
          "div",
          { className: "header-controls" },
          this.state.calendars.length > 1 &&
            h(
              "select",
              {
                value: this.state.calendarUrl,
                onChange: (e) => {
                  this.setState({ calendarUrl: e.target.value });
                  this.fetchEvents(e.target.value);
                },
              },
              this.state.calendars.map((cal, idx) =>
                h(
                  "option",
                  { key: idx, value: cal.url },
                  cal.displayName || `Calendar ${idx + 1}`
                )
              )
            ),
          h(
            "button",
            {
              onClick: () => this.fetchEvents(),
              className: "btn-secondary",
            },
            "Refresh"
          )
        )
      ),
      h(
        "div",
        { className: "calendar-container" },
        h(Calendar, {
          localizer: localizer,
          events: this.state.events,
          startAccessor: "start",
          endAccessor: "end",
          style: { height: "100%" },
          selectable: true,
          onSelectSlot: this.handleSelectSlot,
        })
      ),
      this.state.showEventModal &&
        h(
          "div",
          { className: "modal-overlay" },
          h(
            "div",
            { className: "modal" },
            h("h2", null, "Create New Event"),
            h(
              "form",
              { onSubmit: this.handleCreateEvent },
              h(
                "div",
                { className: "form-group" },
                h("label", null, "Title"),
                h("input", {
                  type: "text",
                  name: "title",
                  value: this.state.newEvent.title,
                  onChange: this.handleEventInputChange,
                  required: true,
                })
              ),
              h(
                "div",
                { className: "form-group" },
                h("label", null, "Start"),
                h("input", {
                  type: "datetime-local",
                  value: this.formatDateTimeLocal(this.state.newEvent.start),
                  onChange: (e) =>
                    this.setState({
                      newEvent: {
                        ...this.state.newEvent,
                        start: new Date(e.target.value),
                      },
                    }),
                  required: true,
                })
              ),
              h(
                "div",
                { className: "form-group" },
                h("label", null, "End"),
                h("input", {
                  type: "datetime-local",
                  value: this.formatDateTimeLocal(this.state.newEvent.end),
                  onChange: (e) =>
                    this.setState({
                      newEvent: {
                        ...this.state.newEvent,
                        end: new Date(e.target.value),
                      },
                    }),
                  required: true,
                })
              ),
              h(
                "div",
                { className: "form-group" },
                h("label", null, "Description"),
                h("textarea", {
                  name: "description",
                  value: this.state.newEvent.description,
                  onChange: this.handleEventInputChange,
                })
              ),
              h(
                "div",
                { className: "form-group" },
                h("label", null, "Location"),
                h("input", {
                  type: "text",
                  name: "location",
                  value: this.state.newEvent.location,
                  onChange: this.handleEventInputChange,
                })
              ),
              h(
                "div",
                { className: "modal-buttons" },
                h(
                  "button",
                  { type: "submit", className: "btn-primary" },
                  "Create Event"
                ),
                h(
                  "button",
                  {
                    type: "button",
                    className: "btn-secondary",
                    onClick: () => this.setState({ showEventModal: false }),
                  },
                  "Cancel"
                )
              )
            )
          )
        )
    );
  }
}

const root = ReactDOM.createRoot(document.getElementById("app"));
root.render(h(CalendarApp));
