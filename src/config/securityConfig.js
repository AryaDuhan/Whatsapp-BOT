const crypto = require("crypto");

class SecurityConfig {
  constructor() {
    this.environment = process.env.NODE_ENV || "development";
    this.loadConfiguration();
    this.validateConfiguration();
  }

  loadConfiguration() {
    this.config = {
      // rate limiting configuration
      rateLimiting: {
        enabled: process.env.RATE_LIMITING_ENABLED !== "false",
        windowMs: parseInt(process.env.RATE_WINDOW_MS) || 60000,
        maxRequests: {
          commands: parseInt(process.env.MAX_COMMANDS_PER_MINUTE) || 10,
          messages: parseInt(process.env.MAX_MESSAGES_PER_MINUTE) || 20,
          registrations: parseInt(process.env.MAX_REGISTRATIONS_PER_HOUR) || 5,
          subjects: parseInt(process.env.MAX_SUBJECTS_PER_HOUR) || 20,
        },
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
        keyGenerator: (userId, type) => `${userId}:${type}`,
      },

      // input validation configuration
      inputValidation: {
        enabled: process.env.INPUT_VALIDATION_ENABLED !== "false",
        maxLengths: {
          name: parseInt(process.env.MAX_NAME_LENGTH) || 50,
          subject: parseInt(process.env.MAX_SUBJECT_LENGTH) || 100,
          message: parseInt(process.env.MAX_MESSAGE_LENGTH) || 1000,
          timezone: parseInt(process.env.MAX_TIMEZONE_LENGTH) || 50,
          command: parseInt(process.env.MAX_COMMAND_LENGTH) || 500,
        },
        sanitizeHtml: true,
        removeNullBytes: true,
        normalizeUnicode: true,
        strictMode: this.environment === "production",
      },

      // session management
      session: {
        enabled: process.env.SESSION_MANAGEMENT_ENABLED !== "false",
        timeout:
          parseInt(process.env.SESSION_TIMEOUT_MS) || 24 * 60 * 60 * 1000,
        rotationInterval:
          parseInt(process.env.SESSION_ROTATION_MS) || 4 * 60 * 60 * 1000,
        maxSessions: parseInt(process.env.MAX_SESSIONS_PER_USER) || 3,
        cookieSettings: {
          secure: this.environment === "production",
          httpOnly: true,
          sameSite: "strict",
        },
      },

      // encryption settings
      encryption: {
        algorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
        keyLength: parseInt(process.env.ENCRYPTION_KEY_LENGTH) || 32,
        ivLength: parseInt(process.env.ENCRYPTION_IV_LENGTH) || 16,
        tagLength: parseInt(process.env.ENCRYPTION_TAG_LENGTH) || 16,
        key: process.env.ENCRYPTION_KEY || this.generateSecureKey(),
        saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
      },

      // user blocking and security measures
      userSecurity: {
        enabled: process.env.USER_SECURITY_ENABLED !== "false",
        maxFailedAttempts: parseInt(process.env.MAX_FAILED_ATTEMPTS) || 5,
        blockDuration:
          parseInt(process.env.BLOCK_DURATION_MS) || 30 * 60 * 1000, // 30 minutes
        escalationMultiplier: parseFloat(process.env.BLOCK_ESCALATION) || 2.0,
        maxBlockDuration:
          parseInt(process.env.MAX_BLOCK_DURATION_MS) || 24 * 60 * 60 * 1000, // 24 hours
        permanentBlockThreshold:
          parseInt(process.env.PERMANENT_BLOCK_THRESHOLD) || 10,
      },

      // audit logging
      audit: {
        enabled: process.env.AUDIT_LOGGING_ENABLED !== "false",
        logLevel: process.env.AUDIT_LOG_LEVEL || "info",
        retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS) || 90,
        encryptLogs: this.environment === "production",
        logSensitiveData: this.environment === "development",
        maxLogSize: process.env.MAX_LOG_SIZE || "100MB",
        maxLogFiles: parseInt(process.env.MAX_LOG_FILES) || 30,
      },

      // content security
      contentSecurity: {
        enabled: process.env.CONTENT_SECURITY_ENABLED !== "false",
        maxFileSize: parseInt(process.env.MAX_FILE_SIZE_MB) || 10,
        allowedFileTypes: (
          process.env.ALLOWED_FILE_TYPES || "jpg,jpeg,png,gif,pdf,doc,docx,txt"
        ).split(","),
        scanUploads: this.environment === "production",
        quarantineDirectory: process.env.QUARANTINE_DIR || "./quarantine",
        virusScanEnabled: process.env.VIRUS_SCAN_ENABLED === "true",
      },

      // network security
      network: {
        enabled: process.env.NETWORK_SECURITY_ENABLED !== "false",
        allowedOrigins: (process.env.ALLOWED_ORIGINS || "*").split(","),
        trustedProxies: (process.env.TRUSTED_PROXIES || "")
          .split(",")
          .filter(Boolean),
        maxRequestSize: process.env.MAX_REQUEST_SIZE || "10mb",
        enableCors: process.env.ENABLE_CORS !== "false",
        corsCredentials: process.env.CORS_CREDENTIALS === "true",
      },

      // database security
      database: {
        enabled: process.env.DB_SECURITY_ENABLED !== "false",
        connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
        queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 30000,
        maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 10,
        enableSSL: process.env.DB_SSL_ENABLED === "true",
        encryptBackups: this.environment === "production",
        sanitizeQueries: true,
        preventNoSQLInjection: true,
      },

      // error handling security
      errorHandling: {
        enabled: process.env.ERROR_HANDLING_ENABLED !== "false",
        exposeStackTrace: this.environment === "development",
        logErrors: true,
        sanitizeErrorMessages: this.environment === "production",
        maxErrorsPerMinute: parseInt(process.env.MAX_ERRORS_PER_MINUTE) || 100,
        circuitBreakerThreshold:
          parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD) || 10,
      },

      // monitoring and alerting
      monitoring: {
        enabled: process.env.MONITORING_ENABLED !== "false",
        metricsInterval: parseInt(process.env.METRICS_INTERVAL_MS) || 60000,
        healthCheckInterval:
          parseInt(process.env.HEALTH_CHECK_INTERVAL_MS) || 300000,
        alertThresholds: {
          cpuPercent: parseInt(process.env.CPU_ALERT_THRESHOLD) || 80,
          memoryMB: parseInt(process.env.MEMORY_ALERT_THRESHOLD) || 512,
          errorRate: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 0.05,
          responseTime: parseInt(process.env.RESPONSE_TIME_THRESHOLD) || 5000,
        },
        enablePrometheus: process.env.PROMETHEUS_ENABLED === "true",
        prometheusPort: parseInt(process.env.PROMETHEUS_PORT) || 9090,
      },

      // security headers
      headers: {
        enabled: process.env.SECURITY_HEADERS_ENABLED !== "false",
        hsts: {
          enabled: this.environment === "production",
          maxAge: parseInt(process.env.HSTS_MAX_AGE) || 31536000,
          includeSubDomains: true,
          preload: true,
        },
        contentSecurityPolicy: {
          enabled: true,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        },
        noSniff: true,
        frameOptions: "DENY",
        xssProtection: true,
        referrerPolicy: "strict-origin-when-cross-origin",
      },

      // api security
      api: {
        enabled: process.env.API_SECURITY_ENABLED !== "false",
        requireApiKey: this.environment === "production",
        apiKeyHeader: process.env.API_KEY_HEADER || "X-API-Key",
        apiKeyLength: parseInt(process.env.API_KEY_LENGTH) || 32,
        enableJWT: process.env.JWT_ENABLED === "true",
        jwtSecret: process.env.JWT_SECRET || this.generateSecureKey(),
        jwtExpiration: process.env.JWT_EXPIRATION || "24h",
        enableRefreshTokens: process.env.REFRESH_TOKENS_ENABLED === "true",
      },

      // backup and recovery
      backup: {
        enabled: process.env.BACKUP_ENABLED !== "false",
        encryptBackups: this.environment === "production",
        backupInterval:
          parseInt(process.env.BACKUP_INTERVAL_MS) || 24 * 60 * 60 * 1000, // 24 hours
        retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS) || 30,
        compressionLevel: parseInt(process.env.BACKUP_COMPRESSION_LEVEL) || 6,
        verifyBackups: true,
        offSiteBackup: this.environment === "production",
      },
    };

    // apply environment specific overrides
    this.applyEnvironmentOverrides();
  }

  applyEnvironmentOverrides() {
    if (this.environment === "development") {
      // development environment relaxed security for debugging
      this.config.rateLimiting.maxRequests.commands = 100;
      this.config.rateLimiting.maxRequests.messages = 200;
      this.config.userSecurity.maxFailedAttempts = 50;
      this.config.audit.logSensitiveData = true;
      this.config.errorHandling.exposeStackTrace = true;
      this.config.headers.hsts.enabled = false;
    } else if (this.environment === "testing") {
      // testing environment disabled security for faster tests
      this.config.rateLimiting.enabled = false;
      // faster bcrypt
      this.config.encryption.saltRounds = 4;
      this.config.audit.enabled = false;
      this.config.monitoring.enabled = false;
    } else if (this.environment === "production") {
      // production environment max security
      this.config.inputValidation.strictMode = true;
      this.config.userSecurity.blockDuration = 60 * 60 * 1000;
      this.config.audit.encryptLogs = true;
      this.config.errorHandling.sanitizeErrorMessages = true;
      this.config.backup.encryptBackups = true;
      this.config.contentSecurity.scanUploads = true;
      this.config.database.encryptBackups = true;
    }
  }

  validateConfiguration() {
    const errors = [];

    // validate required secrets
    if (!this.config.encryption.key || this.config.encryption.key.length < 32) {
      errors.push("Encryption key must be at least 32 characters long");
    }

    if (
      this.config.api.enableJWT &&
      (!this.config.api.jwtSecret || this.config.api.jwtSecret.length < 32)
    ) {
      errors.push("JWT secret must be at least 32 characters long");
    }

    // validate numeric configurations
    if (this.config.rateLimiting.windowMs < 1000) {
      errors.push("Rate limiting window must be at least 1000ms");
    }

    if (this.config.session.timeout < 60000) {
      errors.push("Session timeout must be at least 60000ms (1 minute)");
    }

    if (
      this.config.encryption.saltRounds < 4 ||
      this.config.encryption.saltRounds > 20
    ) {
      errors.push("Bcrypt salt rounds must be between 4 and 20");
    }

    // validate file size limits
    if (this.config.contentSecurity.maxFileSize > 100) {
      errors.push("Maximum file size should not exceed 100MB");
    }

    if (errors.length > 0) {
      throw new Error(
        `Security configuration validation failed:\n${errors.join("\n")}`
      );
    }

    console.log(
      `✅ Security configuration validated for ${this.environment} environment`
    );
  }

  generateSecureKey(length = 32) {
    return crypto.randomBytes(length).toString("hex");
  }

  generateApiKey() {
    return this.generateSecureKey(this.config.api.apiKeyLength);
  }

  isSecurityEnabled(feature) {
    const featurePath = feature.split(".");
    let config = this.config;

    for (const path of featurePath) {
      config = config[path];
      if (config === undefined) return false;
    }

    return config.enabled !== false;
  }

  getSecurityLevel() {
    let level = 0;

    if (this.config.rateLimiting.enabled) level += 1;
    if (this.config.inputValidation.enabled) level += 1;
    if (this.config.session.enabled) level += 1;
    if (this.config.userSecurity.enabled) level += 1;
    if (this.config.audit.enabled) level += 1;
    if (this.config.contentSecurity.enabled) level += 1;
    if (this.config.network.enabled) level += 1;
    if (this.config.database.enabled) level += 1;
    if (this.config.monitoring.enabled) level += 1;
    if (this.config.headers.enabled) level += 1;

    const maxLevel = 10;

    // return %
    return Math.round((level / maxLevel) * 100);
  }

  exportConfig() {
    // export non sensitive configuration for logging debugging
    const safeConfig = JSON.parse(JSON.stringify(this.config));

    // remove sensitive data
    delete safeConfig.encryption.key;
    delete safeConfig.api.jwtSecret;
    if (safeConfig.encryption.key) safeConfig.encryption.key = "[REDACTED]";
    if (safeConfig.api.jwtSecret) safeConfig.api.jwtSecret = "[REDACTED]";

    return safeConfig;
  }

  get(path) {
    const pathArray = path.split(".");
    let result = this.config;

    for (const key of pathArray) {
      result = result[key];
      if (result === undefined) return undefined;
    }

    return result;
  }

  set(path, value) {
    const pathArray = path.split(".");
    const lastKey = pathArray.pop();
    let current = this.config;

    for (const key of pathArray) {
      if (!current[key]) current[key] = {};
      current = current[key];
    }

    current[lastKey] = value;
    console.log(`🔧 Security config updated: ${path} = ${value}`);
  }

  reload() {
    console.log("🔄 Reloading security configuration...");
    this.loadConfiguration();
    this.validateConfiguration();
    console.log("✅ Security configuration reloaded");
  }
}

// singleton instance
let configInstance = null;

function getSecurityConfig() {
  if (!configInstance) {
    configInstance = new SecurityConfig();
  }
  return configInstance;
}

module.exports = { SecurityConfig, getSecurityConfig };
