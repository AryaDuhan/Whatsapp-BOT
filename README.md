# 🎓 WhatsApp Attendance Bot

A secure, intelligent, and reliable WhatsApp bot designed to help students effortlessly track class attendance, receive timely reminders, and stay on top of their academic schedule.

## ✨ Core Features

- **🤖 Automated Attendance Tracking**: The bot automatically sends a confirmation message after your class ends. Simply reply "yes" or "no" to log your attendance.
- **🔔 Smart Reminders**: Never miss a class again. Get a WhatsApp reminder 10 minutes before each scheduled class.
- **📸 AI Timetable Parser**: Simply send a screenshot of your timetable, and the bot will use AI to read it, extract all your classes, and add them to your schedule automatically.
- **📊 Detailed Reports**: Get an instant overview of your attendance for all subjects or dive deep into the statistics for a specific class.
- **⚠️ Low Attendance Alerts**: The bot proactively warns you if your attendance for any subject drops below 75%.
- **💬 Natural Language Commands**: Add your schedule using simple, human-readable commands (e.g., `/add Math on Monday at 10:00 for 2`).
- **🌍 Full Timezone Support**: Configure your local timezone to ensure reminders are always accurate, no matter where you are.

## 🛡️ Enterprise-Grade Security

This bot was built with a security-first approach, implementing multiple layers of protection to ensure your data is safe and the service is reliable.

- **Input Validation & Sanitization**: Protects against all common injection attacks (XSS, NoSQL, Command Injection) by validating and sanitizing all user input.
- **Rate Limiting & Abuse Prevention**: A sliding-window rate limiter prevents spam and brute-force attacks by limiting the number of messages and commands a user can send.
- **User Blocking System**: Automatically blocks users who exhibit malicious behavior, with an escalating block duration for repeat offenders.
- **End-to-End Encryption**: Utilizes AES-256-GCM encryption for sensitive data stored in the database.
- **Secure Session Management**: Ensures that user sessions are secure and protected against hijacking.
- **Comprehensive Error Handling**: A robust error handler with a circuit-breaker pattern prevents crashes and ensures the bot remains stable.
- **Performance Monitoring**: Actively monitors system resources to prevent resource exhaustion and ensure smooth operation.
- **Detailed Audit Logging**: Securely logs all critical security events for monitoring and threat analysis.

## 🐞 Bug Fixes

A log of issues that have been resolved to improve bot stability and user experience.

- **Media Message Crash:** Fixed a crash that occurred when a user sent a media file (like an image).
- **Command Crash:** Resolved an error that caused the bot to crash whenever any command was used.
- **Non-Command Message Crash:** Corrected a bug that made the bot crash when receiving any regular text message.
- **Incorrect Name Registration:** Stopped the bot from incorrectly saving a new user's first message as their name.
- **Faulty Attendance Keyword Matching:** Prevented the bot from misinterpreting casual words (like "yo") as an attendance confirmation.
- **Invalid Command Flag:** Fixed a bug where the `/drop` command was incorrectly flagged as a malicious pattern. Renamed the command to `/remove` to prevent security conflicts.

## 🐞 Bug Fixes

A log of issues that have been resolved to improve bot stability and user experience.

* **Media Message Crash:** Fixed a crash that occurred when a user sent a media file (like an image).
* **Command Crash:** Resolved an error that caused the bot to crash whenever any command was used.
* **Non-Command Message Crash:** Corrected a bug that made the bot crash when receiving any regular text message.
* **Incorrect Name Registration:** Stopped the bot from incorrectly saving a new user's first message as their name.
* **Faulty Attendance Keyword Matching:** Prevented the bot from misinterpreting casual words (like "yo") as an attendance confirmation.


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
      - `ENCRYPTION_KEY`: A random, 32-character secret key for data encryption.
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

| Command     | Description                                        | Example                                  |
| ----------- | -------------------------------------------------- | ---------------------------------------- |
| `/start`    | Begins the one-time registration process.          | `/start`                                 |
| `/add`      | Adds a new subject to your schedule.               | `/add Physics on Tuesday at 3pm for 1.5` |
| `/remove`   | Removes a subject from your schedule.              | `/remove Physics`                        |
| `/list`     | Shows all the subjects you are currently tracking. | `/list`                                  |
| `/show`     | Displays your attendance report.                   | `/show attendance` or `/show Physics`    |
| `/timezone` | Sets your local timezone for accurate reminders.   | `/timezone America/New_York`             |
| `/help`     | Shows the help message with all commands.          | `/help`                                  |

## ☁️ Deployment

To run the bot 24/7, you can deploy it to a cloud service. This project includes a `Dockerfile` for easy deployment on platforms that support containers.

- **Recommended Free Platforms:** [Railway](https://railway.app/).

## 🤝 Contributing

Contributions are welcome! If you have ideas for new features or improvements, feel free to fork the repository, make your changes, and submit a pull request.

## 📝 License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
