// Day Timeline Component — compact vertical timeline showing today's events at a glance
class DayTimeline extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  _isSameDay(d1, d2) {
    if (!d1 || !d2) return false;
    const a = d1 instanceof Date ? d1 : new Date(d1);
    const b = d2 instanceof Date ? d2 : new Date(d2);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  _getTodayEvents() {
    const { events, selectedDate } = this.props;
    if (!events) return [];
    const target = selectedDate || new Date();
    return events
      .filter((e) => {
        if (e.isPreview) return false;
        const start = new Date(e.start);
        return this._isSameDay(start, target);
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  _getTimeColor(hour) {
    if (hour >= 5 && hour < 9) return "#f6d365";
    if (hour >= 9 && hour < 12) return "#fa709a";
    if (hour >= 12 && hour < 14) return "#a18cd1";
    if (hour >= 14 && hour < 17) return "#667eea";
    if (hour >= 17 && hour < 20) return "#f093fb";
    return "#4facfe";
  }

  _formatTime(date) {
    const d = new Date(date);
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "p" : "a";
    const hr = h % 12 || 12;
    return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
  }

  _getCurrentHourPercent() {
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;
  }

  render() {
    const h = React.createElement;
    const todayEvents = this._getTodayEvents();
    const { selectedDate } = this.props;
    const target = selectedDate || new Date();
    const isToday = this._isSameDay(target, new Date());

    const dayLabel = isToday
      ? "Today"
      : target.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

    if (todayEvents.length === 0) {
      return h(
        "div",
        { className: "day-timeline" },
        h(
          "div",
          { className: "day-timeline-header" },
          h("span", { className: "day-timeline-title" }, dayLabel),
          h("span", { className: "day-timeline-count" }, "No events")
        ),
        h(
          "div",
          { className: "day-timeline-empty" },
          h("span", { className: "day-timeline-empty-icon" }, "🌤️"),
          h("span", null, "Clear schedule")
        )
      );
    }

    // Calculate timeline (6am to midnight, or extend to cover events)
    let startHour = 6;
    let endHour = 23;
    todayEvents.forEach((ev) => {
      const sh = new Date(ev.start).getHours();
      const eh = new Date(ev.end).getHours();
      if (sh < startHour) startHour = Math.max(0, sh);
      if (eh > endHour) endHour = Math.min(24, eh + 1);
    });
    const totalMinutes = (endHour - startHour) * 60;

    return h(
      "div",
      { className: "day-timeline" },
      h(
        "div",
        { className: "day-timeline-header" },
        h("span", { className: "day-timeline-title" }, dayLabel),
        h("span", { className: "day-timeline-count" }, `${todayEvents.length} event${todayEvents.length !== 1 ? "s" : ""}`)
      ),
      h(
        "div",
        { className: "day-timeline-track" },
        // Hour markers
        Array.from({ length: endHour - startHour + 1 }, (_, i) => {
          const hour = startHour + i;
          if (hour > endHour) return null;
          const pct = ((hour - startHour) * 60 / totalMinutes) * 100;
          const label = hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;
          return h(
            "div",
            {
              key: `h-${hour}`,
              className: "day-timeline-hour-mark",
              style: { left: `${pct}%` },
            },
            i % 2 === 0 ? h("span", { className: "day-timeline-hour-label" }, label) : null
          );
        }),
        // Now indicator
        isToday &&
          (() => {
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const pct = ((nowMin - startHour * 60) / totalMinutes) * 100;
            if (pct >= 0 && pct <= 100) {
              return h("div", {
                className: "day-timeline-now",
                style: { left: `${pct}%` },
                title: "Now",
              });
            }
            return null;
          })(),
        // Event blocks
        todayEvents.map((ev, idx) => {
          const evStart = new Date(ev.start);
          const evEnd = new Date(ev.end);
          const startMin = evStart.getHours() * 60 + evStart.getMinutes();
          const endMin = evEnd.getHours() * 60 + evEnd.getMinutes();
          const left = ((startMin - startHour * 60) / totalMinutes) * 100;
          const width = Math.max(((endMin - startMin) / totalMinutes) * 100, 2);
          const color = this._getTimeColor(evStart.getHours());

          return h("div", {
            key: idx,
            className: "day-timeline-event",
            style: {
              left: `${Math.max(0, left)}%`,
              width: `${Math.min(width, 100 - left)}%`,
              backgroundColor: color,
            },
            title: `${ev.title}\n${this._formatTime(evStart)} – ${this._formatTime(evEnd)}`,
          });
        })
      ),
      // Event list
      h(
        "div",
        { className: "day-timeline-list" },
        todayEvents.slice(0, 4).map((ev, idx) => {
          const evStart = new Date(ev.start);
          const color = this._getTimeColor(evStart.getHours());
          const now = new Date();
          const isActive = isToday && now >= new Date(ev.start) && now <= new Date(ev.end);

          return h(
            "div",
            {
              key: idx,
              className: `day-timeline-list-item ${isActive ? "active" : ""}`,
            },
            h("span", {
              className: "day-timeline-dot",
              style: { backgroundColor: color },
            }),
            h(
              "div",
              { className: "day-timeline-list-text" },
              h("span", { className: "day-timeline-list-time" }, this._formatTime(evStart)),
              h("span", { className: "day-timeline-list-title" }, ev.title)
            )
          );
        }),
        todayEvents.length > 4 &&
          h("div", { className: "day-timeline-more" }, `+${todayEvents.length - 4} more`)
      )
    );
  }
}

window.DayTimeline = DayTimeline;
