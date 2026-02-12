// ============================================================================
// EventInsights Component — EventInsights.js
// ============================================================================
// Smart pattern detection and schedule analysis widget.
// Displayed in the Activity tab of the sidebar.
//
// Insights generated:
//   1. Busiest day of the week (by event count)
//   2. Most repeated event title
//   3. Average events per day (last 2 weeks)
//   4. Peak hour (most events start at)
//   5. Free time remaining today (within 8am–6pm working window)
//   6. Longest upcoming event
//   7. Task completion rate (across all task lists)
//
// Each insight includes an emoji icon, text, detail, and a type
// (stat/pattern/positive/warning) for styling differentiation.
// ============================================================================

class EventInsights extends React.Component {
  constructor(props) {
    super(props);
    this.state = {};
  }

  _dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  _getInsights() {
    const { events, taskLists } = this.props;
    const insights = [];
    if (!events || events.length === 0) return insights;

    const now = new Date();
    const realEvents = events.filter((e) => !e.isPreview);

    // === 1. Busiest day of the week ===
    const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    realEvents.forEach((e) => {
      const d = new Date(e.start);
      dayCounts[d.getDay()]++;
    });
    const busiestDayIdx = dayCounts.indexOf(Math.max(...dayCounts));
    if (dayCounts[busiestDayIdx] > 0) {
      insights.push({
        icon: "📊",
        text: `Busiest day: ${dayNames[busiestDayIdx]}`,
        detail: `${dayCounts[busiestDayIdx]} events total`,
        type: "stat",
      });
    }

    // === 2. Most common event (by title) ===
    const titleCounts = {};
    realEvents.forEach((e) => {
      const t = e.title.trim().toLowerCase();
      titleCounts[t] = (titleCounts[t] || 0) + 1;
    });
    const sortedTitles = Object.entries(titleCounts).sort((a, b) => b[1] - a[1]);
    if (sortedTitles.length > 0 && sortedTitles[0][1] > 1) {
      const [title, count] = sortedTitles[0];
      // Find original casing
      const original = realEvents.find((e) => e.title.trim().toLowerCase() === title);
      insights.push({
        icon: "🔁",
        text: `"${original ? original.title : title}" repeats`,
        detail: `${count} times`,
        type: "pattern",
      });
    }

    // === 3. Average events per day (last 2 weeks) ===
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const recentEvents = realEvents.filter(
      (e) => new Date(e.start) >= twoWeeksAgo && new Date(e.start) <= now
    );
    const uniqueDays = new Set(recentEvents.map((e) => this._dateKey(new Date(e.start))));
    const avgPerDay = uniqueDays.size > 0 ? (recentEvents.length / 14).toFixed(1) : 0;
    if (recentEvents.length > 0) {
      insights.push({
        icon: "📈",
        text: `~${avgPerDay} events/day`,
        detail: "Last 2 weeks avg",
        type: "stat",
      });
    }

    // === 4. Peak hour ===
    const hourCounts = new Array(24).fill(0);
    realEvents.forEach((e) => {
      hourCounts[new Date(e.start).getHours()]++;
    });
    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));
    if (hourCounts[peakHour] > 0) {
      const ampm = peakHour >= 12 ? "PM" : "AM";
      const h12 = peakHour % 12 || 12;
      insights.push({
        icon: "⏰",
        text: `Peak hour: ${h12} ${ampm}`,
        detail: `${hourCounts[peakHour]} events`,
        type: "stat",
      });
    }

    // === 5. Free time today ===
    const todayEvents = realEvents
      .filter((e) => {
        const d = new Date(e.start);
        return (
          d.getDate() === now.getDate() &&
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));

    if (todayEvents.length > 0) {
      // Calculate free time between events (8am-6pm working window)
      const workStart = 8 * 60; // minutes
      const workEnd = 18 * 60;
      let busyMins = 0;
      todayEvents.forEach((e) => {
        const s = new Date(e.start);
        const en = new Date(e.end);
        const sm = Math.max(s.getHours() * 60 + s.getMinutes(), workStart);
        const em = Math.min(en.getHours() * 60 + en.getMinutes(), workEnd);
        if (em > sm) busyMins += em - sm;
      });
      const freeMins = Math.max(0, workEnd - workStart - busyMins);
      const freeHrs = Math.floor(freeMins / 60);
      const freeM = freeMins % 60;
      const freeStr = freeHrs > 0 ? `${freeHrs}h ${freeM}m` : `${freeM}m`;

      insights.push({
        icon: freeMins < 60 ? "🔥" : "🟢",
        text: `${freeStr} free today`,
        detail: freeMins < 60 ? "Packed schedule!" : "In working hours",
        type: freeMins < 60 ? "warning" : "positive",
      });
    } else {
      insights.push({
        icon: "🌴",
        text: "No events today",
        detail: "Enjoy the free time!",
        type: "positive",
      });
    }

    // === 6. Longest event coming up ===
    const upcomingEvents = realEvents
      .filter((e) => new Date(e.start) > now)
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 30);
    if (upcomingEvents.length > 0) {
      let longest = upcomingEvents[0];
      let longestDuration = 0;
      upcomingEvents.forEach((e) => {
        const dur = new Date(e.end) - new Date(e.start);
        if (dur > longestDuration) {
          longestDuration = dur;
          longest = e;
        }
      });
      const hrs = Math.floor(longestDuration / 3600000);
      const mins = Math.floor((longestDuration % 3600000) / 60000);
      const durStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
      insights.push({
        icon: "📏",
        text: `Longest: ${longest.title}`,
        detail: durStr,
        type: "stat",
      });
    }

    // === 7. Task completion rate ===
    if (taskLists && taskLists.length > 0) {
      let total = 0;
      let done = 0;
      taskLists.forEach((list) => {
        if (list.tasks) {
          list.tasks.forEach((t) => {
            total++;
            if (t.completed) done++;
          });
        }
      });
      if (total > 0) {
        const pct = Math.round((done / total) * 100);
        insights.push({
          icon: pct >= 75 ? "🏆" : pct >= 50 ? "👍" : "📝",
          text: `Tasks: ${pct}% done`,
          detail: `${done}/${total} completed`,
          type: pct >= 75 ? "positive" : "stat",
        });
      }
    }

    return insights;
  }

  render() {
    const h = React.createElement;
    const insights = this._getInsights();

    if (insights.length === 0) {
      return h(
        "div",
        { className: "event-insights" },
        h(
          "div",
          { className: "event-insights-header" },
          h("span", { className: "sidebar-section-title" }, "Insights")
        ),
        h(
          "div",
          { className: "event-insights-empty" },
          "Add events to see insights"
        )
      );
    }

    return h(
      "div",
      { className: "event-insights" },
      h(
        "div",
        { className: "event-insights-header" },
        h("span", { className: "sidebar-section-title" }, "Insights"),
        h("span", { className: "event-insights-badge" }, `${insights.length}`)
      ),
      h(
        "div",
        { className: "event-insights-list" },
        insights.map((insight, idx) =>
          h(
            "div",
            {
              key: idx,
              className: `event-insight-item ${insight.type}`,
            },
            h("span", { className: "event-insight-icon" }, insight.icon),
            h(
              "div",
              { className: "event-insight-text" },
              h("span", { className: "event-insight-main" }, insight.text),
              h("span", { className: "event-insight-detail" }, insight.detail)
            )
          )
        )
      )
    );
  }
}

window.EventInsights = EventInsights;
