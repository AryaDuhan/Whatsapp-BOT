const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const mongoose = require("mongoose");
const cron = require("node-cron");
require("dotenv").config();

const CommandHandler = require("./handlers/commandHandler");
const MessageHandler = require("./handlers/messageHandler");
const SchedulerService = require("./services/schedulerService");
const DatabaseService = require("./services/databaseService");
const RateLimiter = require("./middleware/rateLimiter");
const InputValidator = require("./middleware/inputValidator");
const SecurityManager = require("./middleware/securityManager");
const ErrorHandler = require("./middleware/errorHandler");
const { getLogger } = require("./utils/logger");

class AttendanceBot {
  constructor() {
    this.logger = getLogger();
    this.logger.info("🚀 Initializing WhatsApp Attendance Bot");

    this.rateLimiter = new RateLimiter({
      commandsPerMinute: 10,
      messagesPerMinute: 20,
      registrationsPerHour: 5,
      subjectsPerHour: 20,
    });

    this.inputValidator = new InputValidator();
    this.securityManager = new SecurityManager();
    this.errorHandler = new ErrorHandler();

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: "attendance-bot",
      }),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
        ],
      },
    });

    this.schedulerService = new SchedulerService();
    this.commandHandler = new CommandHandler(
      this.client,
      this.schedulerService
    );
    this.messageHandler = new MessageHandler(this.client, this.commandHandler);
    this.commandHandler.setMessageHandler(this.messageHandler);

    this.databaseService = new DatabaseService();

    global.attendanceBot = this;

    this.startSecurityMonitoring();

    this.initializeBot();
  }

  initializeBot() {
    this.client.on("qr", (qr) => {
      console.log("Scan the QR code below to authenticate.");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", async () => {
      console.log("WhatsApp attendance bot is ready!");
      console.log(`Bot Number: ${this.client.info.wid.user}`);

      await this.databaseService.connect();
      await this.schedulerService.initialize();
      this.schedulerService.setWhatsAppClient(this.client);

      console.log("Bot is now fully operational!");
    });

    this.client.on("message", async (message) => {
      const startTime = Date.now();
      let userId = null;

      try {
        if (message.from.includes("@g.us")) {
          this.logger.debug("Ignored group message", { from: message.from });
          return;
        }

        userId = message.from.replace("@c.us", "");

        const messageValidation =
          this.inputValidator.validateWhatsAppMessage(message);
        if (!messageValidation.isValid) {
          this.logger.security("INVALID_MESSAGE_STRUCTURE", {
            userId,
            error: messageValidation.error,
          });
          return;
        }

        // Attach sanitized body to the original message object
        message.sanitizedBody = messageValidation.sanitized.body;

        const blockStatus = this.securityManager.isUserBlocked(userId);
        if (blockStatus.isBlocked) {
          this.logger.security("BLOCKED_USER_ATTEMPT", {
            userId,
            reason: blockStatus.reason,
            remainingTime: blockStatus.remainingTime,
          });

          if (blockStatus.remainingTime > 60000) {
            await this.client.sendMessage(
              message.from,
              `🚫 Your account is temporarily blocked.\n` +
                `Reason: ${blockStatus.reason}\n` +
                `Try again in ${Math.ceil(
                  blockStatus.remainingTime / 60000
                )} minutes.`
            );
          }
          return;
        }

        if (message.sanitizedBody.startsWith("/")) {
          await this.commandHandler.handleCommand(message);
        } else {
          await this.messageHandler.handleMessage(message);
        }

        const duration = Date.now() - startTime;
        const messageType = message.hasMedia
          ? "media"
          : message.body?.startsWith("/")
          ? "command"
          : "message";
        const messageLength = message.sanitizedBody?.length || 0;

        this.logger.performance("MESSAGE_PROCESSING", duration, {
          userId,
          messageType,
          messageLength,
        });
      } catch (error) {
        const duration = Date.now() - startTime;

        const errorResult = await this.errorHandler.handleError(error, {
          operation: "MESSAGE_PROCESSING",
          userId,
          messageBody: message?.body?.substring(0, 100),
          duration,
        });

        this.logger.error("Message handling error", error, {
          userId,
          operation: "MESSAGE_PROCESSING",
          handled: errorResult.handled,
          recovery: errorResult.recovery,
        });

        if (message && message.from) {
          try {
            const userMessage = errorResult.recovery?.success
              ? "Processing your request, please wait..."
              : this.errorHandler.getUserFriendlyMessage(
                  errorResult.errorInfo || {}
                );

            await this.client.sendMessage(message.from, userMessage);
          } catch (replyError) {
            this.logger.error("Failed to send error reply", replyError, {
              userId,
            });
          }
        }
      }
    });

    this.client.on("authenticated", () => {
      console.log("Authentication successful.");
    });

    this.client.on("auth_failure", (msg) => {
      console.error("Authentication failed.", msg);
    });

    this.client.on("disconnected", (reason) => {
      console.log("WhatsApp client disconnected.", reason);
    });

    this.client.initialize();
  }

  startSecurityMonitoring() {
    setInterval(async () => {
      try {
        const securityReport = this.securityManager.generateSecurityReport();
        const rateLimiterStats = this.rateLimiter.getStats();
        const errorStats = this.errorHandler.getErrorStats();

        this.logger.info("Security metrics collected", {
          type: "security_metrics",
          security: securityReport,
          rateLimit: rateLimiterStats,
          errors: errorStats,
        });

        if (securityReport?.securityMetrics?.threatLevel >= 3) {
          this.logger.critical("High threat level detected", {
            threatLevel: securityReport.securityMetrics.threatLevel,
            report: securityReport,
          });
        }
      } catch (error) {
        this.logger.error("Error collecting security metrics", error);
      }
    }, 5 * 60 * 1000);

    setInterval(async () => {
      try {
        const health = await this.performHealthCheck();
        this.logger.info("Health check completed", { health });

        if (!health.overall) {
          this.logger.warn("System health check failed", { health });
        }
      } catch (error) {
        this.logger.error("Health check error", error);
      }
    }, 10 * 60 * 1000);

    setInterval(() => {
      try {
        if (this.messageHandler) {
          this.messageHandler.cleanupExpiredConfirmations();
        }
      } catch (error) {
        this.logger.error("Error cleaning up expired states", error);
      }
    }, 2 * 60 * 1000);
  }

  async performHealthCheck() {
    try {
      const health = {
        timestamp: Date.now(),
        database: await this.databaseService.healthCheck(),
        logger: await this.logger.healthCheck(),
        whatsapp: {
          status: this.client.info ? "connected" : "disconnected",
          info: this.client.info,
        },
        security: {
          activeSessions: this.securityManager.activeSessions.size,
          blockedUsers: this.securityManager.blockedUsers.size,
          threatLevel: this.securityManager.calculateOverallThreatLevel(),
        },
        rateLimit: this.rateLimiter.getStats(),
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        messageHandler: {
          activeStates: this.messageHandler
            ? this.messageHandler.userStates.size
            : 0,
        },
      };

      health.overall =
        health.database.status === "healthy" &&
        health.logger.status === "healthy" &&
        health.whatsapp.status === "connected";

      return health;
    } catch (error) {
      this.logger.error("Health check failed", error);
      return {
        overall: false,
        error: error.message,
      };
    }
  }

  async stop() {
    console.log("🛑 Stopping bot...");
    this.schedulerService.stop();
    await this.client.destroy();
    await this.databaseService.disconnect();
    process.exit(0);
  }
}

process.on("SIGINT", async () => {
  console.log("\n🛑 Received SIGINT. Shutting down gracefully...");
  if (global.attendanceBot) {
    await global.attendanceBot.stop();
  }
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Received SIGTERM. Shutting down gracefully...");
  if (global.attendanceBot) {
    await global.attendanceBot.stop();
  }
});

console.log("Starting WhatsApp Attendance Bot...");
global.attendanceBot = new AttendanceBot();
