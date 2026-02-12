# Kalendar

A beautiful, highly customizable desktop calendar application for Nextcloud built with Electron and React.

## Features

### Highly Customizable

- **Dark Mode** - Full dark theme support with auto-detection
- **Custom Colors** - Choose your own primary and accent colors
- **Font Sizes** - Small, Medium, and Large text options
- **Compact Mode** - Reduce spacing for a more condensed view
- **Animations** - Toggle smooth transitions and animations

### Calendar Features

- **Multiple Views** - Month, Week, Day, and Agenda views
- **Event Creation & Editing** - Create events with title, time, location, and description
- **Multiple Calendars** - Support for multiple Nextcloud calendars with color-coded display
- **Real-time Sync** - Sync events with your Nextcloud server via CalDAV
- **Drag & Drop** - Reschedule events by dragging, drop tasks onto the calendar
- **Week Numbers** - Optional week number display
- **Customizable First Day** - Start week on Sunday or Monday
- **Time Formats** - Choose between 12-hour and 24-hour formats
- **Time-of-Day Gradients** - Events are color-coded by time of day
- **Next Event Countdown** - Live countdown in the header with hover dropdown for all upcoming events

### Secure

- **App Password Support** - Use Nextcloud app-specific passwords
- **Local Settings** - All preferences stored locally
- **Secure Authentication** - CalDAV protocol with proper authentication

## Project Structure

```
kalendar/
├── src/
│   ├── app.js                    # Main application component & state
│   ├── components/
│   │   ├── CalendarView.js       # Main calendar display & sidebar layout
│   │   ├── CalendarSettingsModal.js # Calendar-specific settings
│   │   ├── ContextMenu.js        # Right-click context menu
│   │   ├── CreateCalendarModal.js # New calendar creation
│   │   ├── DayTimeline.js        # Compact day overview in sidebar
│   │   ├── EventInsights.js      # Calendar usage statistics
│   │   ├── EventModal.js         # Event creation/editing modal
│   │   ├── LoginForm.js          # Login interface
│   │   ├── MiniCalendar.js       # Sidebar mini calendar with tabs
│   │   ├── NextEventCountdown.js # Live countdown with dropdown
│   │   ├── ProductivityHeatmap.js # Activity heatmap
│   │   ├── Settings.js           # Settings panel
│   │   ├── TaskManager.js        # Task list management
│   │   └── TaskModal.js          # Task editing modal
│   ├── services/
│   │   ├── caldavService.js      # CalDAV operations
│   │   ├── settingsService.js    # Settings persistence
│   │   └── webdavService.js      # WebDAV operations
│   ├── styles/
│   │   ├── main.css              # Application styles
│   │   └── theme.css             # Theme variables & component themes
│   └── utils/
│       └── helpers.js            # Utility functions
├── main.js                       # Electron main process
├── renderer.js                   # Renderer process bootstrap
├── index.html                    # Entry point
├── styles.css                    # Root styles
└── package.json                  # Dependencies
```

## Getting Started

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A Nextcloud account with calendar access

### Installation

1. Clone the repository and navigate to the project directory:

```bash
cd Kalendar
```

2. Install dependencies:

```bash
npm install
```

3. Start the application:

```bash
npm start
```

### First Run

1. Enter your Nextcloud server URL (e.g., `https://cloud.example.com`)
2. Enter your username
3. Enter your password or app-specific password (recommended)
4. Click "Connect to Nextcloud"

The app will automatically append the CalDAV path (`/remote.php/dav`) to your server URL.

## Settings

Access settings by clicking the gear icon (⚙️) in the header.

### Appearance Settings

- **Theme**: Light, Dark, or Auto (system default)
- **Primary Color**: Main app color
- **Accent Color**: Highlight and accent color
- **Font Size**: Small, Medium, or Large
- **Animations**: Enable/disable transitions
- **Compact Mode**: Reduce spacing

### Calendar Settings

- **First Day of Week**: Sunday or Monday
- **Time Format**: 12-hour or 24-hour
- **Default View**: Month, Week, Day, or Agenda
- **Default Task Duration**: 5 minutes to 2 hours
- **Show Week Numbers**: Display week numbers in calendar

## License

MIT License - feel free to use this project for personal or commercial purposes.



For better security, create an App Password in Nextcloud:

1. Go to your Nextcloud web interface
2. Click your profile picture → Settings
3. Go to Security section
4. Scroll to "Devices & sessions"
5. Create a new app password named "Kalendar"
6. Use this password in the app instead of your main password

## Using the App

### Viewing Events

- The calendar displays all events from your Nextcloud calendars
- Use the navigation buttons to switch between months/weeks/days
- Change views using the Month/Week/Day/Agenda buttons
- Toggle individual calendars on/off in the sidebar

### Creating Events

1. Click and drag on the calendar to select a time slot
2. Fill in the event details (title, time, location, description)
3. Select which calendar to add it to
4. Click "Create"

### Managing Tasks

1. Click "+" in the Tasks section to create a new task list
2. Expand a list and click "+" to add tasks
3. Check tasks to mark them as complete
4. Drag tasks onto the calendar to schedule them
5. Delete tasks or lists with the ✕ button (with confirmation)

### Building for Production

```bash
npm run build
```

This will create distributable packages in the `dist` folder.

## Technologies Used

- **Electron** - Desktop app framework
- **React** - UI library
- **react-big-calendar** - Calendar component
- **dav** - CalDAV/CardDAV client library
- **ical.js** - iCalendar format parsing
- **moment.js** - Date handling

## Troubleshooting

### Connection Issues

- Verify your Nextcloud URL is correct and includes `https://`
- Check that your username and password are correct
- Ensure your Nextcloud instance is accessible from your network
- Try using an App Password instead of your main password

### Events Not Appearing

- Click the "Refresh" button to manually sync
- Check that the correct calendars are toggled on in the sidebar
- Verify events exist in the Nextcloud web interface

## Security Notes

- Your credentials are only used to connect to your Nextcloud server
- No data is sent to third parties
- Consider using App Passwords instead of your main password
- The app connects directly to your Nextcloud server via CalDAV

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - feel free to use and modify as needed.
