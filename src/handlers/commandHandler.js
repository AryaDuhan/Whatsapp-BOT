const User = require("../models/User");
const Subject = require("../models/Subject");
const AttendanceRecord = require("../models/AttendanceRecord");
const Helpers = require("../utils/helpers");
const { MESSAGE_TEMPLATES, VALIDATION } = require("../utils/constants");
const compromise = require("compromise");
const moment = require("moment-timezone");

class CommandHandler {
  // accept client in the constructor
  constructor(client, schedulerService) {
    // store the client
    this.client = client;

    // store the scheduler service
    this.schedulerService = schedulerService;

    this.commands = {
      "/start": this.handleStart.bind(this),
      "/help": this.handleHelp.bind(this),
      "/add": this.handleAdd.bind(this),
      "/remove": this.handleRemove.bind(this),
      "/show": this.handleShow.bind(this),
      "/list": this.handleList.bind(this),
      "/timezone": this.handleTimezone.bind(this),
      "/settings": this.handleSettings.bind(this),
      "/deleteuser": this.handleDeleteUser.bind(this),
      "/testconfirm": this.handleTestConfirm.bind(this),
    };
  }

  // remove client
  async handleCommand(message) {
    const userId = message.from.replace("@c.us", "");
    const messageBody = message.body.trim();
    const [command, ...args] = messageBody.split(" ");

    let user = await User.findByWhatsAppId(userId);

    if (!user || !user.isFullyRegistered()) {
      if (command.toLowerCase() !== "/start") {
        // use client.sendMessage
        await this.client.sendMessage(
          message.from,
          "👋 Welcome! You need to register first to use this bot.\n\n" +
            "Please type */start* to begin registration."
        );
        return;
      }
    }

    const handler = this.commands[command.toLowerCase()];
    if (handler) {
      await handler(message, args, user);
    } else {
      await this.handleUnknownCommand(message);
    }
  }

  async handleStart(message, args, user) {
    const userId = message.from.replace("@c.us", "");

    if (user && user.isFullyRegistered()) {
      await this.client.sendMessage(
        message.from,
        `👋 Hello ${user.getDisplayName()}!\n\n` +
          "You are already registered. Type */help* to see available commands."
      );
      return;
    }

    if (!user) {
      user = User.createNewUser(userId);
      await user.save();
    }

    await this.client.sendMessage(
      message.from,
      "🎓 *Welcome to AttendanceBot!*\n\n" +
        "I'll help you track your class attendance. Let's get you set up!\n\n" +
        "First, what's your name?"
    );
  }

  async handleHelp(message) {
    const helpText = `
🤖 *AttendanceBot Help*

📚 *Subject Management:*
• */add <subject> on <day> at <time> for <hours>*
  Example: /add Mathematics on Monday at 10:00 for 2

• */remove <subject>* - Remove a subject
• */list* - Show all your subjects

📸 *AI Timetable Parser:*
• Send a screenshot of your timetable
• I'll show you all classes found and ask for confirmation
• Reply "yes" to add all classes, "no" to cancel
• Works with clear, readable timetable images

📊 *Attendance:*
• */show attendance* - View all attendance
• */show <subject>* - View specific subject attendance

⚙️ *Settings:*
• */timezone <timezone>* - Set your timezone
• */settings* - View/change preferences
• */deleteuser* - Delete your account and all data

💡 *Tips:*
- I'll remind you 10 minutes before each class
- Reply "yes" or "no" to attendance confirmations
- If you don't reply within 2 hours, you'll be marked absent
- I'll alert you if attendance drops below 75%
- Send a timetable image for automatic setup!
        `.trim();

    await this.client.sendMessage(message.from, helpText);
  }

  async handleAdd(message, args, user) {
    const fullCommand = args.join(" ");

    if (!fullCommand) {
      await this.client.sendMessage(
        message.from,
        "📝 *Add a Subject*\n\n" +
          "Format: */add <subject> on <day> at <time> for <hours>*\n\n" +
          "Examples:\n" +
          "• /add Mathematics on Monday at 10:00 for 2\n" +
          "• /add Physics on Wed at 2pm for 1.5\n" +
          "• /add Computer Science on Friday at 09:30 for 3"
      );
      return;
    }

    try {
      const parsed = this.parseAddCommand(fullCommand);

      if (!parsed) {
        await this.client.sendMessage(
          message.from,
          "❌ I couldn't understand that format.\n\n" +
            "Please use: */add <subject> on <day> at <time> for <hours>*\n\n" +
            "Example: /add Mathematics on Monday at 10:00 for 2"
        );
        return;
      }

      const { subjectName, day, time, duration } = parsed;

      const existingSubject = await Subject.findByUserAndName(
        user._id,
        subjectName
      );
      if (existingSubject) {
        await this.client.sendMessage(
          message.from,
          `❌ You already have a subject called "${subjectName}".`
        );
        return;
      }

      const subject = new Subject({
        userId: user._id,
        subjectName,
        schedule: { day, time, duration },
      });

      await subject.save();

      await this.client.sendMessage(
        message.from,
        `✅ *Subject Added Successfully!*\n\n` +
          `📚 Subject: ${subjectName}\n` +
          `📅 Day: ${day}\n` +
          `⏰ Time: ${time}\n` +
          `⌛ Duration: ${duration} hour(s)\n\n` +
          `I'll remind you 10 minutes before each class! 🔔`
      );
    } catch (error) {
      console.error("Error adding subject:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error adding the subject. Please try again."
      );
    }
  }

  async handleRemove(message, args, user) {
    const subjectName = args.join(" ").trim();

    if (!subjectName) {
      await this.client.sendMessage(
        message.from,
        " *Remove a Subject*\n\n" +
          "Format: */remove <subject name>*\n\n" +
          "Example: /remove Mathematics"
      );
      return;
    }

    try {
      const subject = await Subject.findByUserAndName(user._id, subjectName);

      if (!subject) {
        await this.client.sendMessage(
          message.from,
          `❌ Subject "${subjectName}" not found.`
        );
        return;
      }

      subject.isActive = false;
      await subject.save();

      await this.client.sendMessage(
        message.from,
        `✅ *Subject Removed*\n\n` +
          `📚 "${subject.subjectName}" has been removed from your schedule.\n\n` +
          `Your attendance history has been preserved.`
      );
    } catch (error) {
      console.error("Error removing subject:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error removing the subject. Please try again."
      );
    }
  }

  async handleShow(message, args, user) {
    const parameter = args.join(" ").trim().toLowerCase();

    try {
      if (parameter === "attendance" || parameter === "") {
        await this.showAllAttendance(message, user);
      } else {
        await this.showSubjectAttendance(message, user, parameter);
      }
    } catch (error) {
      console.error("Error showing attendance:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error retrieving attendance data."
      );
    }
  }

  async showAllAttendance(message, user) {
    const subjects = await Subject.findActiveByUser(user._id);

    if (subjects.length === 0) {
      await this.client.sendMessage(
        message.from,
        "📚 *No Subjects Found*\n\n" +
          "You haven't added any subjects yet.\n" +
          "Use */add* to add your first subject!"
      );
      return;
    }

    let response = "📊 *Your Attendance Overview*\n\n";

    for (const subject of subjects) {
      const percentage = subject.attendancePercentage;
      const status = Helpers.getAttendanceEmoji(percentage);

      response += `${status} *${subject.subjectName}*\n`;
      response += `   ${subject.attendedClasses}/${subject.totalClasses} classes (${percentage}%)\n\n`;
    }

    response += "_💡 Type /show <subject name> for detailed view_";

    await this.client.sendMessage(message.from, response);
  }

  async showSubjectAttendance(message, user, subjectName) {
    const subject = await Subject.findByUserAndName(user._id, subjectName);

    if (!subject) {
      await this.client.sendMessage(
        message.from,
        `❌ Subject "${subjectName}" not found.`
      );
      return;
    }

    const percentage = subject.attendancePercentage;
    const status = Helpers.getAttendanceEmoji(percentage);
    const nextClass = subject.getNextClassTime(user.timezone);

    let response = `📊 *${subject.subjectName} - Detailed View*\n\n`;
    response += `${status} *Attendance: ${percentage}%*\n`;
    response += `✅ Present: ${subject.attendedClasses} classes\n`;
    response += `❌ Total: ${subject.totalClasses} classes\n\n`;

    response += `📅 *Schedule:* ${subject.schedule.day}s at ${subject.schedule.time}\n`;
    response += `⏱️ *Duration:* ${subject.schedule.duration} hour(s)\n\n`;

    response += `🗓️ *Next Class:* ${nextClass.format(
      "dddd, MMM Do [at] h:mm A"
    )}\n\n`;

    if (percentage < 75) {
      const classesNeeded = Helpers.calculateClassesNeeded(
        subject.attendedClasses,
        subject.totalClasses,
        75
      );
      response += `⚠️ *Low Attendance Alert!*\n`;
      response += `You need to attend ${classesNeeded} more classes to reach 75%`;
    }

    await this.client.sendMessage(message.from, response);
  }

  async handleList(message, args, user) {
    const subjects = await Subject.findActiveByUser(user._id);

    if (subjects.length === 0) {
      await this.client.sendMessage(
        message.from,
        "📚 *No Subjects Found*\n\n" +
          "You haven't added any subjects yet.\n" +
          "Use */add* to add your first subject!"
      );
      return;
    }

    let response = "📚 *Your Subjects*\n\n";

    subjects.forEach((subject, index) => {
      response += `${index + 1}. *${subject.subjectName}*\n`;
      response += `   📅 ${subject.schedule.day}s at ${subject.schedule.time}\n`;
      response += `   ⏱️ ${subject.schedule.duration} hour(s)\n\n`;
    });

    await this.client.sendMessage(message.from, response);
  }

  async handleTimezone(message, args, user) {
    const timezone = args.join(" ").trim();

    if (!timezone) {
      await this.client.sendMessage(
        message.from,
        `🌍 *Current Timezone*\n\n` +
          `Your timezone: ${user.timezone}\n\n` +
          `To change it, use: */timezone <timezone>*\n` +
          `Example: /timezone America/New_York`
      );
      return;
    }

    try {
      moment.tz.zone(timezone);

      user.timezone = timezone;
      await user.save();

      await this.client.sendMessage(
        message.from,
        `✅ *Timezone Updated*\n\n` +
          `Your timezone has been set to: ${timezone}\n` +
          `Current time: ${moment().tz(timezone).format("LLLL")}`
      );
    } catch (error) {
      await this.client.sendMessage(
        message.from,
        `❌ Invalid timezone "${timezone}"\n\n` +
          `Please use a valid timezone like:\n` +
          `• Asia/Kolkata\n` +
          `• America/New_York\n` +
          `• Europe/London`
      );
    }
  }

  async handleSettings(message, args, user) {
    const response =
      `⚙️ *Your Settings*\n\n` +
      `👤 Name: ${user.name}\n` +
      `🌍 Timezone: ${user.timezone}\n` +
      `🔔 Reminders: ${
        user.preferences.reminderEnabled ? "Enabled" : "Disabled"
      }\n` +
      `⚠️ Low Attendance Alerts: ${
        user.preferences.lowAttendanceAlerts ? "Enabled" : "Disabled"
      }\n\n` +
      `_To change timezone: /timezone <timezone>_`;

    await this.client.sendMessage(message.from, response);
  }

  async handleUnknownCommand(message) {
    await this.client.sendMessage(
      message.from,
      "❓ Unknown command.\n\n" + "Type */help* to see all available commands."
    );
  }

  async handleDeleteUser(message, args, user) {
    const confirmationPhrase = "confirmed"; // Changed from "delete my account"
    const userInput = args.join(" ").trim();

    if (userInput.toLowerCase() !== confirmationPhrase) {
      await this.client.sendMessage(
        message.from,
        "*⚠️ This is an irreversible action!* All of your data will be permanently deleted.\n\n" +
          "To confirm, please type the following phrase exactly as shown:\n" +
          `*/deleteuser ${confirmationPhrase}*` // Updated the example text
      );
      return;
    }

    try {
      const userId = user._id;
      const userName = user.name;

      const deleted = await User.deleteUserAndData(userId);

      if (deleted) {
        await this.client.sendMessage(
          message.from,
          `✅ *Account Deleted Successfully.*\n\n` +
            `All data associated with ${userName} has been permanently removed. We're sorry to see you go!`
        );
      } else {
        await this.client.sendMessage(
          message.from,
          "❌ Could not find a user account to delete."
        );
      }
    } catch (error) {
      console.error("Error deleting user:", error);
      await this.client.sendMessage(
        message.from,
        "❌ An error occurred while trying to delete your account. Please contact support."
      );
    }
  }

  async handleTestConfirm(message, args, user) {
    // only run this command in the development environment
    if (process.env.NODE_ENV !== "development") {
      // in production, treat it as an unknown command
      await this.handleUnknownCommand(message);
      return;
    }

    const subjectName = args.join(" ").trim();

    if (!subjectName) {
      await this.client.sendMessage(
        message.from,
        "Please specify a subject to test.\n\n*Example:* `/testconfirm Maths`"
      );
      return;
    }

    try {
      const subject = await Subject.findByUserAndName(user._id, subjectName);

      if (!subject) {
        await this.client.sendMessage(
          message.from,
          `❌ Subject "${subjectName}" not found.`
        );
        return;
      }

      // manually trigger the confirmation message for the specified subject
      await this.client.sendMessage(
        message.from,
        `✅ Forcing attendance confirmation for *${subject.subjectName}*...`
      );

      // use the current time to end class
      const now = moment().tz(user.timezone);
      await this.schedulerService.sendAttendanceConfirmation(
        user,
        subject,
        now
      );
    } catch (error) {
      console.error("Error during test confirmation:", error);
      await this.client.sendMessage(
        message.from,
        "❌ An error occurred while running the test."
      );
    }
  }

  parseAddCommand(input) {
    try {
      const normalizedInput = input.toLowerCase().trim();

      const patterns = [
        /^(.+?)\s+on\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}:?\d{0,2}(?:am|pm)?)\s+for\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)?$/i,
        /^(.+?)\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2}:?\d{0,2}(?:am|pm)?)\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)?$/i,
      ];

      for (const pattern of patterns) {
        const match = normalizedInput.match(pattern);
        if (match) {
          const [, subjectName, day, time, duration] = match;

          return {
            subjectName: Helpers.capitalizeWords(subjectName.trim()),
            day: Helpers.normalizeDayName(day),
            time: Helpers.normalizeTime(time),
            duration: parseFloat(duration),
          };
        }
      }

      return null;
    } catch (error) {
      console.error("Error parsing add command:", error);
      return null;
    }
  }
}

module.exports = CommandHandler;
