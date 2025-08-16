const User = require("../models/User");
const Subject = require("../models/Subject");
const AttendanceRecord = require("../models/AttendanceRecord");
const Helpers = require("../utils/helpers");
const { MESSAGE_TEMPLATES, VALIDATION } = require("../utils/constants");
const compromise = require("compromise");
const moment = require("moment-timezone");

class CommandHandler {
  constructor(client, schedulerService) {
    this.client = client;
    this.schedulerService = schedulerService;
    this.messageHandler = null; // This will be set by the main bot class
    this.editingSessions = new Map();

    this.commands = {
      "/start": this.handleStart.bind(this),
      "/help": this.handleHelp.bind(this),
      "/add": this.handleAdd.bind(this),
      "/edit": this.handleEdit.bind(this),
      "/remove": this.handleRemove.bind(this),
      "/show": this.handleShow.bind(this),
      "/list": this.handleList.bind(this),
      "/timezone": this.handleTimezone.bind(this),
      "/settings": this.handleSettings.bind(this),
      "/deleteuser": this.handleDeleteUser.bind(this),
    };
  }

  // Setter for messageHandler to resolve circular dependency
  setMessageHandler(messageHandler) {
    this.messageHandler = messageHandler;
  }

  async handleCommand(message) {
    const userId = message.from.replace("@c.us", "");
    const messageBody = message.body.trim();
    const [command, ...args] = messageBody.split(" ");

    let user = await User.findByWhatsAppId(userId);

    // Prioritize handling an ongoing edit session
    if (this.editingSessions.has(userId)) {
      await this.handleEditConversation(message, user);
      return;
    }

    const isRegistering = user && !user.isFullyRegistered();

    if (!user || !user.isFullyRegistered()) {
      if (command.toLowerCase() !== "/start") {
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

    if (isRegistering && command.toLowerCase() !== "/start") {
      await new Promise((resolve) => setTimeout(resolve, 500));

      switch (user.registrationStep) {
        case "name":
          await this.client.sendMessage(
            message.from,
            "To complete your registration, I still need your name."
          );
          break;
        case "timezone":
          await this.client.sendMessage(
            message.from,
            "By the way, I'm still waiting for your timezone to finish setting you up."
          );
          break;
      }
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

  async handleHelp(message, args, user) {
    const helpText = `
🤖 *AttendanceBot Help*

📚 *Subject Management:*
• */add <subject> on <day> at <time> for <hours>*
  Example: /add Mathematics on Monday at 10:00 for 2
• */edit <subject>* - Edit a subject's details
• */remove <subject>* - Remove a subject
• */list* - Show all your subjects

📸 *AI Timetable Parser:*
• Send a screenshot of your timetable
• I'll show you all classes found and ask for confirmation
• Reply "confirm" to add all classes, "cancel" to cancel
• Works with clear, readable timetable images

📊 *Attendance:*
• */show attendance* - View all attendance (includes mass bunks)
• */show attendancewithbunks* - View all attendance (excludes mass bunks)
• */show <subject>* - View specific subject attendance

⚙️ *Settings:*
• */timezone <timezone>* - Set your timezone
• */settings* - View/change preferences
• */deleteuser* - Delete your account and all data

💡 *Tips:*
- I'll remind you 10 minutes before each class
- Reply "yes" or "no" or "mass bunk" to attendance confirmations
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

  async handleEdit(message, args, user) {
    const subjectName = args.join(" ").trim();

    if (!subjectName) {
      await this.client.sendMessage(
        message.from,
        "📝 *Edit a Subject*\n\n" +
          "Format: */edit <subject name>*\n\n" +
          "Example: /edit Mathematics"
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

      const userId = message.from.replace("@c.us", "");
      this.editingSessions.set(userId, { subject, stage: "menu" });

      await this.client.sendMessage(
        message.from,
        `Editing *${subject.subjectName}*. What would you like to change?
1. Class Name
2. Class Timing (e.g., 8:00 to 9:00)
3. Class Day
4. Total Classes
5. Attended Classes
6. Mass Bunked Classes
Reply with the number of the option you want to edit or 'cancel' to exit.`
      );
    } catch (error) {
      console.error("Error editing subject:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error editing the subject. Please try again."
      );
    }
  }

  async handleEditConversation(message, user) {
    const userId = message.from.replace("@c.us", "");
    const session = this.editingSessions.get(userId);
    if (!session) return;

    const { subject, stage } = session;
    const response = message.body.trim();

    if (response.toLowerCase() === "cancel") {
      this.editingSessions.delete(userId);
      await this.client.sendMessage(message.from, "Editing cancelled.");
      return;
    }

    const stages = {
      menu: async () => {
        const choice = parseInt(response);
        if (isNaN(choice) || choice < 1 || choice > 6) {
          await this.client.sendMessage(
            message.from,
            "Invalid choice. Please reply with a number from 1 to 6 or 'cancel'."
          );
          return;
        }
        session.stage = choice;
        const prompts = [
          "What is the new name for the class?",
          "What is the new timing for the class? (e.g., 8:00 to 9:00)",
          "What is the new day for the class? (e.g., Monday)",
          "What is the new total number of classes?",
          "What is the new number of attended classes?",
          "What is the new number of mass bunked classes?",
        ];
        await this.client.sendMessage(message.from, prompts[choice - 1]);
      },
      1: async () => {
        // Class Name
        subject.subjectName = response;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Subject name updated to *${response}*`
        );
        this.returnToEditMenu(message, subject);
      },
      2: async () => {
        // Class Timing
        const [startTime, endTime] = response.split("to").map((t) => t.trim());
        const normalizedStartTime = Helpers.normalizeTime(startTime);
        const normalizedEndTime = Helpers.normalizeTime(endTime);

        if (!normalizedStartTime || !normalizedEndTime) {
          await this.client.sendMessage(
            message.from,
            "Invalid time format. Please use 'HH:MM to HH:MM'."
          );
          return;
        }

        const duration = moment
          .duration(
            moment(normalizedEndTime, "HH:mm").diff(
              moment(normalizedStartTime, "HH:mm")
            )
          )
          .asHours();
        if (duration <= 0) {
          await this.client.sendMessage(
            message.from,
            "End time must be after start time."
          );
          return;
        }

        subject.schedule.time = normalizedStartTime;
        subject.schedule.duration = duration;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Subject timing updated to *${normalizedStartTime}* for *${duration}* hours.`
        );
        this.returnToEditMenu(message, subject);
      },
      3: async () => {
        // Class Day
        const normalizedDay = Helpers.normalizeDayName(response);
        if (!Helpers.isValidDay(normalizedDay)) {
          await this.client.sendMessage(
            message.from,
            "Invalid day. Please enter a full day name (e.g., Monday)."
          );
          return;
        }
        subject.schedule.day = normalizedDay;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Class day updated to *${normalizedDay}*`
        );
        this.returnToEditMenu(message, subject);
      },
      4: async () => {
        // Total Classes
        const totalClasses = parseInt(response);
        if (isNaN(totalClasses) || totalClasses < 0) {
          await this.client.sendMessage(
            message.from,
            "Invalid number. Please enter a positive number for total classes."
          );
          return;
        }
        subject.totalClasses = totalClasses;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Total classes updated to *${totalClasses}*`
        );
        this.returnToEditMenu(message, subject);
      },
      5: async () => {
        // Attended Classes
        const attendedClasses = parseInt(response);
        if (
          isNaN(attendedClasses) ||
          attendedClasses < 0 ||
          attendedClasses > subject.totalClasses
        ) {
          await this.client.sendMessage(
            message.from,
            "Invalid number. Attended classes cannot be negative or greater than total classes."
          );
          return;
        }
        subject.attendedClasses = attendedClasses;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Attended classes updated to *${attendedClasses}*`
        );
        this.returnToEditMenu(message, subject);
      },
      6: async () => {
        // Mass Bunked Classes
        const massBunkedClasses = parseInt(response);
        if (
          isNaN(massBunkedClasses) ||
          massBunkedClasses < 0 ||
          massBunkedClasses > subject.totalClasses
        ) {
          await this.client.sendMessage(
            message.from,
            "Invalid number. Mass bunked classes cannot be negative or greater than total classes."
          );
          return;
        }
        subject.massBunkedClasses = massBunkedClasses;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Mass bunked classes updated to *${massBunkedClasses}*`
        );
        this.returnToEditMenu(message, subject);
      },
    };

    if (stages[stage]) {
      await stages[stage]();
    }
  }

  async returnToEditMenu(message, subject) {
    const userId = message.from.replace("@c.us", "");
    this.editingSessions.set(userId, { subject, stage: "menu" });
    await this.client.sendMessage(
      message.from,
      `Anything else you would like to change for *${subject.subjectName}*?
1. Class Name
2. Class Timing
3. Class Day
4. Total Classes
5. Attended Classes
6. Mass Bunked Classes
Reply with a number or 'cancel' to exit.`
    );
  }

  async handleRemove(message, args, user) {
    const userId = user._id;

    if (this.messageHandler.pendingRemoveConfirmations.has(userId)) {
      const pending =
        this.messageHandler.pendingRemoveConfirmations.get(userId);
      await this.client.sendMessage(
        message.from,
        `You already have a pending removal for "*${pending.subjectName}*".\n\n` +
          `Please reply with "yes" or "no" to resolve it before removing another subject.`
      );
      return;
    }

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

      this.messageHandler.pendingRemoveConfirmations.set(userId, {
        subjectId: subject._id,
        subjectName: subject.subjectName,
        timestamp: Date.now(),
      });

      await this.client.sendMessage(
        message.from,
        `⚠️ Are you sure you want to remove the subject "*${subject.subjectName}*"?\n\n` +
          `This action cannot be undone.\n\n` +
          `Reply with *"yes"* to confirm or *"no"* to cancel.`
      );
    } catch (error) {
      console.error("Error initiating subject removal:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error trying to remove the subject. Please try again."
      );
    }
  }

  async handleShow(message, args, user) {
    const parameter = args.join(" ").trim().toLowerCase();

    try {
      if (parameter === "attendance" || parameter === "") {
        await this.showAllAttendance(message, user, true);
      } else if (parameter === "attendancewithbunks") {
        await this.showAllAttendance(message, user, false);
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

  async showAllAttendance(message, user, withBunks) {
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
      const percentage = withBunks
        ? subject.attendancePercentage
        : subject.attendancePercentageWithBunks;
      const status = Helpers.getAttendanceEmoji(percentage);

      response += `${status} *${subject.subjectName}*\n`;
      if (withBunks) {
        response += `   ${subject.attendedClasses}/${subject.totalClasses} classes (${percentage}%)\n`;
        response += `   Mass Bunked: ${subject.massBunkedClasses} classes\n\n`;
      } else {
        const totalClassesWithoutBunks =
          subject.totalClasses - subject.massBunkedClasses;
        response += `   ${subject.attendedClasses}/${
          totalClassesWithoutBunks > 0 ? totalClassesWithoutBunks : 0
        } classes (${percentage}%)\n\n`;
      }
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
    const percentageWithBunks = subject.attendancePercentageWithBunks;
    const status = Helpers.getAttendanceEmoji(percentage);
    const nextClass = subject.getNextClassTime(user.timezone);

    let response = `📊 *${subject.subjectName} - Detailed View*\n\n`;
    response += `${status} *Attendance: ${percentage}%* (including mass bunks)\n`;
    response += `*Attendance: ${percentageWithBunks}%* (excluding mass bunks)\n`;
    response += `✅ Present: ${subject.attendedClasses} classes\n`;
    response += `❌ Total: ${subject.totalClasses} classes\n`;
    response += `🤪 Mass Bunked: ${subject.massBunkedClasses} classes\n\n`;

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
    const confirmationPhrase = "confirmed";
    const userInput = args.join(" ").trim();

    if (userInput.toLowerCase() !== confirmationPhrase) {
      await this.client.sendMessage(
        message.from,
        "*⚠️ This is an irreversible action!* All of your data will be permanently deleted.\n\n" +
          "To confirm, please type the following phrase exactly as shown:\n" +
          `*/deleteuser ${confirmationPhrase}*`
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

  parseAddCommand(input) {
    try {
      const normalizedInput = input.toLowerCase().trim();

      const patterns = [
        /^(.+?)\s+on\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+at\s+(\d{1,2}:?\d{0,2}(?:am|pm)?)\s+for\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)?$/i,
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
