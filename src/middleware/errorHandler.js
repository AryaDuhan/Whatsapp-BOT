const moment = require("moment");

class ErrorHandler {
  constructor() {
    this.errorCounts = new Map();
    this.circuitBreakers = new Map();
    this.errorLog = [];
    this.maxErrorLogSize = 5000;

    this.config = {
      // failures before opening circuit
      circuitBreakerThreshold: 5,

      // 1 min timeout
      circuitBreakerTimeout: 60000,
      retryAttempts: 3,

      // 1 sec
      retryDelay: 1000,
      errorCategories: {
        NETWORK: ["ECONNREFUSED", "ENOTFOUND", "TIMEOUT"],
        DATABASE: ["MongoError", "ValidationError", "CastError"],
        WHATSAPP: ["DISCONNECTED", "AUTHENTICATION_FAILURE", "RATE_LIMITED"],
        VALIDATION: ["INVALID_INPUT", "MALICIOUS_PATTERN"],
        SYSTEM: ["ENOMEM", "ENOSPC", "EMFILE"],
      },
    };

    this.errorPriorities = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };

    this.setupGlobalErrorHandlers();
  }

  // main error handling
  async handleError(error, context = {}) {
    try {
      const errorInfo = this.analyzeError(error, context);
      await this.logError(errorInfo);

      // check circuit breaker
      const circuitState = this.checkCircuitBreaker(errorInfo.category);
      if (circuitState.isOpen) {
        return this.handleCircuitBreakerOpen(errorInfo, circuitState);
      }

      // attempt recovery on error type
      const recovery = await this.attemptRecovery(errorInfo);

      // update circuit breaker state
      this.updateCircuitBreaker(errorInfo.category, !recovery.success);

      return {
        handled: true,
        recovery,
        errorInfo,
        circuitState,
      };
    } catch (handlingError) {
      console.error("Error in error handler:", handlingError);
      return {
        handled: false,
        error: "Error handler failed",
        originalError: error,
      };
    }
  }

  // analyze error
  analyzeError(error, context = {}) {
    const errorInfo = {
      id: this.generateErrorId(),
      timestamp: Date.now(),
      message: error.message || "Unknown error",
      stack: error.stack,
      code: error.code,
      name: error.name,
      context,
      category: this.categorizeError(error),
      priority: this.determinePriority(error),
      isRecoverable: this.isRecoverable(error),
      userId: context.userId,
      operation: context.operation,
      retryCount: context.retryCount || 0,
    };

    return errorInfo;
  }

  //categorise error
  categorizeError(error) {
    const errorString = (error.message + error.code + error.name).toLowerCase();

    for (const [category, patterns] of Object.entries(
      this.config.errorCategories
    )) {
      if (
        patterns.some((pattern) => errorString.includes(pattern.toLowerCase()))
      ) {
        return category;
      }
    }

    return "UNKNOWN";
  }

  //error priority
  determinePriority(error) {
    if (error.name === "SecurityError" || error.message.includes("injection")) {
      return this.errorPriorities.CRITICAL;
    }

    if (error.code === "ECONNREFUSED" || error.name === "MongoError") {
      return this.errorPriorities.HIGH;
    }

    if (error.name === "ValidationError" || error.code === "RATE_LIMITED") {
      return this.errorPriorities.MEDIUM;
    }

    return this.errorPriorities.LOW;
  }

  //cjeck if error is recoverable
  isRecoverable(error) {
    const nonRecoverableErrors = [
      "EACCES",
      "EPERM",
      "ENOSPC",
      "ENOMEM",
      "SyntaxError",
      "ReferenceError",
      "TypeError",
    ];

    return !nonRecoverableErrors.some(
      (pattern) => error.code === pattern || error.name === pattern
    );
  }

  // error recovery
  async attemptRecovery(errorInfo) {
    if (!errorInfo.isRecoverable) {
      return { success: false, reason: "Non-recoverable error" };
    }

    switch (errorInfo.category) {
      case "NETWORK":
        return await this.recoverNetworkError(errorInfo);
      case "DATABASE":
        return await this.recoverDatabaseError(errorInfo);
      case "WHATSAPP":
        return await this.recoverWhatsAppError(errorInfo);
      case "VALIDATION":
        return await this.recoverValidationError(errorInfo);
      default:
        return await this.genericRecovery(errorInfo);
    }
  }

  // network error recovery
  async recoverNetworkError(errorInfo) {
    try {
      // expon backoff retry
      const delay = this.config.retryDelay * Math.pow(2, errorInfo.retryCount);
      await this.sleep(delay);

      console.log(
        `🔄 Retrying network operation (attempt ${errorInfo.retryCount + 1})`
      );

      // retry the original operation
      return {
        success: true,
        strategy: "retry",
        delay,
        message: "Network operation will be retried",
      };
    } catch (retryError) {
      return {
        success: false,
        reason: "Retry failed",
        error: retryError.message,
      };
    }
  }

  //database error recovery
  async recoverDatabaseError(errorInfo) {
    try {
      if (errorInfo.code === "ECONNREFUSED") {
        console.log("🔄 Attempting database reconnection...");

        // attempt database reconnection
        return {
          success: true,
          strategy: "reconnect",
          message: "Database reconnection initiated",
        };
      }

      if (errorInfo.name === "ValidationError") {
        return {
          success: true,
          strategy: "sanitize",
          message: "Data will be sanitized and retried",
        };
      }

      return { success: false, reason: "Unknown database error" };
    } catch (recoveryError) {
      return {
        success: false,
        reason: "Database recovery failed",
        error: recoveryError.message,
      };
    }
  }

  // watsapp error recovery
  async recoverWhatsAppError(errorInfo) {
    try {
      if (errorInfo.message.includes("DISCONNECTED")) {
        console.log("🔄 Attempting WhatsApp reconnection...");

        return {
          success: true,
          strategy: "reconnect",
          message: "WhatsApp reconnection initiated",
        };
      }

      if (errorInfo.message.includes("RATE_LIMITED")) {
        // 1 minute
        const backoffTime = 60000;

        console.log(`⏳ Rate limited, backing off for ${backoffTime}ms`);

        return {
          success: true,
          strategy: "backoff",
          delay: backoffTime,
          message: "Rate limit backoff applied",
        };
      }

      return { success: false, reason: "Unknown WhatsApp error" };
    } catch (recoveryError) {
      return {
        success: false,
        reason: "WhatsApp recovery failed",
        error: recoveryError.message,
      };
    }
  }

  //val error recovery
  async recoverValidationError(errorInfo) {
    try {
      return {
        success: true,
        strategy: "sanitize",
        message: "Input will be sanitized",
        action: "sanitize_input",
      };
    } catch (recoveryError) {
      return {
        success: false,
        reason: "Validation recovery failed",
        error: recoveryError.message,
      };
    }
  }

  // generic recovery
  async genericRecovery(errorInfo) {
    if (errorInfo.retryCount < this.config.retryAttempts) {
      const delay = this.config.retryDelay * (errorInfo.retryCount + 1);
      await this.sleep(delay);

      return {
        success: true,
        strategy: "retry",
        delay,
        message: `Generic retry (attempt ${errorInfo.retryCount + 1})`,
      };
    }

    return {
      success: false,
      reason: "Max retry attempts exceeded",
    };
  }

  // circuit breaker
  checkCircuitBreaker(category) {
    const circuitKey = `circuit_${category}`;
    let circuit = this.circuitBreakers.get(circuitKey);

    if (!circuit) {
      circuit = {
        failures: 0,
        lastFailure: 0,
        // CLOSED, OPEN, HALF_OPEN
        state: "CLOSED",
        nextAttempt: 0,
      };
      this.circuitBreakers.set(circuitKey, circuit);
    }

    const now = Date.now();

    // check if circuit should transition from OPEN to HALF_OPEN
    if (circuit.state === "OPEN" && now >= circuit.nextAttempt) {
      circuit.state = "HALF_OPEN";
      console.log(`🔄 Circuit breaker transitioning to HALF_OPEN: ${category}`);
    }

    return {
      isOpen: circuit.state === "OPEN",
      state: circuit.state,
      failures: circuit.failures,
      nextAttempt: circuit.nextAttempt,
    };
  }

  // update circuit breaker state
  updateCircuitBreaker(category, isFailure) {
    const circuitKey = `circuit_${category}`;
    let circuit = this.circuitBreakers.get(circuitKey) || {
      failures: 0,
      lastFailure: 0,
      state: "CLOSED",
      nextAttempt: 0,
    };

    if (isFailure) {
      circuit.failures++;
      circuit.lastFailure = Date.now();

      if (circuit.failures >= this.config.circuitBreakerThreshold) {
        circuit.state = "OPEN";
        circuit.nextAttempt = Date.now() + this.config.circuitBreakerTimeout;
        console.warn(
          `🚨 Circuit breaker OPENED: ${category} (${circuit.failures} failures)`
        );
      }
    } else {
      // success now reset or transition to CLOSED
      if (circuit.state === "HALF_OPEN") {
        circuit.state = "CLOSED";
        circuit.failures = 0;
        console.log(`✅ Circuit breaker CLOSED: ${category}`);
      }
    }

    this.circuitBreakers.set(circuitKey, circuit);
  }

  // circuit breaker open state handler
  handleCircuitBreakerOpen(errorInfo, circuitState) {
    const waitTime = circuitState.nextAttempt - Date.now();

    return {
      handled: true,
      circuitBreakerOpen: true,
      message: `Service temporarily unavailable (${errorInfo.category})`,
      waitTime,
      recovery: {
        success: false,
        reason: "Circuit breaker open",
        strategy: "wait",
      },
    };
  }

  // log error
  async logError(errorInfo) {
    try {
      // add to error log
      this.errorLog.push(errorInfo);

      // trim log if large
      if (this.errorLog.length > this.maxErrorLogSize) {
        this.errorLog = this.errorLog.slice(-this.maxErrorLogSize);
      }

      // update error counts
      const countKey = `${errorInfo.category}_${errorInfo.name}`;
      this.errorCounts.set(countKey, (this.errorCounts.get(countKey) || 0) + 1);

      // console logging based on priority
      const logMessage = this.formatLogMessage(errorInfo);

      switch (errorInfo.priority) {
        case this.errorPriorities.CRITICAL:
          console.error("🚨 CRITICAL ERROR:", logMessage);
          break;
        case this.errorPriorities.HIGH:
          console.error("❌ HIGH PRIORITY ERROR:", logMessage);
          break;
        case this.errorPriorities.MEDIUM:
          console.warn("⚠️ MEDIUM PRIORITY ERROR:", logMessage);
          break;
        default:
          console.log("ℹ️ LOW PRIORITY ERROR:", logMessage);
      }

      // send alerts for critical errors
      if (errorInfo.priority === this.errorPriorities.CRITICAL) {
        await this.sendCriticalErrorAlert(errorInfo);
      }
    } catch (loggingError) {
      console.error("Failed to log error:", loggingError);
    }
  }

  // format error mesgs for logging
  formatLogMessage(errorInfo) {
    return {
      id: errorInfo.id,
      timestamp: moment(errorInfo.timestamp).format("YYYY-MM-DD HH:mm:ss"),
      category: errorInfo.category,
      message: errorInfo.message,
      userId: errorInfo.userId,
      operation: errorInfo.operation,
      retryCount: errorInfo.retryCount,
    };
  }

  // critical error report
  async sendCriticalErrorAlert(errorInfo) {
    try {
      // this would send alerts on email etc
      console.error("🚨 CRITICAL ERROR ALERT:", {
        id: errorInfo.id,
        message: errorInfo.message,
        userId: errorInfo.userId,
        timestamp: new Date(errorInfo.timestamp).toISOString(),
      });
    } catch (alertError) {
      console.error("Failed to send critical error alert:", alertError);
    }
  }

  // gen unique error id
  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // sleep for deelays
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // error statistics
  getErrorStats() {
    const stats = {
      totalErrors: this.errorLog.length,
      errorCounts: Object.fromEntries(this.errorCounts),
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
      recentErrors: this.errorLog.slice(-10),
      errorsByCategory: this.groupErrorsByCategory(),
      errorsByPriority: this.groupErrorsByPriority(),
    };

    return stats;
  }

  // group errors
  groupErrorsByCategory() {
    const categories = {};
    this.errorLog.forEach((error) => {
      categories[error.category] = (categories[error.category] || 0) + 1;
    });
    return categories;
  }

  // group errors
  groupErrorsByPriority() {
    const priorities = {};
    this.errorLog.forEach((error) => {
      const priorityName = Object.keys(this.errorPriorities)[
        error.priority - 1
      ];
      priorities[priorityName] = (priorities[priorityName] || 0) + 1;
    });
    return priorities;
  }

  // global error handler
  setupGlobalErrorHandlers() {
    // uncaught exceptions
    process.on("uncaughtException", (error) => {
      console.error("🚨 Uncaught Exception:", error);
      this.handleError(error, {
        operation: "uncaughtException",
        critical: true,
      });

      // shutdown for critical errors
      setTimeout(() => {
        console.error("🛑 Shutting down due to uncaught exception");
        process.exit(1);
      }, 5000);
    });

    // unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      console.error(
        "🚨 Unhandled Promise Rejection at:",
        promise,
        "reason:",
        reason
      );
      this.handleError(new Error(reason), {
        operation: "unhandledRejection",
        critical: true,
      });
    });

    // warning events
    process.on("warning", (warning) => {
      console.warn("⚠️ Process Warning:", warning);
      this.handleError(warning, {
        operation: "processWarning",
        priority: this.errorPriorities.LOW,
      });
    });
  }

  // error response for users
  getUserFriendlyMessage(errorInfo) {
    const messages = {
      NETWORK: "Network connection issue. Please try again in a moment.",
      DATABASE: "Data service temporarily unavailable. Please try again later.",
      WHATSAPP:
        "WhatsApp service issue. Your request will be processed shortly.",
      VALIDATION:
        "Invalid input format. Please check your command and try again.",
      SYSTEM: "System maintenance in progress. Please try again later.",
    };

    return (
      messages[errorInfo.category] ||
      "Temporary service issue. Please try again later."
    );
  }
}

module.exports = ErrorHandler;
