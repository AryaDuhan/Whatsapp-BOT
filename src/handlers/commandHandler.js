const User = require("../models/User");
const Subject = require("../models/Subject");
const AttendanceRecord = require("../models/AttendanceRecord");
const Helpers = require("../utils/helpers");
const {
  MESSAGE_TEMPLATES,
  VALIDATION,
  ATTENDANCE_THRESHOLDS,
} = require("../utils/constants");
const compromise = require("compromise");
const moment = require("moment-timezone");

class CommandHandler {
  constructor(client, schedulerService) {
    this.client = client;
    this.schedulerService = schedulerService;
    this.messageHandler = null; // This will be set by the main bot class
    this.editingSessions = new Map();
    this.activeCommand = new Map();

    this.commands = {
      "/start": this.handleStart.bind(this),
      "/help": this.handleHelp.bind(this),
      "/add": this.handleAdd.bind(this),
      "/edit": this.handleEdit.bind(this),
      "/remove": this.handleRemove.bind(this),
      "/clearlist": this.handleClearList.bind(this),
      "/show": this.handleShow.bind(this),
      "/list": this.handleList.bind(this),
      "/image": this.handleImage.bind(this),
      "/breakeven": this.handleBreakeven.bind(this),
      "/summary": this.handleSummary.bind(this),
      "/timezone": this.handleTimezone.bind(this),
      "/settings": this.handleSettings.bind(this),
      "/deleteuser": this.handleDeleteUser.bind(this),
      "/monday": (message, args, user) =>
        this.handleDayCommand(message, user, "Monday"),
      "/tuesday": (message, args, user) =>
        this.handleDayCommand(message, user, "Tuesday"),
      "/wednesday": (message, args, user) =>
        this.handleDayCommand(message, user, "Wednesday"),
      "/thursday": (message, args, user) =>
        this.handleDayCommand(message, user, "Thursday"),
      "/friday": (message, args, user) =>
        this.handleDayCommand(message, user, "Friday"),
      "/saturday": (message, args, user) =>
        this.handleDayCommand(message, user, "Saturday"),
      "/sunday": (message, args, user) =>
        this.handleDayCommand(message, user, "Sunday"),
    };

    // Add dev commands only in development mode
    if (
      process.env.NODE_ENV === "development" ||
      process.env.DEV_MODE === "true"
    ) {
      this.commands["/testconfirm"] = this.handleTestConfirm.bind(this);
      this.commands["/testremind"] = this.handleTestRemind.bind(this);
      this.commands["/testalert"] = this.handleTestAlert.bind(this);
      this.commands["/clearconfirm"] = this.handleClearConfirm.bind(this);
      this.commands["/debugattendance"] = this.handleDebugAttendance.bind(this);
    }
  }

  // Setter for messageHandler to resolve circular dependency
  setMessageHandler(messageHandler) {
    this.messageHandler = messageHandler;
  }

  async handleCommand(message) {
    const userId = message.from.replace("@c.us", "");
    const messageBody = message.body.trim();
    const [command, ...args] = messageBody.split(" ");

    if (
      this.activeCommand.has(userId) &&
      this.activeCommand.get(userId) !== command.toLowerCase()
    ) {
      await this.client.sendMessage(
        message.from,
        `⚠️ A command is already active. Please complete or cancel the current command before starting a new one.`
      );
      return;
    }

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
      if (
        command.toLowerCase() !== "/start" &&
        command.toLowerCase() !== "/help"
      ) {
        this.activeCommand.set(userId, command.toLowerCase());
      }
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
        `👋 Hello, ${user.getDisplayName()}!\n\n` +
          "You are already registered. Type */help* to see what I can do."
      );
      return;
    }

    if (!user) {
      user = User.createNewUser(userId);
      await user.save();
    }

    await this.client.sendMessage(
      message.from,
      "🎓 *Welcome to your Attendance Bot!*\n\n" +
        "I'm here to help you track your class attendance effortlessly.\n\n" +
        "First, what should I call you?"
    );
  }

  async handleHelp(message, args, user) {
    let helpText = `
🤖 *AttendanceBot Help*

Here's what I can do:

📚 *Subject Management*
• */add <subject> on <day> at <time> for <hours>* - Add a new class.
• */edit <subject>* - Interactively edit a subject's details.
• */remove <subject>* - Remove a subject.
• */clearlist* - Remove all your subjects.
• */list* - Show all your subjects.

🗓️ *Daily Schedule*
• */monday*, */tuesday*, etc. - Show all classes for a specific day.

📸 *AI Timetable Parser*
• */image* - Start the AI timetable parsing process.

📊 *Attendance Tracking*
• */show attendance* - View a summary of all subjects.
• */show <subject>* - Get a detailed view of a specific subject.
• */summary* - See a quick, scannable summary of your attendance.
• */breakeven <subject> at <percentage>* - Calculate classes you can miss or need to attend.

⚙️ *Settings*
• */timezone <timezone>* - Set your local timezone.
• */settings* - View or change your preferences.
• */deleteuser* - Permanently delete your account and data.`;

    if (
      process.env.NODE_ENV === "development" ||
      process.env.DEV_MODE === "true"
    ) {
      helpText += `

🧪 *Developer Commands*
• */testconfirm* - Test the attendance confirmation flow.
• */testremind* - Test a class reminder.
• */testalert* - Test a low attendance alert.`;
    }

    helpText = helpText.trim();

    await this.client.sendMessage(message.from, helpText);
  }

  async handleImage(message, args, user) {
    const userId = user._id;
    this.messageHandler.setUserState(userId, "awaiting_timetable_image");
    await this.client.sendMessage(
      message.from,
      "📸 Please send a clear image of your timetable.\n\n" +
        "⚠️ *Disclaimer:* The AI parser may not be 100% accurate. Please review the parsed classes carefully before confirming.\n\n" +
        "You can type *cancel* at any time to abort."
    );
  }

  async handleAdd(message, args, user) {
    const fullCommand = args.join(" ");
    const userId = user._id;

    if (!fullCommand) {
      await this.client.sendMessage(
        message.from,
        "📝 *Add a Subject*\n\n" +
          "To add a new class, please use this format:\n" +
          "*/add <Subject Name> on <Day> at <Time> for <Duration in hours>*\n\n" +
          "*Examples:*\n" +
          "• `/add Mathematics on Monday at 10:00 for 2`\n" +
          "• `/add Physics on Wed at 2pm for 1.5`"
      );
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const parsed = this.parseAddCommand(fullCommand);

      if (!parsed) {
        await this.client.sendMessage(
          message.from,
          "❌ *Invalid Format*\n\n" +
            "I couldn't understand that. Please use the correct format:\n" +
            "*/add <Subject> on <Day> at <Time> for <Duration>*"
        );
        this.activeCommand.delete(userId);
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
          `❌ You already have a subject named *"${subjectName}"*.`
        );
        this.activeCommand.delete(userId);
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
          `*Subject:* ${subjectName}\n` +
          `*Day:* ${day}\n` +
          `*Time:* ${time}\n` +
          `*Duration:* ${duration} hour(s)\n\n` +
          `🔔 I'll remind you 10 minutes before each class!`
      );
    } catch (error) {
      console.error("Error adding subject:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error adding the subject. Please try again."
      );
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleEdit(message, args, user) {
    const subjectName = args.join(" ").trim();
    const userId = user._id;

    if (!subjectName) {
      await this.client.sendMessage(
        message.from,
        "📝 *Edit a Subject*\n\n" +
          "Please tell me which subject you'd like to edit.\n\n" +
          "*Format:* `/edit <Subject Name>`\n" +
          "*Example:* `/edit Mathematics`"
      );
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const subject = await Subject.findByUserAndName(user._id, subjectName);

      if (!subject) {
        await this.client.sendMessage(
          message.from,
          `❌ Subject "*${subjectName}*" not found.`
        );
        this.activeCommand.delete(userId);
        return;
      }

      this.editingSessions.set(userId, { subject, stage: "menu" });

      await this.client.sendMessage(
        message.from,
        `✏️ *Editing: ${subject.subjectName}*\n\n` +
          "What would you like to change?\n\n" +
          "1. Class Name\n" +
          "2. Class Timing\n" +
          "3. Class Day\n" +
          "4. Total Classes\n" +
          "5. Attended Classes\n" +
          "6. Mass Bunked Classes\n" +
          "7. Holiday Classes\n\n" +
          "Reply with the number of your choice, or type *'cancel'* to exit."
      );
    } catch (error) {
      console.error("Error editing subject:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error editing the subject. Please try again."
      );
      this.activeCommand.delete(userId);
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
      this.activeCommand.delete(userId);
      await this.client.sendMessage(message.from, "👍 Editing cancelled.");
      return;
    }

    const stages = {
      menu: async () => {
        const choice = parseInt(response);
        if (isNaN(choice) || choice < 1 || choice > 7) {
          await this.client.sendMessage(
            message.from,
            "Invalid choice. Please reply with a number from 1 to 7 or 'cancel'."
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
          "What is the new number of holiday classes?",
        ];
        await this.client.sendMessage(message.from, prompts[choice - 1]);
      },
      1: async () => {
        subject.subjectName = response;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Subject name updated to *${response}*`
        );
        this.returnToEditMenu(message, subject);
      },
      2: async () => {
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
      7: async () => {
        const holidayClasses = parseInt(response);
        if (isNaN(holidayClasses) || holidayClasses < 0) {
          await this.client.sendMessage(
            message.from,
            "Invalid number. Please enter a positive number for holiday classes."
          );
          return;
        }
        subject.holidayClasses = holidayClasses;
        await subject.save();
        await this.client.sendMessage(
          message.from,
          `✅ Holiday classes updated to *${holidayClasses}*`
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
      `✏️ *Editing: ${subject.subjectName}*\n\n` +
        "Anything else you would like to change?\n\n" +
        "1. Class Name\n" +
        "2. Class Timing\n" +
        "3. Class Day\n" +
        "4. Total Classes\n" +
        "5. Attended Classes\n" +
        "6. Mass Bunked Classes\n" +
        "7. Holiday Classes\n\n" +
        "Reply with a number or 'cancel' to exit."
    );
  }

  async handleRemove(message, args, user) {
    const userId = user._id;

    if (this.messageHandler.pendingRemoveConfirmations.has(userId)) {
      const pending =
        this.messageHandler.pendingRemoveConfirmations.get(userId);
      await this.client.sendMessage(
        message.from,
        `⚠️ You already have a pending removal for "*${pending.subjectName}*".\n\n` +
          `Please reply with "yes" or "no" to resolve it before removing another subject.`
      );
      return;
    }

    const subjectName = args.join(" ").trim();

    if (!subjectName) {
      await this.client.sendMessage(
        message.from,
        "🗑️ *Remove a Subject*\n\n" +
          "Format: */remove <Subject Name>*\n" +
          "Example: `/remove Mathematics`"
      );
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const subject = await Subject.findByUserAndName(user._id, subjectName);

      if (!subject) {
        await this.client.sendMessage(
          message.from,
          `❌ Subject "*${subjectName}*" not found.`
        );
        this.activeCommand.delete(userId);
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
      this.activeCommand.delete(userId);
    }
  }

  async handleClearList(message, args, user) {
    const userId = user._id;

    if (this.messageHandler.pendingClearListConfirmations.has(userId)) {
      await this.client.sendMessage(
        message.from,
        `⚠️ You already have a pending clear list confirmation.\n\n` +
          `Please reply with "yes" or "no" to resolve it.`
      );
      return;
    }
    this.messageHandler.pendingClearListConfirmations.set(userId, {
      timestamp: Date.now(),
    });

    await this.client.sendMessage(
      message.from,
      `⚠️ Are you sure you want to remove all subjects? This action cannot be undone.\n\n` +
        `Reply with *"yes"* to confirm or *"no"* to cancel.`
    );
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
    } finally {
      this.activeCommand.delete(user._id);
    }
  }

  async handleBreakeven(message, args, user) {
    const command = args.join(" ");
    const userId = user._id;

    const match = command.match(/(.+)\s+at\s+(\d{1,2})%?/);
    if (!match) {
      await this.client.sendMessage(
        message.from,
        "📊 *Breakeven Calculator*\n\n" +
          "Please use the format:\n" +
          "*/breakeven <Subject Name> at <Target Percentage>*"
      );
      this.activeCommand.delete(userId);
      return;
    }

    const [, subjectName, percentage] = match;
    const targetPercentage = parseInt(percentage);

    if (
      isNaN(targetPercentage) ||
      targetPercentage < 0 ||
      targetPercentage > 100
    ) {
      await this.client.sendMessage(
        message.from,
        "❌ Please enter a valid percentage (0-100)."
      );
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const subject = await Subject.findByUserAndName(
        userId,
        subjectName.trim()
      );
      if (!subject) {
        await this.client.sendMessage(
          message.from,
          `❌ Subject "*${subjectName.trim()}*" not found.`
        );
        this.activeCommand.delete(userId);
        return;
      }

      const result = Helpers.calculateBreakeven(
        subject.attendedClasses,
        subject.totalClasses,
        targetPercentage
      );

      let response = `📊 *Breakeven Analysis for ${subject.subjectName}*\n\n`;
      response += `*Current Attendance:* ${subject.attendancePercentage}%\n`;
      response += `*Target Attendance:* ${targetPercentage}%\n\n`;

      if (result.type === "surplus") {
        response += `✅ You can miss the next *${result.classes}* classes and still maintain your target attendance.`;
      } else if (result.type === "deficit") {
        response += `⚠️ You need to attend the next *${result.classes}* classes to reach your target attendance.`;
      } else {
        response += "🎉 You are exactly at your target attendance!";
      }

      await this.client.sendMessage(message.from, response);
    } catch (error) {
      console.error("Error handling breakeven command:", error);
      await this.client.sendMessage(
        message.from,
        "❌ An error occurred while calculating the breakeven point."
      );
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleSummary(message, args, user) {
    const userId = user._id;
    try {
      const subjects = await Subject.findActiveByUser(userId);

      if (subjects.length === 0) {
        await this.client.sendMessage(
          message.from,
          "📚 *No Subjects Found*\n\nYou haven't added any subjects yet."
        );
        this.activeCommand.delete(userId);
        return;
      }

      let response = "📊 *Attendance Summary*\n\n";

      for (const subject of subjects) {
        const percentage = subject.attendancePercentage;
        const percentageWithBunks = subject.attendancePercentageWithBunks;
        const emoji = Helpers.getAttendanceEmoji(percentage);
        const breakeven = Helpers.calculateBreakeven(
          subject.attendedClasses,
          subject.totalClasses,
          ATTENDANCE_THRESHOLDS.LOW
        );

        response += `*${subject.subjectName}*\n`;
        response += `${emoji} Total: *${percentage}%* (${subject.attendedClasses}/${subject.totalClasses})\n`;
        response += `Total (no bunks): *${percentageWithBunks}%*\n`;

        if (breakeven.type === "surplus") {
          response += `✅ You can leave next *${breakeven.classes}* classes\n\n`;
        } else if (breakeven.type === "deficit") {
          response += `❌ You need to attend next *${breakeven.classes}* classes\n\n`;
        } else {
          response += `👍 You are exactly at the ${ATTENDANCE_THRESHOLDS.LOW}% target.\n\n`;
        }
      }

      await this.client.sendMessage(message.from, response.trim());
    } catch (error) {
      console.error("Error handling summary command:", error);
      await this.client.sendMessage(
        message.from,
        "❌ An error occurred while generating your summary."
      );
    } finally {
      this.activeCommand.delete(userId);
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
        `❌ Subject "*${subjectName}*" not found.`
      );
      return;
    }

    const percentage = subject.attendancePercentage;
    const percentageWithBunks = subject.attendancePercentageWithBunks;
    const status = Helpers.getAttendanceEmoji(percentage);
    const nextClass = subject.getNextClassTime(user.timezone);

    let response = `📊 *${subject.subjectName} - Detailed View*\n\n`;
    response += `${status} *Attendance:* ${percentage}% (including mass bunks)\n`;
    response += `*Attendance (no bunks):* ${percentageWithBunks}%\n`;
    response += `✅ *Present:* ${subject.attendedClasses} classes\n`;
    response += `*Total Classes Held:* ${subject.totalClasses} classes\n`;
    response += `🤪 *Mass Bunked:* ${subject.massBunkedClasses} classes\n`;
    response += `🎉 *Holidays:* ${subject.holidayClasses} classes\n\n`;
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
      response += `You need to attend *${classesNeeded}* more classes to reach 75%.`;
    }

    await this.client.sendMessage(message.from, response);
  }

  async handleList(message, args, user) {
    const subjects = await Subject.findActiveByUser(user._id);

    if (subjects.length === 0) {
      await this.client.sendMessage(
        message.from,
        "📚 *No Subjects Found*\n\n" +
          "You haven't added any subjects yet. Use */add* to get started!"
      );
    } else {
      let response = "📚 *Your Subjects*\n\n";

      subjects.forEach((subject, index) => {
        response += `${index + 1}. *${subject.subjectName}*\n`;
        response += `   📅 ${subject.schedule.day}s at ${subject.schedule.time}\n`;
        response += `   ⏱️ ${subject.schedule.duration} hour(s)\n\n`;
      });

      await this.client.sendMessage(message.from, response);
    }

    this.activeCommand.delete(user._id);
  }

  async handleDayCommand(message, user, day) {
    const userId = user._id;
    try {
      const subjects = await Subject.findActiveByUserAndDay(userId, day);

      if (subjects.length === 0) {
        await this.client.sendMessage(
          message.from,
          `🗓️ No classes scheduled for ${day}.`
        );
      } else {
        let response = `🗓️ *Your Schedule for ${day}*\n\n`;
        subjects.forEach((subject) => {
          response += `• *${subject.schedule.time}* - ${subject.subjectName}\n`;
        });
        await this.client.sendMessage(message.from, response);
      }
    } catch (error) {
      console.error(`Error handling /${day.toLowerCase()} command:`, error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error retrieving your schedule."
      );
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleTimezone(message, args, user) {
    const timezone = args.join(" ").trim();

    if (!timezone) {
      await this.client.sendMessage(
        message.from,
        `🌍 *Current Timezone*\n\n` +
          `Your timezone is currently set to: *${user.timezone}*.\n\n` +
          `To change it, use: */timezone <Your_Timezone>*`
      );
      this.activeCommand.delete(user._id);
      return;
    }

    try {
      moment.tz.zone(timezone);

      user.timezone = timezone;
      await user.save();

      await this.client.sendMessage(
        message.from,
        `✅ *Timezone Updated*\n\n` +
          `Your timezone has been set to: *${timezone}*\n` +
          `Your current time: ${moment().tz(timezone).format("LT")}`
      );
    } catch (error) {
      await this.client.sendMessage(
        message.from,
        `❌ *Invalid Timezone*\n\n` +
          `"*${timezone}*" is not a valid timezone.\n\n` +
          `Please use a standard format like *America/New_York*, *Europe/London*, or *Asia/Kolkata*.`
      );
    } finally {
      this.activeCommand.delete(user._id);
    }
  }

  async handleSettings(message, args, user) {
    const response =
      `⚙️ *Your Settings*\n\n` +
      `*Name:* ${user.name}\n` +
      `*Timezone:* ${user.timezone}\n` +
      `*Reminders:* ${
        user.preferences.reminderEnabled ? "Enabled" : "Disabled"
      }\n` +
      `*Low Attendance Alerts:* ${
        user.preferences.lowAttendanceAlerts ? "Enabled" : "Disabled"
      }`;

    await this.client.sendMessage(message.from, response);
    this.activeCommand.delete(user._id);
  }

  async handleUnknownCommand(message) {
    await this.client.sendMessage(
      message.from,
      "❓ *Unknown Command*\n\n" + "Type */help* to see all available commands."
    );
  }

  async handleDeleteUser(message, args, user) {
    const confirmationPhrase = "confirmed";
    const userInput = args.join(" ").trim();
    const userId = user._id;

    if (userInput.toLowerCase() !== confirmationPhrase) {
      await this.client.sendMessage(
        message.from,
        "⚠️ *This is an irreversible action!* All of your data will be permanently deleted.\n\n" +
          "To confirm, please type the following phrase exactly as shown:\n" +
          `*/deleteuser ${confirmationPhrase}*`
      );
      return;
    }

    try {
      const userName = user.name;
      const deleted = await User.deleteUserAndData(userId);

      if (deleted) {
        await this.client.sendMessage(
          message.from,
          `✅ *Account Deleted Successfully*\n\n` +
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
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleTestConfirm(message, args, user) {
    const userId = user._id;
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.DEV_MODE !== "true"
    ) {
      await this.handleUnknownCommand(message);
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const testClassTime = moment().tz(user.timezone).subtract(5, "seconds");
      const currentDay = testClassTime.format("dddd");

      let testSubject = await Subject.findOneAndUpdate(
        { userId: user._id, subjectName: "Test Subject" },
        {
          $set: {
            "schedule.day": currentDay,
            "schedule.time": testClassTime.format("HH:mm"),
            "schedule.duration": 1,
            isActive: true,
          },
        },
        { upsert: true, new: true }
      );

      await AttendanceRecord.deleteMany({
        userId: user._id,
        subjectId: testSubject._id,
        status: "pending",
      });

      const record = new AttendanceRecord({
        userId: user._id,
        subjectId: testSubject._id,
        scheduledTime: testClassTime.toDate(),
        date: testClassTime.startOf("day").toDate(),
        status: "pending",
        confirmationSent: false,
        reminderSent: false,
      });

      await record.save();

      await this.client.sendMessage(
        message.from,
        `🧪 *Test Confirmation Created*\n\n` +
          `A pending attendance record has been created for "Test Subject".\n` +
          `The confirmation message should arrive within the next minute.`
      );

      setTimeout(async () => {
        await this.schedulerService.checkForAttendanceConfirmations();
        this.activeCommand.delete(userId);
      }, 2000);
    } catch (error) {
      console.error("Error in test confirm command:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error creating the test confirmation."
      );
      this.activeCommand.delete(userId);
    }
  }

  async handleTestAlert(message, args, user) {
    const userId = user._id;
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.DEV_MODE !== "true"
    ) {
      await this.handleUnknownCommand(message);
      this.activeCommand.delete(userId);
      return;
    }

    try {
      let testSubject = await Subject.findOneAndUpdate(
        { userId: user._id, subjectName: "Test Alert Subject" },
        {
          $set: {
            totalClasses: 10,
            attendedClasses: 5, // 50% attendance
            isActive: true,
            "schedule.day": moment().format("dddd"),
            "schedule.time": "00:00",
            "schedule.duration": 1,
          },
        },
        { upsert: true, new: true }
      );

      await this.client.sendMessage(
        message.from,
        `🧪 Simulating low attendance for *${testSubject.subjectName}*. Triggering alert check...`
      );

      await this.schedulerService.checkForLowAttendance();
    } catch (error) {
      console.error("Error in test alert command:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error triggering the test alert."
      );
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleTestRemind(message, args, user) {
    const userId = user._id;
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.DEV_MODE !== "true"
    ) {
      await this.handleUnknownCommand(message);
      this.activeCommand.delete(userId);
      return;
    }

    try {
      const reminderTime = moment().tz(user.timezone).add(10, "minutes");
      const currentDay = reminderTime.format("dddd");

      let testSubject = await Subject.findOneAndUpdate(
        { userId: user._id, subjectName: "Test Reminder Subject" },
        {
          $set: {
            "schedule.day": currentDay,
            "schedule.time": reminderTime.format("HH:mm"),
            "schedule.duration": 1,
            isActive: true,
          },
        },
        { upsert: true, new: true }
      );

      await this.client.sendMessage(
        message.from,
        `🧪 A test reminder for *${testSubject.subjectName}* should arrive within the next minute.`
      );

      setTimeout(async () => {
        await this.schedulerService.checkForClassReminders();
      }, 2000);
    } catch (error) {
      console.error("Error in test remind command:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error triggering the test reminder."
      );
    } finally {
      this.activeCommand.delete(userId);
    }
  }

  async handleClearConfirm(message, args, user) {
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.DEV_MODE !== "true"
    ) {
      await this.handleUnknownCommand(message);
      return;
    }

    try {
      await AttendanceRecord.deleteMany({
        userId: user._id,
        status: "pending",
      });
      await this.client.sendMessage(
        message.from,
        "✅ Pending confirmations cleared."
      );
    } catch (error) {
      console.error("Error clearing confirmations:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Error clearing confirmations."
      );
    }
  }

  async handleDebugAttendance(message, args, user) {
    if (
      process.env.NODE_ENV !== "development" &&
      process.env.DEV_MODE !== "true"
    ) {
      await this.handleUnknownCommand(message);
      return;
    }

    try {
      const allRecords = await AttendanceRecord.find({ userId: user._id })
        .populate("subjectId")
        .sort({ scheduledTime: -1 })
        .limit(10);

      const pendingRecords = await AttendanceRecord.find({
        userId: user._id,
        status: "pending",
      })
        .populate("subjectId")
        .sort({ scheduledTime: -1 });

      let debugMessage = `🐛 *Debug: Attendance Records*\n\n`;
      debugMessage += `📊 Total Records (last 10): ${allRecords.length}\n`;
      debugMessage += `⏳ Pending Records: ${pendingRecords.length}\n\n`;

      if (pendingRecords.length > 0) {
        debugMessage += `*Pending Records:*\n`;
        for (const record of pendingRecords) {
          const subject = record.subjectId;
          debugMessage += `• ${subject?.subjectName || "Unknown Subject"}\n`;
          debugMessage += `   Date: ${record.date?.toDateString()}\n`;
          debugMessage += `   Scheduled: ${record.scheduledTime}\n`;
          debugMessage += `   Status: ${record.status}\n`;
          debugMessage += `   Confirmation Sent: ${record.confirmationSent}\n`;
          debugMessage += `   Reminder Sent: ${record.reminderSent}\n\n`;
        }
      }

      if (allRecords.length > 0) {
        debugMessage += `*Recent Records:*\n`;
        for (const record of allRecords.slice(0, 5)) {
          const subject = record.subjectId;
          debugMessage += `• ${subject?.subjectName || "Unknown"} - ${
            record.status
          }\n`;
        }
      }

      await this.client.sendMessage(message.from, debugMessage);
    } catch (error) {
      console.error("Error in debug attendance:", error);
      await this.client.sendMessage(
        message.from,
        `❌ Debug error: ${error.message}`
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
