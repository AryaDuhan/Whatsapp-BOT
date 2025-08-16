const cron = require("node-cron");
const moment = require("moment-timezone");
const Subject = require("../models/Subject");
const User = require("../models/User");
const AttendanceRecord = require("../models/AttendanceRecord");

class SchedulerService {
  constructor() {
    this.jobs = new Map(); // cron jobs for cleanup
    this.whatsappClient = null;
  }

  async initialize(whatsappClient = null) {
    this.whatsappClient = whatsappClient;
    console.log("🕐 Initializing Scheduler Service...");

    // Create attendance records for today's classes on startup
    await this.createDailyAttendanceRecords();

    // Schedule daily record creation at midnight
    this.scheduleDailyRecordCreation();

    // Other existing schedules...
    this.scheduleReminderCheck();
    this.scheduleConfirmationCheck();
    this.scheduleOverdueCheck();
    this.scheduleLowAttendanceCheck();
    this.scheduleTimetableConfirmationCleanup();

    console.log("✅ Scheduler Service initialized successfully");
  }

  scheduleDailyRecordCreation() {
    // Run every day at midnight to create records for the next day
    const job = cron.schedule(
      "0 0 * * *",
      async () => {
        try {
          await this.createDailyAttendanceRecords();
        } catch (error) {
          console.error("❌ Error in daily record creation:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("dailyRecordCreation", job);
    console.log("📅 Daily record creation scheduled (midnight daily)");
  }

  scheduleReminderCheck() {
    // Check every minute
    const job = cron.schedule(
      "* * * * *",
      async () => {
        try {
          await this.checkForClassReminders();
        } catch (error) {
          console.error("❌ Error in reminder check:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("reminderCheck", job);
    console.log("📅 Reminder check scheduled (every minute)");
  }

  scheduleConfirmationCheck() {
    // Check every minute
    const job = cron.schedule(
      "* * * * *",
      async () => {
        try {
          await this.checkForAttendanceConfirmations();
        } catch (error) {
          console.error("❌ Error in confirmation check:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("confirmationCheck", job);
    console.log("✅ Confirmation check scheduled (every minute)");
  }

  scheduleOverdueCheck() {
    // check every 30 mins for overdue attendance responses
    const job = cron.schedule(
      "*/30 * * * *",
      async () => {
        try {
          await this.checkForOverdueAttendance();
        } catch (error) {
          console.error("❌ Error in overdue check:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("overdueCheck", job);
    console.log("⏰ Overdue check scheduled (every 30 minutes)");
  }

  scheduleLowAttendanceCheck() {
    // check daily at 6 PM for low attendance alerts
    const job = cron.schedule(
      "0 18 * * *",
      async () => {
        try {
          await this.checkForLowAttendance();
        } catch (error) {
          console.error("❌ Error in low attendance check:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("lowAttendanceCheck", job);
    console.log("📊 Low attendance check scheduled (daily at 6 PM UTC)");
  }

  scheduleTimetableConfirmationCleanup() {
    // clean up expired timetable confirmations every 5 minutes
    const job = cron.schedule(
      "*/5 * * * *",
      async () => {
        try {
          if (global.attendanceBot && global.attendanceBot.messageHandler) {
            global.attendanceBot.messageHandler.cleanupExpiredConfirmations();
          }
        } catch (error) {
          console.error("❌ Error in timetable confirmation cleanup:", error);
        }
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    this.jobs.set("timetableConfirmationCleanup", job);
    console.log(
      "🧹 Timetable confirmation cleanup scheduled (every 5 minutes)"
    );
  }

  async createDailyAttendanceRecords() {
    try {
      console.log("📝 Creating daily attendance records...");

      const subjects = await Subject.find({ isActive: true }).populate(
        "userId"
      );
      const today = moment().format("dddd");

      for (const subject of subjects) {
        if (!subject.userId) continue;

        const user = subject.userId;

        if (subject.schedule.day.toLowerCase() === today.toLowerCase()) {
          const classTime = moment()
            .tz(user.timezone)
            .set({
              hour: parseInt(subject.schedule.time.split(":")[0]),
              minute: parseInt(subject.schedule.time.split(":")[1]),
              second: 0,
              millisecond: 0,
            });

          if (classTime.isAfter(moment())) {
            const startOfDay = classTime.clone().startOf("day");

            const existingRecord = await AttendanceRecord.findOne({
              userId: user._id,
              subjectId: subject._id,
              date: {
                $gte: startOfDay.toDate(),
                $lt: startOfDay.clone().add(1, "day").toDate(),
              },
            });

            if (!existingRecord) {
              const record = new AttendanceRecord({
                userId: user._id,
                subjectId: subject._id,
                date: startOfDay.toDate(),
                scheduledTime: classTime.toDate(),
                status: "pending",
                confirmationSent: false,
                reminderSent: false,
              });

              await record.save();
              console.log(
                `✅ Created attendance record for ${user.name} - ${subject.subjectName}`
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("❌ Error creating daily attendance records:", error);
    }
  }

  async checkForClassReminders() {
    try {
      const now = moment().utc();
      const subjects = await Subject.find({ isActive: true }).populate(
        "userId"
      );

      for (const subject of subjects) {
        if (!subject.userId) continue;

        const user = subject.userId;
        const nextClassTime = subject.getNextClassTime(user.timezone);
        const reminderTime = nextClassTime.clone().subtract(10, "minutes");

        if (Math.abs(now.diff(reminderTime, "minutes")) < 1) {
          await this.sendClassReminder(user, subject, nextClassTime);
        }
      }
    } catch (error) {
      console.error("Error checking for class reminders:", error);
    }
  }

  async checkForAttendanceConfirmations() {
    try {
      const now = moment();

      const pendingRecords = await AttendanceRecord.find({
        status: "pending",
        confirmationSent: false,
        scheduledTime: {
          $gte: moment().subtract(24, "hours").toDate(),
          $lte: now.toDate(),
        },
      })
        .populate("userId")
        .populate("subjectId");

      for (const record of pendingRecords) {
        if (!record.userId || !record.subjectId) continue;

        const user = record.userId;
        const subject = record.subjectId;
        const classTime = moment(record.scheduledTime);

        const confirmationDelay =
          process.env.NODE_ENV === "development" ? 10 : 15 * 60;
        const confirmationTime = classTime
          .clone()
          .add(confirmationDelay, "seconds");

        if (now.isAfter(confirmationTime) && !record.confirmationSent) {
          console.log(
            `📤 Sending confirmation for ${subject.subjectName} to ${user.name}`
          );
          await this.sendAttendanceConfirmation(user, subject, record);
        }
      }
    } catch (error) {
      console.error("❌ Error checking for attendance confirmations:", error);
    }
  }

  async checkForOverdueAttendance() {
    try {
      const overdueRecords = await AttendanceRecord.findOverdueRecords(2);

      for (const record of overdueRecords) {
        if (!record.subjectId) continue;

        await record.markAbsent(true);
        await record.subjectId.markAttendance(false);

        const user = await User.findById(record.userId);
        if (user && this.whatsappClient) {
          const message =
            `⏰ *Attendance Auto-Marked*\n\n` +
            `❌ You've been marked absent for:\n` +
            `📚 ${record.subjectId.subjectName}\n` +
            `📅 ${record.date.toDateString()}\n\n` +
            `Reason: No response within 2 hours\n\n` +
            `Current attendance: ${record.subjectId.attendancePercentage}%`;

          await this.sendMessage(user._id, message);
        }

        console.log(
          `🕐 Auto-marked absent: ${record.userId} - ${record.subjectId.subjectName}`
        );
      }
    } catch (error) {
      console.error("Error checking for overdue attendance:", error);
    }
  }

  async checkForLowAttendance() {
    try {
      const users = await User.find({ isRegistered: true });

      for (const user of users) {
        const lowAttendanceSubjects = await Subject.findLowAttendance(
          user._id,
          75
        );

        if (
          lowAttendanceSubjects.length > 0 &&
          user.preferences.lowAttendanceAlerts
        ) {
          await this.sendLowAttendanceAlert(user, lowAttendanceSubjects);
        }
      }
    } catch (error) {
      console.error("Error checking for low attendance:", error);
    }
  }

  async sendClassReminder(user, subject, classTime) {
    if (!this.whatsappClient || !user.preferences.reminderEnabled) {
      console.log(
        `📱 Reminder not sent: WhatsApp unavailable or reminders disabled`
      );
      return;
    }

    try {
      console.log(
        `🔔 Sending reminder for ${subject.subjectName} to ${user.name}`
      );

      const today = moment().tz(user.timezone).startOf("day");
      const tomorrow = today.clone().add(1, "day");

      let existingRecord = await AttendanceRecord.findOne({
        userId: user._id,
        subjectId: subject._id,
        date: {
          $gte: today.toDate(),
          $lt: tomorrow.toDate(),
        },
      });

      if (existingRecord && existingRecord.reminderSent) {
        console.log(`📝 Reminder already sent for this class`);
        return;
      }

      const message =
        `🔔 *Class Reminder*\n\n` +
        `📚 Subject: ${subject.subjectName}\n` +
        `⏰ Time: ${classTime.format("h:mm A")}\n` +
        `⌛ Duration: ${subject.schedule.duration} hour(s)\n\n` +
        `Your class starts in 10 minutes! 🎓`;

      await this.sendMessage(user._id, message);

      if (!existingRecord) {
        existingRecord = AttendanceRecord.createForClass(
          user._id,
          subject._id,
          classTime.toDate()
        );
      }

      existingRecord.reminderSent = true;
      await existingRecord.save();

      console.log(
        `🔔 Reminder sent successfully: ${user.name} - ${subject.subjectName}`
      );
    } catch (error) {
      console.error("❌ Error sending class reminder:", error);
    }
  }

  async sendAttendanceConfirmation(user, subject, record) {
    if (!this.whatsappClient) {
      console.log(`📱 WhatsApp client not available`);
      return;
    }

    try {
      console.log(
        `📤 Attempting to send confirmation for ${subject.subjectName} to ${user.name}`
      );

      if (record.status !== "pending" || record.confirmationSent) {
        console.log(`⚠️ Record is no longer pending or already sent`);
        return;
      }

      const classTime = moment(record.scheduledTime).tz(user.timezone);

      const message =
        `✅ *Attendance Confirmation*\n\n` +
        `📚 Subject: ${subject.subjectName}\n` +
        `📅 Date: ${classTime.format("dddd, MMM Do")}\n` +
        `⏰ Time: ${classTime.format("h:mm A")}\n\n` +
        `Did you attend this class?\n\n` +
        `Reply with:\n` +
        `• *Yes* - if you attended\n` +
        `• *No* - if you missed it\n` +
        `• *Mass Bunk* - if it was a mass bunk\n` +
        `• *Holiday* - if the class was cancelled\n\n` +
        `⏳ You have 2 hours to respond, or you'll be marked absent.`;

      await this.sendMessage(user._id, message);

      record.confirmationSent = true;
      await record.save();

      console.log(
        `✅ Confirmation sent successfully: ${user.name} - ${subject.subjectName}`
      );
    } catch (error) {
      console.error("❌ Error sending attendance confirmation:", error);
    }
  }

  async sendLowAttendanceAlert(user, lowAttendanceSubjects) {
    if (!this.whatsappClient) return;

    try {
      let message =
        `⚠️ *Low Attendance Alert*\n\n` +
        `Hi ${user.name}, your attendance is below 75% for:\n\n`;

      for (const subject of lowAttendanceSubjects) {
        const classesNeeded = this.calculateClassesNeeded(
          subject.attendedClasses,
          subject.totalClasses,
          75
        );

        const classesNeededWithBunks = this.calculateClassesNeeded(
          subject.attendedClasses,
          subject.totalClasses - subject.massBunkedClasses,
          75
        );

        message +=
          `📚 *${subject.subjectName}*\n` +
          `   Current: ${subject.attendancePercentage}% ` +
          `(${subject.attendedClasses}/${subject.totalClasses})\n` +
          `   (Excluding Bunks: ${subject.attendancePercentageWithBunks}%)\n` +
          `   Need ${classesNeeded} more classes for 75%\n` +
          `   (or ${classesNeededWithBunks} if not counting bunks)\n\n`;
      }

      message += `💡 *Tip:* Attend your upcoming classes to improve your attendance!`;

      await this.sendMessage(user._id, message);
      console.log(`⚠️ Low attendance alert sent: ${user.name}`);
    } catch (error) {
      console.error("Error sending low attendance alert:", error);
    }
  }

  async sendMessage(userId, message) {
    if (!this.whatsappClient) {
      console.log(`Would send message to ${userId}: ${message}`);
      return;
    }

    try {
      const chatId = `${userId}@c.us`;
      await this.whatsappClient.sendMessage(chatId, message);
    } catch (error) {
      console.error(`Error sending message to ${userId}:`, error);
    }
  }

  calculateClassesNeeded(attended, total, targetPercentage) {
    if (total <= 0) return 0;
    const numerator = targetPercentage * total - 100 * attended;
    const denominator = 100 - targetPercentage;
    return Math.max(0, Math.ceil(numerator / denominator));
  }

  setWhatsAppClient(client) {
    this.whatsappClient = client;
    console.log("📱 WhatsApp client connected to scheduler");
  }

  stop() {
    console.log("🛑 Stopping scheduler service...");
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`   Stopped: ${name}`);
    }
    this.jobs.clear();
    console.log("✅ Scheduler service stopped");
  }
}

module.exports = SchedulerService;
