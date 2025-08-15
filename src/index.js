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
    // logger 1st
    this.logger = getLogger();
    this.logger.info("🚀 Initializing WhatsApp Attendance Bot");

    // security middleware
    this.rateLimiter = new RateLimiter({
      commandsPerMinute: 10,
      messagesPerMinute: 20,
      registrationsPerHour: 5,
      subjectsPerHour: 20,
    });

    this.inputValidator = new InputValidator();
    this.securityManager = new SecurityManager();
    this.errorHandler = new ErrorHandler();

    // client with security config
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

    // handlers with security middleware
    this.schedulerService = new SchedulerService();
    this.messageHandler = new MessageHandler(this.client);
    this.commandHandler = new CommandHandler(
      this.client,
      this.schedulerService,
      this.messageHandler
    );
    this.databaseService = new DatabaseService();

    //globally accessible
    global.attendanceBot = this;

    this.startSecurityMonitoring();

    this.initializeBot();
  }

  initializeBot() {
    // QR code
    this.client.on("qr", (qr) => {
      console.log("Scan the QR code below to authenticate.");
      qrcode.generate(qr, { small: true });
    });

    // bot ready
    this.client.on("ready", async () => {
      console.log("WhatsApp attendance bot is ready!");
      console.log(`Bot Number: ${this.client.info.wid.user}`);

      // database connection
      await this.databaseService.connect();

      // scheduler service with whatsApp client
      await this.schedulerService.initialize();
      this.schedulerService.setWhatsAppClient(this.client);

      console.log("Bot is now fully operational!");
    });

    // handle incoming messages
    this.client.on("message", async (message) => {
      const startTime = Date.now();
      let userId = null;
      let sanitizedMessage; // Define sanitizedMessage in the outer scope

      try {
        // ignore group msgs
        if (message.from.includes("@g.us")) {
          this.logger.debug("Ignored group message", { from: message.from });
          return;
        }

        userId = message.from.replace("@c.us", "");

        // message structure validation
        const messageValidation =
          this.inputValidator.validateWhatsAppMessage(message);
        if (!messageValidation.isValid) {
          this.logger.security("INVALID_MESSAGE_STRUCTURE", {
            userId,
            error: messageValidation.error,
          });
          return;
        }

        // check if user is blocked
        const blockStatus = this.securityManager.isUserBlocked(userId);
        if (blockStatus.isBlocked) {
          this.logger.security("BLOCKED_USER_ATTEMPT", {
            userId,
            reason: blockStatus.reason,
            remainingTime: blockStatus.remainingTime,
          });

          if (blockStatus.remainingTime > 60000) {
            // only notify if > 1 minute remaining
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

        // handle media messages
        if (message.hasMedia) {
          // rate limiting for media messages
          if (this.rateLimiter.isRateLimited(userId, "media")) {
            this.logger.security("RATE_LIMIT_EXCEEDED", {
              userId,
              type: "media",
              remaining: this.rateLimiter.getRemainingRequests(userId, "media"),
            });

            const resetTime = this.rateLimiter.getResetTime(userId, "media");
            await this.client.sendMessage(
              message.from,
              `⏳ Rate limit exceeded. Please wait ${resetTime} seconds before sending more media.`
            );
            return;
          }

          // for media messages ensure body exists
          sanitizedMessage = {
            // Assign to the outer scope variable
            ...message,
            body: message.body || "",
          };

          // log media activity
          this.logger.userActivity(userId, "MEDIA", {
            messageLength: sanitizedMessage.body.length,
            mediaType: message.type || "unknown",
          });

          // process media message
          await this.messageHandler.handleMessage(
            sanitizedMessage,
            this.client
          );
        } else {
          // handle text messages
          const messageType = message.body.startsWith("/")
            ? "commands"
            : "messages";

          // rate limiting
          if (this.rateLimiter.isRateLimited(userId, messageType)) {
            this.logger.security("RATE_LIMIT_EXCEEDED", {
              userId,
              type: messageType,
              remaining: this.rateLimiter.getRemainingRequests(
                userId,
                messageType
              ),
            });

            const resetTime = this.rateLimiter.getResetTime(
              userId,
              messageType
            );
            await this.client.sendMessage(
              message.from,
              `⏳ Rate limit exceeded. Please wait ${resetTime} seconds before sending more ${messageType}.`
            );
            return;
          }

          // input validation for text messages
          const inputValidation = this.inputValidator.securityCheck(
            message.body,
            {
              type: "message",
              userId,
            }
          );

          if (!inputValidation.isSecure) {
            this.logger.security("MALICIOUS_INPUT_DETECTED", {
              userId,
              warnings: inputValidation.warnings,
              originalInput: message.body,
            });

            // block user
            this.securityManager.blockUser(
              userId,
              "Malicious input detected",
              30 * 60 * 1000
            );

            await this.client.sendMessage(
              message.from,
              "🚫 Your message contains invalid content. Your account has been temporarily restricted."
            );
            return;
          }

          // sanitized input
          sanitizedMessage = {
            // Assign to the outer scope variable
            ...message,
            body: inputValidation.sanitized,
          };

          // log user activity
          this.logger.userActivity(userId, messageType.toUpperCase(), {
            messageLength: sanitizedMessage.body.length,
            hasCommand: sanitizedMessage.body.startsWith("/"),
          });

          // process message
          if (sanitizedMessage.body.startsWith("/")) {
            await this.commandHandler.handleCommand(sanitizedMessage);
          } else {
            await this.messageHandler.handleMessage(
              sanitizedMessage,
              this.client
            );
          }
        }

        // performance logging
        const duration = Date.now() - startTime;
        const messageType = message.hasMedia
          ? "media"
          : message.body?.startsWith("/")
          ? "commands"
          : "messages";
        const messageLength = sanitizedMessage?.body?.length || 0;

        this.logger.performance("MESSAGE_PROCESSING", duration, {
          userId,
          messageType,
          messageLength,
        });
      } catch (error) {
        const duration = Date.now() - startTime;

        // handle error
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

        // send error message
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

    // authentication events
    this.client.on("authenticated", () => {
      console.log("Authentication successful.");
    });

    this.client.on("auth_failure", (msg) => {
      console.error("Authentication failed.", msg);
    });

    this.client.on("disconnected", (reason) => {
      console.log("WhatsApp client disconnected.", reason);
    });

    // init client
    this.client.initialize();
  }

  // health check
  startSecurityMonitoring() {
    // security metrics collection every 5 min
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

        // alert on high threat
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

    // health check every 10 minutes
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
  }

  // better health check
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
      };

      health.overall =
        health.database.status === "healthy" &&
        health.logger.status === "healthy" &&
        health.whatsapp.status === "connected";

      return health;
    } catch (error) {
      this.logger.error("Health check failed", error);
      return { overall: false, error: error.message };
    }
  }

  async stop() {
    console.log(" Stopping bot...");
    this.schedulerService.stop();
    await this.client.destroy();
    await this.databaseService.disconnect();
    process.exit(0);
  }
}

// handle shutdown
process.on("SIGINT", async () => {
  console.log("\n Received SIGINT. Shutting down gracefully...");
  if (global.attendanceBot) {
    await global.attendanceBot.stop();
  }
});

process.on("SIGTERM", async () => {
  console.log("\n Received SIGTERM. Shutting down gracefully...");
  if (global.attendanceBot) {
    await global.attendanceBot.stop();
  }
});

// start
console.log("Starting WhatsApp Attendance Bot...");
global.attendanceBot = new AttendanceBot();
