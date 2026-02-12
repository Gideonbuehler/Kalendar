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
- **Event Creation** - Create events with title, time, location, and description
- **Multiple Calendars** - Support for multiple Nextcloud calendars
- **Real-time Sync** - Sync events with your Nextcloud server
- **Week Numbers** - Optional week number display
- **Customizable First Day** - Start week on Sunday or Monday
- **Time Formats** - Choose between 12-hour and 24-hour formats

### Secure

- **App Password Support** - Use Nextcloud app-specific passwords
- **Local Settings** - All preferences stored locally
- **Secure Authentication** - CalDAV protocol with proper authentication

## Project Structure

```
kalendar/
├── src/
│   ├── components/          # React components
│   │   ├── LoginForm.js     # Login interface
│   │   ├── CalendarView.js  # Main calendar display
│   │   ├── EventModal.js    # Event creation modal
│   │   └── Settings.js      # Settings panel
│   ├── services/            # Business logic
│   │   ├── caldavService.js # CalDAV operations
│   │   └── settingsService.js # Settings management
│   └── styles/
│       └── main.css         # Application styles
├── main.js                  # Electron main process
├── index.html              # Entry point
└── package.json            # Dependencies
```

## Getting Started

#### Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- A Nextcloud account with calendar access

### Installation

1. Navigate to the project directory:

```bash
cd nextcloud-calendar-app
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

Access settings by clicking the gear icon (⚙️) in the top-right corner.

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
- **Show Week Numbers**: Display week numbers in calendar

## License

MIT License - feel free to use this project for personal or commercial purposes.



For better security, create an App Password in Nextcloud:

1. Go to your Nextcloud web interface
2. Click your profile picture → Settings
3. Go to Security section
4. Scroll to "Devices & sessions"
5. Create a new app password named "Desktop Calendar App"
6. Use this password in the app instead of your main password

## Using the App

### Viewing Events

- The calendar displays all events from your Nextcloud calendar
- Use the navigation buttons to switch between months
- Change views using the Month/Week/Day/Agenda buttons

### Creating Events

1. Click and drag on the calendar to select a time slot
2. A modal will appear
3. Fill in the event details:
   - Title (required)
   - Start and end times
   - Description
   - Location
4. Click "Create Event"
5. The event will be synced to your Nextcloud server

### Multiple Calendars

If you have multiple calendars in Nextcloud, use the dropdown in the header to switch between them.

## Building for Production

To build standalone executables for your platform:

```bash
npm run build
```

This will create distributable packages in the `dist` folder.

## Project Structure

```
nextcloud-calendar-app/
├── main.js           # Electron main process (CalDAV connection logic)
├── renderer.js       # React UI components
├── index.html        # HTML entry point
├── styles.css        # Application styles
├── package.json      # Dependencies and scripts
└── README.md         # This file
```

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
- Check that the correct calendar is selected
- Verify events exist in the web interface

### SSL Certificate Issues

If you're using a self-signed certificate, you may need to configure Node to accept it. This is not recommended for production use.

## Future Enhancements

Possible features to add:

- Edit and delete existing events
- Recurring event support
- Event reminders and notifications
- Offline mode with local caching
- Dark mode
- Multiple account support
- Event search and filtering
- Drag-and-drop event rescheduling
- Import/export calendar files

## Security Notes

- Your credentials are only used to connect to your Nextcloud server
- No data is sent to third parties
- Consider using App Passwords instead of your main password
- The app connects directly to your Nextcloud server via CalDAV

## Contributing

Feel free to submit issues and enhancement requests!

## License

MIT License - feel free to use and modify as needed.
