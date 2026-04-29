const User = require("../models/User");
const Subject = require("../models/Subject");
const AttendanceRecord = require("../models/AttendanceRecord");
const Helpers = require("../utils/helpers");
const { ATTENDANCE_RESPONSES } = require("../utils/constants");
const TimetableParserService = require("../services/timetableParserService");
const { getLogger } = require("../utils/logger");

class MessageHandler {
  constructor(client, commandHandler) {
    this.client = client;
    this.commandHandler = commandHandler;
    this.userStates = new Map();
    this.pendingAttendanceResponses = new Map();
    this.pendingTimetableConfirmations = new Map();
    this.timetableParser = new TimetableParserService();
    this.pendingRemoveConfirmations = new Map();
    this.pendingClearListConfirmations = new Map();
    this.logger = getLogger();
  }

  setUserState(userId, state, data = {}) {
    this.userStates.set(userId, { type: state, data });
  }

  clearUserState(userId) {
    this.userStates.delete(userId);
  }

  async handleMessage(message) {
    const userId = message.from.replace("@c.us", "");
    const originalMessageBody = message.sanitizedBody?.trim() || "";
    const messageBody = originalMessageBody.toLowerCase();
    const user = await User.findByWhatsAppId(userId);

    // Route commands to command handler
    if (originalMessageBody.startsWith("/")) {
      await this.commandHandler.handleCommand(message);
      return;
    }

    const currentState = this.userStates.get(userId);
    if (currentState?.type === "awaiting_timetable_image") {
      if (messageBody === "cancel") {
        this.clearUserState(userId);
        this.commandHandler.activeCommand.delete(userId);
        await this.client.sendMessage(
          message.from,
          "Image submission cancelled.",
        );
        return;
      }
      if (message.hasMedia && message.type === "image") {
        await this.handleTimetableImage(message, this.client, user);
        return;
      }
    }

    if (
      this.pendingTimetableConfirmations.has(userId) &&
      !this.isTimetableConfirmationResponse(messageBody)
    ) {
      await this.client.sendMessage(
        message.from,
        "Please confirm or cancel the pending timetable before sending another command or image.",
      );
      return;
    }

    if (this.commandHandler.editingSessions.has(userId)) {
      await this.commandHandler.handleEditConversation(message, user);
      return;
    }

    if (!user) {
      await this.client.sendMessage(
        message.from,
        "👋 Welcome! You need to register first to use this bot.\n\n" +
          "Please type */start* to begin registration.",
      );
      return;
    }

    if (!user.isFullyRegistered()) {
      await this.handleRegistrationFlow(message, user, messageBody);
      return;
    }

    if (
      this.pendingRemoveConfirmations.has(userId) &&
      (ATTENDANCE_RESPONSES.POSITIVE.includes(messageBody) ||
        ATTENDANCE_RESPONSES.NEGATIVE.includes(messageBody))
    ) {
      await this.handleRemoveConfirmationResponse(message, user, messageBody);
      return;
    }

    if (this.pendingClearListConfirmations.has(userId)) {
      await this.handleClearListConfirmation(message, user, messageBody);
      return;
    }

    if (this.isAttendanceResponse(messageBody)) {
      await this.handleAttendanceResponse(message, user, messageBody);
      return;
    }

    if (this.isTimetableConfirmationResponse(messageBody)) {
      await this.handleTimetableConfirmationResponse(
        message,
        this.client,
        user,
        messageBody,
      );
      return;
    }

    await this.handleGeneralMessage(message, this.client, user, messageBody);
  }

  async handleRegistrationFlow(message, user, messageBody) {
    switch (user.registrationStep) {
      case "name":
        if (messageBody.length < 2 || messageBody.length > 50) {
          await this.client.sendMessage(
            message.from,
            "❌ Please enter a valid name (2-50 characters).\n\n" +
              "What's your name?",
          );
          return;
        }

        user.name = Helpers.capitalizeWords(messageBody);
        user.registrationStep = "timezone";
        await user.save();

        await this.client.sendMessage(
          message.from,
          `Nice to meet you, ${user.name}! 👋\n\n` +
            "Now, what's your timezone? This helps me send reminders at the right time.\n\n" +
            "Examples:\n" +
            "• Asia/Kolkata (for India)\n" +
            "• America/New_York (for EST)\n" +
            "• Europe/London (for UK)\n\n" +
            'Or just type "india" if you\'re in India.',
        );
        break;

      case "timezone":
        let timezone = messageBody.trim();

        if (timezone === "india" || timezone === "indian") {
          timezone = "Asia/Kolkata";
        } else if (timezone === "usa" || timezone === "america") {
          timezone = "America/New_York";
        } else if (timezone === "uk" || timezone === "britain") {
          timezone = "Europe/London";
        }

        try {
          const moment = require("moment-timezone");
          if (!moment.tz.zone(timezone)) {
            throw new Error("Invalid timezone");
          }

          user.timezone = timezone;
          user.isRegistered = true;
          user.registrationStep = "completed";
          await user.save();

          await this.client.sendMessage(
            message.from,
            `🎉 *Registration Complete!*\n\n` +
              `Welcome to AttendanceBot, ${user.name}!\n\n` +
              `✅ Name: ${user.name}\n` +
              `🌍 Timezone: ${timezone}\n\n` +
              `🚀 *What's next?*\n` +
              `• Add your subjects with */add*\n` +
              `• Type */help* to see all commands\n\n` +
              `Let's add your first subject! Use:\n` +
              `*/add <subject> on <day> at <time> for <hours>*\n\n` +
              `Example: /add Mathematics on Monday at 10:00 for 2`,
          );
        } catch (error) {
          await this.client.sendMessage(
            message.from,
            `❌ "${timezone}" is not a valid timezone.\n\n` +
              "Please try again with a valid timezone like:\n" +
              "• Asia/Kolkata\n" +
              "• America/New_York\n" +
              "• Europe/London\n\n" +
              'Or type "india" for Indian timezone.',
          );
        }
        break;

      default:
        await this.client.sendMessage(
          message.from,
          "Something went wrong with registration. Please type */start* to begin again.",
        );
    }
  }

  async handleAttendanceResponse(message, user, messageBody) {
    try {
      const record = await AttendanceRecord.findOne({
        userId: user._id,
        status: "pending",
        subjectId: { $ne: null },
      })
        .populate("subjectId")
        .sort({ scheduledTime: -1 });

      if (!record || !record.subjectId) {
        await this.client.sendMessage(
          message.from,
          "🤔 I don't have any pending attendance confirmations for you.",
        );
        return;
      }

      const attendanceStatus = this.parseAttendanceResponse(messageBody);

      if (attendanceStatus === "present") {
        await record.markPresent();
        await record.subjectId.markAttendance(true, false, false);

        await this.client.sendMessage(
          message.from,
          `✅ *Attendance Marked: Present*\n\n` +
            `📚 Subject: ${record.subjectId.subjectName}\n` +
            `📅 Date: ${record.date.toDateString()}\n\n` +
            `Current attendance: ${record.subjectId.attendancePercentage}% ` +
            `(${record.subjectId.attendedClasses}/${record.subjectId.totalClasses})`,
        );
      } else if (attendanceStatus === "absent") {
        await record.markAbsent(false);
        await record.subjectId.markAttendance(false, false, false);

        let response =
          `❌ *Attendance Marked: Absent*\n\n` +
          `📚 Subject: ${record.subjectId.subjectName}\n` +
          `📅 Date: ${record.date.toDateString()}\n\n` +
          `Current attendance: ${record.subjectId.attendancePercentage}% ` +
          `(${record.subjectId.attendedClasses}/${record.subjectId.totalClasses})`;

        if (record.subjectId.attendancePercentage < 75) {
          response += `\n\n⚠️ *Low Attendance Warning!*\n`;
          response += `Your attendance is below 75%. Please attend more classes.`;
        }

        await this.client.sendMessage(message.from, response);
      } else if (attendanceStatus === "massBunked") {
        await record.markMassBunk();
        await record.subjectId.markAttendance(false, true, false);

        await this.client.sendMessage(
          message.from,
          `🤪 *Attendance Marked: Mass Bunk*\n\n` +
            `📚 Subject: ${record.subjectId.subjectName}\n` +
            `📅 Date: ${record.date.toDateString()}\n\n` +
            `Current attendance: ${record.subjectId.attendancePercentage}% ` +
            `(${record.subjectId.attendedClasses}/${record.subjectId.totalClasses})`,
        );
      } else if (attendanceStatus === "holiday") {
        await record.markHoliday();
        await record.subjectId.markAttendance(false, false, true);

        await this.client.sendMessage(
          message.from,
          `🎉 *Marked as Holiday*\n\n` +
            `📚 Subject: ${record.subjectId.subjectName}\n` +
            `📅 Date: ${record.date.toDateString()}\n\n` +
            `This class will not be counted in your attendance.`,
        );
      }
    } catch (error) {
      console.error("Error handling attendance response:", error);
      await this.client.sendMessage(
        message.from,
        "❌ Sorry, there was an error recording your attendance. Please try again.",
      );
    }
  }

  async handleRemoveConfirmationResponse(message, user, messageBody) {
    const userId = user._id;
    const pendingConfirmation = this.pendingRemoveConfirmations.get(userId);

    const confirmationExpires = 2 * 60 * 1000;
    if (Date.now() - pendingConfirmation.timestamp > confirmationExpires) {
      this.pendingRemoveConfirmations.delete(userId);
      await this.client.sendMessage(
        message.from,
        "⏰ Confirmation timed out. Please use the /remove command again if you still wish to remove the subject.",
      );
      return;
    }

    const isConfirmed = ATTENDANCE_RESPONSES.POSITIVE.includes(
      messageBody.toLowerCase().trim(),
    );

    this.pendingRemoveConfirmations.delete(userId);

    if (isConfirmed) {
      try {
        const subject = await Subject.findById(pendingConfirmation.subjectId);
        if (!subject || subject.userId.toString() !== userId) {
          await this.client.sendMessage(
            message.from,
            "❌ Error: Subject not found or it does not belong to you.",
          );
          return;
        }

        subject.isActive = false;
        await subject.save();

        await this.client.sendMessage(
          message.from,
          `✅ *Subject Removed*\n\n` +
            `📚 "${subject.subjectName}" has been removed from your schedule.\n\n` +
            `Your attendance history has been preserved.`,
        );
      } catch (error) {
        this.logger.error("Error confirming subject removal:", error, {
          userId,
        });
        await this.client.sendMessage(
          message.from,
          "❌ An error occurred while removing the subject.",
        );
      }
    } else {
      await this.client.sendMessage(
        message.from,
        `👍 Removal of "*${pendingConfirmation.subjectName}*" has been cancelled.`,
      );
    }
    this.commandHandler.activeCommand.delete(userId);
  }

  async handleClearListConfirmation(message, user, messageBody) {
    const userId = user._id;
    const pendingConfirmation = this.pendingClearListConfirmations.get(userId);

    const confirmationExpires = 2 * 60 * 1000; // 2 minutes
    if (Date.now() - pendingConfirmation.timestamp > confirmationExpires) {
      this.pendingClearListConfirmations.delete(userId);
      await this.client.sendMessage(
        message.from,
        "⏰ Confirmation timed out. Please use the /clearlist command again.",
      );
      return;
    }

    const isConfirmed = ATTENDANCE_RESPONSES.POSITIVE.includes(
      messageBody.toLowerCase().trim(),
    );

    this.pendingClearListConfirmations.delete(userId);

    if (isConfirmed) {
      try {
        await Subject.deleteMany({ userId: userId });
        await this.client.sendMessage(
          message.from,
          "✅ All subjects have been successfully removed.",
        );
      } catch (error) {
        this.logger.error("Error clearing subject list:", error, { userId });
        await this.client.sendMessage(
          message.from,
          "❌ An error occurred while removing your subjects.",
        );
      }
    } else {
      await this.client.sendMessage(
        message.from,
        "👍 Action cancelled. Your subjects have not been removed.",
      );
    }
    this.commandHandler.activeCommand.delete(userId);
  }

  async handleGeneralMessage(message, client, user, messageBody) {
    const responses = {
      hi: "👋 Hello! Type */help* to see what I can do.",
      hello: "👋 Hi there! Type */help* to see available commands.",
      help: "Type */help* to see all available commands.",
      thanks: "😊 You're welcome! Happy to help with your attendance.",
      "thank you": "😊 You're welcome! Let me know if you need anything else.",
      attendance: "Type */show attendance* to view your attendance overview.",
      subjects: "Type */list* to see all your subjects.",
      how: "Type */help* to see how to use this bot.",
      what: "I'm an attendance tracking bot! Type */help* to learn more.",
    };

    for (const [key, response] of Object.entries(responses)) {
      if (messageBody.includes(key)) {
        await this.client.sendMessage(message.from, response);
        return;
      }
    }

    await this.client.sendMessage(
      message.from,
      "🤔 I didn't understand that.\n\n" +
        "Type */help* to see available commands, or use */add* to add a subject.",
    );
  }

  isAttendanceResponse(messageBody) {
    const allResponses = [
      ...ATTENDANCE_RESPONSES.POSITIVE,
      ...ATTENDANCE_RESPONSES.NEGATIVE,
      ...ATTENDANCE_RESPONSES.MASS_BUNK,
      ...ATTENDANCE_RESPONSES.HOLIDAY,
    ];

    return allResponses.includes(messageBody);
  }

  parseAttendanceResponse(messageBody) {
    if (
      ATTENDANCE_RESPONSES.POSITIVE.some(
        (response) =>
          messageBody === response || messageBody.includes(response),
      )
    ) {
      return "present";
    }
    if (
      ATTENDANCE_RESPONSES.NEGATIVE.some(
        (response) =>
          messageBody === response || messageBody.includes(response),
      )
    ) {
      return "absent";
    }
    if (
      ATTENDANCE_RESPONSES.MASS_BUNK.some(
        (response) =>
          messageBody === response || messageBody.includes(response),
      )
    ) {
      return "massBunked";
    }
    if (
      ATTENDANCE_RESPONSES.HOLIDAY.some(
        (response) =>
          messageBody === response || messageBody.includes(response),
      )
    ) {
      return "holiday";
    }
  }

  async handleTimetableImage(message, client, user) {
    const userId = message.from.replace("@c.us", "");
    this.clearUserState(userId);
    this.commandHandler.activeCommand.delete(userId);

    try {
      if (!this.timetableParser.isAvailable()) {
        await this.client.sendMessage(
          message.from,
          "🤖 *AI Timetable Parser*\n\n" +
            "Sorry, the AI timetable parser is not configured.\n\n" +
            "Please add your subjects manually using:\n" +
            "*/add <subject> on <day> at <time> for <hours>*",
        );
        return;
      }

      await this.client.sendMessage(
        message.from,
        "🔍 *Processing Timetable Image*\n\n" +
          "I'm analyzing your timetable image...\n" +
          "This may take a few seconds.",
      );

      const media = await message.downloadMedia();
      if (!media || !media.data) {
        throw new Error("Failed to download image");
      }

      const imageBuffer = Buffer.from(media.data, "base64");

      const parsedClasses = await this.timetableParser.parseTimetableImage(
        imageBuffer,
        userId,
      );

      if (parsedClasses.length === 0) {
        await this.client.sendMessage(
          message.from,
          "❌ *No Classes Found*\n\n" +
            "I couldn't find any classes in your timetable image.\n\n" +
            "Please make sure:\n" +
            "• The image is clear and readable\n" +
            "• The timetable is well-structured\n" +
            "• Text is not too small or blurry\n\n" +
            "You can still add subjects manually using:\n" +
            "*/add <subject> on <day> at <time> for <hours>*",
        );
        return;
      }

      const newClasses = [];
      const existingClasses = [];

      for (const classData of parsedClasses) {
        const existingSubject = await Subject.findByUserAndNameAndDay(
          user._id,
          classData.subject,
          classData.day,
        );
        if (existingSubject) {
          existingClasses.push(classData);
        } else {
          newClasses.push(classData);
        }
      }

      this.pendingTimetableConfirmations.set(userId, {
        classes: newClasses,
        timestamp: Date.now(),
      });

      let response = `📋 *Timetable Parsed Successfully!*\n\n`;
      response += `I found *${parsedClasses.length} classes* in your timetable.\n\n`;

      if (newClasses.length > 0) {
        response += `🆕 *${newClasses.length} new classes to add:*\n`;
        for (let i = 0; i < newClasses.length; i++) {
          const cls = newClasses[i];
          response += `${i + 1}. *${cls.subject}*\n`;
          response += `   📅 ${cls.day} | ⏰ ${cls.startTime}-${cls.endTime} | ⏱️ ${cls.duration}h\n\n`;
        }
      }

      if (existingClasses.length > 0) {
        response += `⚠️ *${existingClasses.length} classes already exist:*\n`;
        for (const cls of existingClasses) {
          response += `• ${cls.subject} (${cls.day} ${cls.startTime}-${cls.endTime})\n`;
        }
        response += "\n";
      }

      if (newClasses.length > 0) {
        response += `🤔 *Do you want to add these classes?*\n\n`;
        response += `Reply with:\n`;
        response += `• *"confirm"* - Add all classes\n`;
        response += `• *"cancel"* - Cancel and don't add any\n`;
        response += `• *"skip"* - Skip this confirmation (auto-add)\n\n`;
        response += `⏰ *Confirmation expires in 5 minutes*`;
      } else {
        response += `ℹ️ *All classes already exist in your schedule*\n\n`;
        response += `Type */list* to see all your subjects`;
      }

      await this.client.sendMessage(message.from, response);
    } catch (error) {
      this.logger.error("Timetable image processing failed", error, { userId });

      await this.client.sendMessage(
        message.from,
        "❌ *Timetable Processing Failed*\n\n" +
          "Sorry, I couldn't process your timetable image.\n\n" +
          "Please try:\n" +
          "• Sending a clearer image\n" +
          "• Making sure the text is readable\n" +
          "• Using a well-structured timetable\n\n" +
          "Or add subjects manually:\n" +
          "*/add <subject> on <day> at <time> for <hours>*",
      );
    }
  }

  isTimetableConfirmationResponse(messageBody) {
    const confirmationKeywords = ["yes", "confirm", "no", "cancel", "skip"];
    return confirmationKeywords.some((keyword) =>
      messageBody.toLowerCase().includes(keyword),
    );
  }

  async handleTimetableConfirmationResponse(
    message,
    client,
    user,
    messageBody,
  ) {
    const userId = message.from.replace("@c.us", "");
    const pendingConfirmation = this.pendingTimetableConfirmations.get(userId);

    if (!pendingConfirmation) {
      return;
    }

    const now = Date.now();
    const timeDiff = now - pendingConfirmation.timestamp;
    if (timeDiff > 5 * 60 * 1000) {
      this.pendingTimetableConfirmations.delete(userId);
      await this.client.sendMessage(
        message.from,
        "⏰ *Confirmation expired*\n\n" +
          "The timetable confirmation has expired.\n" +
          "Please send the timetable image again.",
      );
      return;
    }

    const response = messageBody.toLowerCase().trim();
    let action = "";

    if (response.includes("yes") || response.includes("confirm")) {
      action = "confirm";
    } else if (response.includes("no") || response.includes("cancel")) {
      action = "cancel";
    } else if (response.includes("skip")) {
      action = "skip";
    } else {
      await this.client.sendMessage(
        message.from,
        "❓ *Invalid response*\n\n" +
          "Please reply with:\n" +
          '• *"yes"* or *"confirm"* - Add all classes\n' +
          '• *"no"* or *"cancel"* - Cancel and don\'t add any\n' +
          '• *"skip"* - Skip this confirmation (auto-add)',
      );
      return;
    }

    this.pendingTimetableConfirmations.delete(userId);

    if (action === "cancel") {
      await this.client.sendMessage(
        message.from,
        "❌ *Timetable addition cancelled*\n\n" +
          "No classes were added to your schedule.\n\n" +
          "You can still add subjects manually using:\n" +
          "*/add <subject> on <day> at <time> for <hours>*",
      );
      return;
    }

    const classes = pendingConfirmation.classes;
    const addedClasses = [];
    const failedClasses = [];

    for (const classData of classes) {
      try {
        const existingSubject = await Subject.findByUserAndNameAndDay(
          user._id,
          classData.subject,
          classData.day,
        );
        if (existingSubject) {
          failedClasses.push({
            subject: classData.subject,
            reason: "Already exists",
          });
          continue;
        }

        const subject = new Subject({
          userId: user._id,
          subjectName: classData.subject,
          schedule: {
            day: classData.day,
            time: classData.startTime,
            duration: classData.duration,
          },
        });

        await subject.save();
        addedClasses.push(classData);
      } catch (error) {
        this.logger.error("Failed to add class from AI parsing", error, {
          userId,
          classData,
        });
        failedClasses.push({
          subject: classData.subject,
          reason: "Database error",
        });
      }
    }

    let responseMessage = `🎉 *Timetable Classes Added!*\n\n`;

    if (addedClasses.length > 0) {
      responseMessage += `✅ *Successfully added ${addedClasses.length} classes:*\n`;
      for (const cls of addedClasses) {
        responseMessage += `• ${cls.subject} (${cls.day} ${cls.startTime}-${cls.endTime})\n`;
      }
      responseMessage += "\n";
    }

    if (failedClasses.length > 0) {
      responseMessage += `⚠️ *${failedClasses.length} classes failed:*\n`;
      for (const cls of failedClasses) {
        responseMessage += `• ${cls.subject} (${cls.reason})\n`;
      }
      responseMessage += "\n";
    }

    responseMessage += `📊 *Your Schedule*\n`;
    responseMessage += `Total subjects: ${await Subject.countDocuments({
      userId: user._id,
    })}\n\n`;
    responseMessage += `Type */list* to see all your subjects\n`;
    responseMessage += `Type */show attendance* to view attendance`;

    await this.client.sendMessage(message.from, responseMessage);
  }

  cleanupExpiredConfirmations() {
    const now = Date.now();
    const expiredUsers = [];

    for (const [
      userId,
      confirmation,
    ] of this.pendingTimetableConfirmations.entries()) {
      const timeDiff = now - confirmation.timestamp;
      if (timeDiff > 5 * 60 * 1000) {
        expiredUsers.push(userId);
      }
    }

    expiredUsers.forEach((userId) => {
      this.pendingTimetableConfirmations.delete(userId);
    });

    if (expiredUsers.length > 0) {
      this.logger.info("Cleaned up expired timetable confirmations", {
        expiredCount: expiredUsers.length,
      });
    }
  }
}

module.exports = MessageHandler;
