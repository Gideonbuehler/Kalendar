// Next Event Countdown Component — live countdown to your next event in the header
class NextEventCountdown extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      now: new Date(),
    };
    this._interval = null;
  }

  componentDidMount() {
    // Update every 15 seconds for a live countdown
    this._interval = setInterval(() => {
      this.setState({ now: new Date() });
    }, 15000);
  }

  componentWillUnmount() {
    if (this._interval) clearInterval(this._interval);
  }

  _getNextEvent() {
    const { events } = this.props;
    if (!events || events.length === 0) return null;

    const now = this.state.now;
    // Find currently active event
    const active = events
      .filter((e) => !e.isPreview)
      .find((e) => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        return now >= s && now <= en;
      });

    if (active) {
      return { event: active, type: "active" };
    }

    // Find next upcoming event
    const upcoming = events
      .filter((e) => !e.isPreview && new Date(e.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (upcoming.length > 0) {
      return { event: upcoming[0], type: "upcoming" };
    }

    return null;
  }

  _formatDuration(ms) {
    const totalMins = Math.floor(ms / 60000);
    if (totalMins < 1) return "now";
    if (totalMins < 60) return `${totalMins}m`;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    if (h > 24) {
      const d = Math.floor(h / 24);
      return `${d}d`;
    }
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  _getUrgencyLevel(ms) {
    const mins = ms / 60000;
    if (mins <= 5) return "critical";
    if (mins <= 15) return "high";
    if (mins <= 30) return "medium";
    return "low";
  }

  render() {
    const h = React.createElement;
    const result = this._getNextEvent();

    if (!result) {
      return h(
        "div",
        { className: "next-event-countdown idle" },
        h("span", { className: "next-event-icon" }, "✨"),
        h("span", { className: "next-event-label" }, "No upcoming events")
      );
    }

    const { event, type } = result;
    const now = this.state.now;

    if (type === "active") {
      const end = new Date(event.end);
      const remaining = end - now;
      const timeLeft = this._formatDuration(remaining);

      return h(
        "div",
        { className: "next-event-countdown active", title: `${event.title} — ends in ${timeLeft}` },
        h("span", { className: "next-event-pulse" }),
        h("span", { className: "next-event-icon" }, "🔴"),
        h(
          "div",
          { className: "next-event-info" },
          h("span", { className: "next-event-title" }, event.title),
          h("span", { className: "next-event-time" }, `${timeLeft} left`)
        )
      );
    }

    // Upcoming
    const start = new Date(event.start);
    const diff = start - now;
    const timeUntil = this._formatDuration(diff);
    const urgency = this._getUrgencyLevel(diff);

    const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    return h(
      "div",
      {
        className: `next-event-countdown upcoming urgency-${urgency}`,
        title: `${event.title} at ${startTime}`,
      },
      urgency === "critical" && h("span", { className: "next-event-pulse" }),
      h("span", { className: "next-event-icon" }, urgency === "critical" ? "⚡" : urgency === "high" ? "🔔" : "⏳"),
      h(
        "div",
        { className: "next-event-info" },
        h("span", { className: "next-event-title" }, event.title),
        h("span", { className: "next-event-time" }, `in ${timeUntil}`)
      )
    );
  }
}

window.NextEventCountdown = NextEventCountdown;
