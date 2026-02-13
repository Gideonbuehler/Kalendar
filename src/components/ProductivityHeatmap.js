// ============================================================================
// ProductivityHeatmap Component — ProductivityHeatmap.js
// ============================================================================
// GitHub-style activity grid showing 12 weeks (84 days) of event/task activity.
// Displayed in the Activity tab of the sidebar.
//
// Features:
//   - Color-coded cells (4 intensity levels) based on daily event count
//   - Streak counter (🔥 X) showing consecutive active days
//   - Monthly total events counter
//   - Hover tooltip with date and activity level
//   - Legend (Less ─ More) for intensity reference
//
// Activity data is cached to avoid recalculating on every render.
// Completed tasks count as 0.5 events for a blended activity score.
// ============================================================================

class ProductivityHeatmap extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hoveredDay: null,
    };
    // Cache for activity data to avoid recalculating on every render
    this._cachedEvents = null;
    this._cachedTaskLists = null;
    this._cachedActivityMap = null;
  }

  /**
   * getActivityData — Builds a map of "YYYY-MM-DD" → activity count.
   * Counts events (1 each) and completed tasks (0.5 each).
   * Results are cached and only recalculated when props change.
   */
  getActivityData() {
    const { events, taskLists } = this.props;

    // Return cached result if inputs haven't changed
    if (
      this._cachedEvents === events &&
      this._cachedTaskLists === taskLists &&
      this._cachedActivityMap
    ) {
      return this._cachedActivityMap;
    }

    const activityMap = {}; // "YYYY-MM-DD" -> count

    // Count events per day
    if (events) {
      events.forEach((event) => {
        if (event.isPreview) return;
        const date = new Date(event.start);
        const key = this._dateKey(date);
        activityMap[key] = (activityMap[key] || 0) + 1;
      });
    }

    // Count completed tasks per day (approximation using completedAt or createdAt)
    if (taskLists) {
      taskLists.forEach((list) => {
        if (list.tasks) {
          list.tasks.forEach((task) => {
            if (task.completed) {
              const date = new Date(
                task.completedAt || task.createdAt || new Date()
              );
              const key = this._dateKey(date);
              activityMap[key] = (activityMap[key] || 0) + 0.5;
            }
          });
        }
      });
    }

    // Cache the result
    this._cachedEvents = events;
    this._cachedTaskLists = taskLists;
    this._cachedActivityMap = activityMap;

    return activityMap;
  }

  /**
   * getStreak — Calculates the current consecutive-day activity streak.
   * Counts backwards from today (or yesterday if today has no activity).
   */
  getStreak() {
    const activityMap = this.getActivityData();
    const today = new Date();
    let streak = 0;
    let date = new Date(today);

    // Check if today has activity; if not, start from yesterday
    const todayKey = this._dateKey(today);
    if (!activityMap[todayKey]) {
      date.setDate(date.getDate() - 1);
    }

    while (true) {
      const key = this._dateKey(date);
      if (activityMap[key] && activityMap[key] > 0) {
        streak++;
        date.setDate(date.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  }

  _dateKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  }

  _getIntensity(count) {
    if (!count || count === 0) return 0;
    if (count <= 1) return 1;
    if (count <= 3) return 2;
    if (count <= 5) return 3;
    return 4;
  }

  _getDayLabel(count) {
    if (!count || count === 0) return "No activity";
    if (count <= 1) return "Light";
    if (count <= 3) return "Moderate";
    if (count <= 5) return "Busy";
    return "Very busy";
  }

  render() {
    const h = React.createElement;
    const { hoveredDay } = this.state;
    const activityMap = this.getActivityData();
    const streak = this.getStreak();

    // Build 12 weeks (84 days) of cells
    const today = new Date();
    const weeks = [];
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 83); // 84 days ago
    // Align to Sunday
    startDate.setDate(startDate.getDate() - startDate.getDay());

    let current = new Date(startDate);
    let currentWeek = [];

    while (current <= today || currentWeek.length > 0) {
      const key = this._dateKey(current);
      const count = activityMap[key] || 0;
      const intensity = this._getIntensity(count);
      const isToday = this._dateKey(current) === this._dateKey(today);
      const isFuture = current > today;

      if (!isFuture) {
        currentWeek.push({
          key,
          date: new Date(current),
          count,
          intensity,
          isToday,
        });
      }

      current.setDate(current.getDate() + 1);

      if (currentWeek.length === 7 || current > today) {
        if (currentWeek.length > 0) {
          weeks.push([...currentWeek]);
          currentWeek = [];
        }
        if (current > today) break;
      }
    }

    // Total events this month
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    let monthTotal = 0;
    Object.entries(activityMap).forEach(([key, count]) => {
      const d = new Date(key);
      if (d >= monthStart && d <= today) {
        monthTotal += count;
      }
    });

    return h(
      "div",
      { className: "productivity-heatmap" },
      // Header with streak
      h(
        "div",
        { className: "heatmap-header" },
        h("span", { className: "sidebar-section-title" }, "Activity"),
        streak > 0 &&
          h(
            "div",
            { className: "streak-badge", title: `${streak} day streak!` },
            h("span", { className: "streak-fire" }, "🔥"),
            h("span", { className: "streak-count" }, streak)
          )
      ),

      // Heatmap grid
      h(
        "div",
        { className: "heatmap-grid-wrapper" },
        h(
          "div",
          { className: "heatmap-grid" },
          weeks.map((week, wi) =>
            h(
              "div",
              { key: wi, className: "heatmap-week" },
              week.map((day) =>
                h("div", {
                  key: day.key,
                  className: `heatmap-cell intensity-${day.intensity} ${
                    day.isToday ? "today" : ""
                  }`,
                  title: `${day.date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}: ${this._getDayLabel(day.count)} (${Math.round(
                    day.count
                  )} events)`,
                  onMouseEnter: () => this.setState({ hoveredDay: day }),
                  onMouseLeave: () => this.setState({ hoveredDay: null }),
                })
              )
            )
          )
        ),
        // Legend
        h(
          "div",
          { className: "heatmap-legend" },
          h("span", { className: "heatmap-legend-label" }, "Less"),
          [0, 1, 2, 3, 4].map((i) =>
            h("div", {
              key: i,
              className: `heatmap-cell intensity-${i} legend-cell`,
            })
          ),
          h("span", { className: "heatmap-legend-label" }, "More")
        )
      ),

      // Stats row
      h(
        "div",
        { className: "heatmap-stats" },
        h(
          "div",
          { className: "heatmap-stat" },
          h(
            "span",
            { className: "heatmap-stat-value" },
            Math.round(monthTotal)
          ),
          h("span", { className: "heatmap-stat-label" }, "this month")
        ),
        h(
          "div",
          { className: "heatmap-stat" },
          h("span", { className: "heatmap-stat-value" }, `${streak}d`),
          h("span", { className: "heatmap-stat-label" }, "streak")
        )
      ),

      // Hovered day tooltip
      hoveredDay &&
        h(
          "div",
          { className: "heatmap-tooltip" },
          h(
            "strong",
            null,
            hoveredDay.date.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })
          ),
          ": ",
          this._getDayLabel(hoveredDay.count)
        )
    );
  }
}

window.ProductivityHeatmap = ProductivityHeatmap;
