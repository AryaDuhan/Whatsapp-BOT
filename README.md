# 🎓 WhatsApp Attendance Bot

A secure, intelligent, and reliable WhatsApp bot designed to help students effortlessly track class attendance, receive timely reminders, and stay on top of their academic schedule.

## ✨ Core Features

- **🤖 Automated Attendance Tracking**: The bot automatically sends a confirmation message after your class ends. Simply reply "yes", "no", "mass bunk", or "holiday" to log your attendance.
- **🔔 Smart Reminders**: Never miss a class again. Get a WhatsApp reminder 10 minutes before each scheduled class.
- **📸 AI Timetable Parser**: Use the `/image` command to send a screenshot of your timetable, and the bot will use AI to read it and add your classes automatically.
- **📊 Detailed Reports**: Get an instant overview of your attendance for all subjects or dive deep into the statistics for a specific class.
- **⚠️ Low Attendance Alerts**: The bot proactively warns you if your attendance for any subject drops below 75%.
- **💬 Natural Language Commands**: Add your schedule using simple, human-readable commands (e.g., `/add Math on Monday at 10:00 for 2`).
- **✏️ Interactive Editing**: Easily edit any detail of an existing class—including total classes, attended, and mass bunked—with the conversational `/edit` command.
- **🌍 Full Timezone Support**: Configure your local timezone to ensure reminders are always accurate, no matter where you are.

## ⭐ New Features & Recent Changes

A lot has been added to make the bot more powerful and user-friendly!

- **📈 Attendance Summary Command (`/summary`)**: Get a quick, scannable summary of your attendance for all subjects, including how many classes you can miss or need to attend to maintain a 75% average.
- **➗ Breakeven Calculator (`/breakeven`)**: Calculate exactly how many classes you can afford to miss or need to attend for a specific subject to reach a target percentage.
- **📅 Daily Schedule Commands (`/monday`, `/tuesday`, etc.)**: Quickly view your schedule for any day of the week.
- **🖼️ Image Command (`/image`)**: A dedicated command to initiate the AI timetable parsing flow, which now includes a disclaimer about potential inaccuracies.
- **🎉 Holiday Attendance Status**: You can now reply with "holiday" to an attendance confirmation. This will mark the class as a holiday and exclude it from your attendance percentage calculation.
- **Enhanced State Management**: The bot now prevents you from running a new command while another one (like `/edit` or `/image`) is still active, reducing confusion.
- **Refined Message Formatting**: All bot messages have been overhauled to be cleaner, more professional, and easier to read.

## 🐞 Bug Fixes & Improvements

- **Smarter AI Timetable Parser**: The AI prompt has been significantly improved to better handle complex timetables with merged cells, extraneous text, and varied time formats.
- **Image Parsing Crash Fix**: Resolved a critical bug that caused the bot to crash when receiving an image because the `downloadMedia` function was not accessible.
- **State Management Fixes**: Corrected issues where the bot would lose track of a user's state during multi-step commands.
- **Timezone Recognition**: The bot now correctly interprets common shortcuts like "india" during the registration process.
- **Duplicate Subject Prevention**: The AI parser is now smarter and prevents the creation of duplicate subjects for classes that occur on different days.

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [MongoDB](https://www.mongodb.com/try/download/community) (A local instance or a free cloud database from [MongoDB Atlas](https://cloud.mongodb.com/))

### Installation & Setup

1.  **Clone the Repository**

    ```
    git clone [https://github.com/AryaDuhan/whatsapp-attendance-bot.git](https://github.com/AryaDuhan/whatsapp-attendance-bot.git)
    cd whatsapp-attendance-bot
    ```

2.  **Install Dependencies**

    ```
    npm install
    ```

3.  **Configure Environment Variables**

    - Create a `.env` file by copying the example: `cp env.example .env`
    - Open the `.env` file and fill in the required values:
      - `MONGODB_URI`: Your MongoDB connection string.
      - `GEMINI_API_KEY` (Optional): Your Google Gemini API key to enable the AI Timetable Parser.

4.  **Run the Bot**

    ```
    npm start
    ```

5.  **Link Your WhatsApp**
    - A QR code will appear in your terminal.
    - Open WhatsApp on your phone, go to **Settings > Linked Devices > Link a Device**, and scan the code.
    - Once connected, you're ready to go!

## 🤖 Bot Commands

Here are the main commands to interact with the bot:

| Command         | Description                                        | Example                                  |
| --------------- | -------------------------------------------------- | ---------------------------------------- |
| `/start`        | Begins the one-time registration process.          | `/start`                                 |
| `/help`         | Shows the help message with all commands.          | `/help`                                  |
| `/add`          | Adds a new subject to your schedule.               | `/add Physics on Tuesday at 3pm for 1.5` |
| `/edit`         | Interactively edit a subject's details.            | `/edit Physics`                          |
| `/remove`       | Removes a subject from your schedule.              | `/remove Physics`                        |
| `/clearlist`    | Removes all subjects from your schedule.           | `/clearlist`                             |
| `/list`         | Shows all the subjects you are currently tracking. | `/list`                                  |
| `/monday`, etc. | Shows your schedule for a specific day.            | `/monday`                                |
| `/image`        | Starts the AI timetable parsing process.           | `/image`                                 |
| `/show`         | Displays your attendance report.                   | `/show attendance` or `/show Physics`    |
| `/summary`      | Gets a quick, scannable attendance summary.        | `/summary`                               |
| `/breakeven`    | Calculates classes to miss/attend for a target %.  | `/breakeven Physics at 80%`              |
| `/timezone`     | Sets your local timezone for accurate reminders.   | `/timezone America/New_York`             |
| `/settings`     | View or change your bot preferences.               | `/settings`                              |
| `/deleteuser`   | Permanently deletes your account and data.         | `/deleteuser`                            |

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or improvements, feel free to fork the repository, make your changes, and submit a pull request.

## 📝 License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
