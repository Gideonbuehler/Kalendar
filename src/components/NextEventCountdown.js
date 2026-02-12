// ============================================================================
// NextEventCountdown Component — NextEventCountdown.js
// ============================================================================
// Live countdown timer displayed in the app header.
// Shows one of three states:
//   1. Active event: 🔴 pulse + "[title] — Xh Ym left"
//   2. Upcoming event: countdown with urgency coloring (critical/high/medium/low)
//   3. No events: ✨ "No upcoming events"
//
// On hover, expands an animated dropdown showing ALL upcoming events.
// Updates every 15 seconds via setInterval for a smooth live countdown.
// ============================================================================

class NextEventCountdown extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      now: new Date(),
      isHovered: false,
    };
    this._interval = null;
    this._hoverTimeout = null;
  }

  componentDidMount() {
    // Update every 15 seconds for a live countdown
    this._interval = setInterval(() => {
      this.setState({ now: new Date() });
    }, 15000);
  }

  componentWillUnmount() {
    if (this._interval) clearInterval(this._interval);
    if (this._hoverTimeout) clearTimeout(this._hoverTimeout);
  }

  /**
   * _getActiveEvent — Finds any currently active event.
   * Returns the active event or null.
   */
  _getActiveEvent() {
    const { events } = this.props;
    if (!events || events.length === 0) return null;
    const now = this.state.now;
    return events
      .filter((e) => !e.isPreview)
      .find((e) => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        return now >= s && now <= en;
      }) || null;
  }

  /**
   * _getUpcomingEvents — Returns all upcoming (future) events sorted by start time.
   */
  _getUpcomingEvents() {
    const { events } = this.props;
    if (!events || events.length === 0) return [];
    const now = this.state.now;
    return events
      .filter((e) => !e.isPreview && new Date(e.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start));
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

  _handleMouseEnter = () => {
    if (this._hoverTimeout) clearTimeout(this._hoverTimeout);
    this.setState({ isHovered: true });
  };

  _handleMouseLeave = () => {
    this._hoverTimeout = setTimeout(() => {
      this.setState({ isHovered: false });
    }, 200);
  };

  render() {
    const h = React.createElement;
    const active = this._getActiveEvent();
    const upcoming = this._getUpcomingEvents();
    const { isHovered } = this.state;
    const now = this.state.now;

    // No events at all
    if (!active && upcoming.length === 0) {
      return h(
        "div",
        { className: "next-event-countdown idle" },
        h("span", { className: "next-event-icon" }, "✨"),
        h("span", { className: "next-event-label" }, "No upcoming events")
      );
    }

    // Determine primary display event and urgency
    const primaryEvent = active || upcoming[0];
    const isActive = !!active;
    const primaryStart = new Date(primaryEvent.start);
    const primaryEnd = new Date(primaryEvent.end);
    const diff = isActive ? (primaryEnd - now) : (primaryStart - now);
    const timeStr = this._formatDuration(diff);
    const urgency = isActive ? null : this._getUrgencyLevel(diff);

    const wrapperClass = isActive
      ? "next-event-countdown active"
      : `next-event-countdown upcoming urgency-${urgency}`;

    return h(
      "div",
      {
        className: `next-event-wrapper${isHovered && upcoming.length > (isActive ? 0 : 1) ? " expanded" : ""}`,
        onMouseEnter: this._handleMouseEnter,
        onMouseLeave: this._handleMouseLeave,
      },

      // Primary pill
      h(
        "div",
        {
          className: wrapperClass,
          title: isActive
            ? `${primaryEvent.title} — ends in ${timeStr}`
            : `${primaryEvent.title} at ${primaryStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
        },
        (isActive || urgency === "critical") && h("span", { className: "next-event-pulse" }),
        h("span", { className: "next-event-icon" },
          isActive ? "🔴"
            : urgency === "critical" ? "⚡"
            : urgency === "high" ? "🔔"
            : "⏳"
        ),
        h(
          "div",
          { className: "next-event-info" },
          h("span", { className: "next-event-title" }, primaryEvent.title),
          h("span", { className: "next-event-time" }, isActive ? `${timeStr} left` : `in ${timeStr}`)
        ),
        // Show chevron hint if there are more events
        upcoming.length > (isActive ? 0 : 1) &&
          h("span", { className: "next-event-expand-hint" }, "▾")
      ),

      // Dropdown with all upcoming events (shown on hover)
      upcoming.length > (isActive ? 0 : 1) &&
        h(
          "div",
          { className: "next-event-dropdown" },
          upcoming.slice(isActive ? 0 : 1, 6).map((ev, i) => {
            const evStart = new Date(ev.start);
            const evDiff = evStart - now;
            const evTime = this._formatDuration(evDiff);
            const evStartStr = evStart.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

            return h(
              "div",
              {
                key: ev.id || i,
                className: "next-event-dropdown-item",
                style: { animationDelay: `${i * 40}ms` },
              },
              h("span", { className: "next-event-dropdown-time" }, evStartStr),
              h("span", { className: "next-event-dropdown-title" }, ev.title),
              h("span", { className: "next-event-dropdown-countdown" }, `in ${evTime}`)
            );
          }),
          upcoming.length > (isActive ? 6 : 7) &&
            h(
              "div",
              { className: "next-event-dropdown-more" },
              `+${upcoming.length - (isActive ? 6 : 7)} more`
            )
        )
    );
  }
}

window.NextEventCountdown = NextEventCountdown;
