const crypto = require("crypto");
const moment = require("moment");

class SecurityManager {
  constructor() {
    this.activeSessions = new Map();
    this.blockedUsers = new Map();
    this.auditLog = [];
    this.encryptionKey = this.generateEncryptionKey();
    this.maxAuditLogSize = 10000;
    this.sessionTimeout = 24 * 60 * 60 * 1000;

    this.securityConfig = {
      maxFailedAttempts: 5,
      blockDuration: 30 * 60 * 1000,
      sessionRotationInterval: 4 * 60 * 60 * 1000,
      auditRetentionDays: 30,
    };

    this.threatLevels = {
      LOW: 1,
      MEDIUM: 2,
      HIGH: 3,
      CRITICAL: 4,
    };

    this.startSecurityTasks();
  }

  // generate encryption key if not there
  generateEncryptionKey() {
    return process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString("hex");
  }

  // Create a session for user
  createSession(userId, additionalData = {}) {
    try {
      const sessionId = crypto.randomUUID();
      const session = {
        id: sessionId,
        userId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        ipAddress: additionalData.ipAddress || "unknown",
        userAgent: additionalData.userAgent || "whatsapp-bot",
        isActive: true,
        rotationCount: 0,
        securityFlags: {
          isVerified: false,
          isSuspicious: false,
          threatLevel: this.threatLevels.LOW,
        },
      };

      this.activeSessions.set(sessionId, session);
      this.auditLog.push({
        timestamp: Date.now(),
        userId,
        action: "SESSION_CREATED",
        sessionId,
        details: additionalData,
      });

      console.log(`🔐 Session created for user ${userId}: ${sessionId}`);
      return sessionId;
    } catch (error) {
      console.error("Error creating session:", error);
      throw new Error("Failed to create secure session");
    }
  }

  // Validate and update session
  validateSession(sessionId, userId) {
    try {
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        this.logSecurityEvent(userId, "INVALID_SESSION_ACCESS", { sessionId });
        return { isValid: false, reason: "Session not found" };
      }

      if (session.userId !== userId) {
        this.logSecurityEvent(userId, "SESSION_HIJACK_ATTEMPT", {
          sessionId,
          actualUser: session.userId,
        });
        return { isValid: false, reason: "Session mismatch" };
      }

      if (!session.isActive) {
        this.logSecurityEvent(userId, "INACTIVE_SESSION_ACCESS", { sessionId });
        return { isValid: false, reason: "Session inactive" };
      }

      const now = Date.now();
      if (now - session.createdAt > this.sessionTimeout) {
        this.expireSession(sessionId, "timeout");
        return { isValid: false, reason: "Session expired" };
      }

      // Update last activity
      session.lastActivity = now;
      this.activeSessions.set(sessionId, session);

      return { isValid: true, session };
    } catch (error) {
      console.error("Session validation error:", error);
      return { isValid: false, reason: "Validation failed" };
    }
  }

  // expire a session
  expireSession(sessionId, reason = "manual") {
    try {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.isActive = false;
        session.expiredAt = Date.now();
        session.expireReason = reason;

        this.logSecurityEvent(session.userId, "SESSION_EXPIRED", {
          sessionId,
          reason,
        });
        this.activeSessions.delete(sessionId);

        console.log(`🔒 Session expired: ${sessionId} (${reason})`);
      }
    } catch (error) {
      console.error("Error expiring session:", error);
    }
  }

  // check if user is blocked
  isUserBlocked(userId) {
    try {
      const blockInfo = this.blockedUsers.get(userId);

      if (!blockInfo) return { isBlocked: false };

      const now = Date.now();
      if (now > blockInfo.blockedUntil) {
        this.unblockUser(userId, "timeout");
        return { isBlocked: false };
      }

      return {
        isBlocked: true,
        reason: blockInfo.reason,
        blockedUntil: blockInfo.blockedUntil,
        remainingTime: blockInfo.blockedUntil - now,
      };
    } catch (error) {
      console.error("Error checking user block status:", error);
      return { isBlocked: false };
    }
  }

  // block a user temporarily
  blockUser(userId, reason, duration = null) {
    try {
      const blockDuration = duration || this.securityConfig.blockDuration;
      const blockedUntil = Date.now() + blockDuration;

      const blockInfo = {
        reason,
        blockedAt: Date.now(),
        blockedUntil,
        blockCount: (this.blockedUsers.get(userId)?.blockCount || 0) + 1,
      };

      this.blockedUsers.set(userId, blockInfo);
      this.logSecurityEvent(userId, "USER_BLOCKED", {
        reason,
        duration: blockDuration,
      });

      console.warn(
        `🚫 User blocked: ${userId} for ${reason} (${blockDuration}ms)`
      );

      return blockInfo;
    } catch (error) {
      console.error("Error blocking user:", error);
      throw new Error("Failed to block user");
    }
  }

  // unblock a user
  unblockUser(userId, reason = "manual") {
    try {
      const blockInfo = this.blockedUsers.get(userId);
      if (blockInfo) {
        this.blockedUsers.delete(userId);
        this.logSecurityEvent(userId, "USER_UNBLOCKED", {
          reason,
          previousBlock: blockInfo,
        });
        console.log(`✅ User unblocked: ${userId} (${reason})`);
      }
    } catch (error) {
      console.error("Error unblocking user:", error);
    }
  }

  // log security events for audit trail
  logSecurityEvent(userId, action, details = {}) {
    try {
      const event = {
        timestamp: Date.now(),
        userId,
        action,
        details,
        severity: this.getActionSeverity(action),
        id: crypto.randomUUID(),
      };

      this.auditLog.push(event);

      // trim audit log if too large
      if (this.auditLog.length > this.maxAuditLogSize) {
        this.auditLog = this.auditLog.slice(-this.maxAuditLogSize);
      }

      // log high severity events
      if (event.severity >= this.threatLevels.HIGH) {
        console.warn(
          `🚨 Security Event [${event.severity}]: ${action} for user ${userId}`,
          details
        );
      }
    } catch (error) {
      console.error("Error logging security event:", error);
    }
  }

  // get severity level
  getActionSeverity(action) {
    const severityMap = {
      SESSION_CREATED: this.threatLevels.LOW,
      SESSION_EXPIRED: this.threatLevels.LOW,
      INVALID_SESSION_ACCESS: this.threatLevels.MEDIUM,
      SESSION_HIJACK_ATTEMPT: this.threatLevels.HIGH,
      RATE_LIMIT_EXCEEDED: this.threatLevels.MEDIUM,
      MALICIOUS_INPUT_DETECTED: this.threatLevels.HIGH,
      USER_BLOCKED: this.threatLevels.HIGH,
      BRUTE_FORCE_DETECTED: this.threatLevels.HIGH,
      SQL_INJECTION_ATTEMPT: this.threatLevels.CRITICAL,
      COMMAND_INJECTION_ATTEMPT: this.threatLevels.CRITICAL,
    };

    return severityMap[action] || this.threatLevels.LOW;
  }

  // encrypt sensitive data
  encrypt(data) {
    try {
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipher("aes-256-cbc", this.encryptionKey);

      let encrypted = cipher.update(JSON.stringify(data), "utf8", "hex");
      encrypted += cipher.final("hex");

      return {
        encrypted,
        iv: iv.toString("hex"),
        algorithm: "aes-256-cbc",
      };
    } catch (error) {
      console.error("Encryption error:", error);
      throw new Error("Failed to encrypt data");
    }
  }

  // decrypt sensi data
  decrypt(encryptedData) {
    try {
      const { encrypted, iv } = encryptedData;
      const decipher = crypto.createDecipher("aes-256-cbc", this.encryptionKey);

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return JSON.parse(decrypted);
    } catch (error) {
      console.error("Decryption error:", error);
      throw new Error("Failed to decrypt data");
    }
  }

  // detect potential
  analyzeSecurityThreats(userId, action, context = {}) {
    try {
      const threats = [];
      const recentEvents = this.getRecentEvents(userId, 5 * 60 * 1000);

      // check for rapid successive actions
      const actionCount = recentEvents.filter(
        (e) => e.action === action
      ).length;
      if (actionCount > 10) {
        threats.push({
          type: "RAPID_ACTIONS",
          severity: this.threatLevels.HIGH,
          details: { action, count: actionCount },
        });
      }

      // check for multiple failed attempts
      const failedEvents = recentEvents.filter(
        (e) => e.action.includes("FAILED") || e.action.includes("INVALID")
      );
      if (failedEvents.length > this.securityConfig.maxFailedAttempts) {
        threats.push({
          type: "MULTIPLE_FAILURES",
          severity: this.threatLevels.HIGH,
          details: { count: failedEvents.length },
        });
      }

      // check for session anomalies
      const sessionEvents = recentEvents.filter((e) =>
        e.action.includes("SESSION")
      );
      if (sessionEvents.length > 5) {
        threats.push({
          type: "SESSION_ANOMALY",
          severity: this.threatLevels.MEDIUM,
          details: { count: sessionEvents.length },
        });
      }

      return threats;
    } catch (error) {
      console.error("Threat analysis error:", error);
      return [];
    }
  }

  // get recent security events for user
  getRecentEvents(userId, timeWindow = 60000) {
    const cutoff = Date.now() - timeWindow;
    return this.auditLog.filter(
      (event) => event.userId === userId && event.timestamp >= cutoff
    );
  }

  // generate security report
  generateSecurityReport() {
    try {
      const now = Date.now();
      const last24h = now - 24 * 60 * 60 * 1000;

      const recentEvents = this.auditLog.filter((e) => e.timestamp >= last24h);
      const highSeverityEvents = recentEvents.filter(
        (e) => e.severity >= this.threatLevels.HIGH
      );

      const report = {
        timestamp: now,
        activeSessions: this.activeSessions.size,
        blockedUsers: this.blockedUsers.size,
        last24Hours: {
          totalEvents: recentEvents.length,
          highSeverityEvents: highSeverityEvents.length,
          topActions: this.getTopActions(recentEvents),
          topUsers: this.getTopUsers(recentEvents),
        },
        securityMetrics: {
          averageSessionDuration: this.calculateAverageSessionDuration(),
          blockRate: this.calculateBlockRate(),
          threatLevel: this.calculateOverallThreatLevel(),
        },
      };

      return report;
    } catch (error) {
      console.error("Error generating security report:", error);
      return null;
    }
  }

  // get top actions from events
  getTopActions(events) {
    const actionCounts = {};
    events.forEach((event) => {
      actionCounts[event.action] = (actionCounts[event.action] || 0) + 1;
    });

    return Object.entries(actionCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([action, count]) => ({ action, count }));
  }

  // get top users from events
  getTopUsers(events) {
    const userCounts = {};
    events.forEach((event) => {
      userCounts[event.userId] = (userCounts[event.userId] || 0) + 1;
    });

    return Object.entries(userCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));
  }

  // calculate metrics
  calculateAverageSessionDuration() {
    const sessions = Array.from(this.activeSessions.values());
    if (sessions.length === 0) return 0;

    const totalDuration = sessions.reduce((sum, session) => {
      return sum + (Date.now() - session.createdAt);
    }, 0);

    return Math.round(totalDuration / sessions.length);
  }

  calculateBlockRate() {
    const totalUsers = new Set(this.auditLog.map((e) => e.userId)).size;
    return totalUsers > 0 ? (this.blockedUsers.size / totalUsers) * 100 : 0;
  }

  calculateOverallThreatLevel() {
    const recentHighSeverity = this.auditLog
      .filter((e) => e.timestamp >= Date.now() - 60 * 60 * 1000) // Last hour
      .filter((e) => e.severity >= this.threatLevels.HIGH);

    if (recentHighSeverity.length > 10) return this.threatLevels.CRITICAL;
    if (recentHighSeverity.length > 5) return this.threatLevels.HIGH;
    if (recentHighSeverity.length > 2) return this.threatLevels.MEDIUM;
    return this.threatLevels.LOW;
  }

  // start bg security
  startSecurityTasks() {
    // session cleanup after 10 mins
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 10 * 60 * 1000);

    // security report every hr
    setInterval(() => {
      const report = this.generateSecurityReport();
      if (
        report &&
        report.securityMetrics.threatLevel >= this.threatLevels.HIGH
      ) {
        console.warn("🚨 High threat level detected:", report);
      }
    }, 60 * 60 * 1000);

    // audit log cleanup daily
    setInterval(() => {
      this.cleanupAuditLog();
    }, 24 * 60 * 60 * 1000);
  }

  // cleanup expired sessions
  cleanupExpiredSessions() {
    let cleanedCount = 0;
    const now = Date.now();

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (now - session.createdAt > this.sessionTimeout) {
        this.expireSession(sessionId, "cleanup");
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired sessions`);
    }
  }

  // cleanup old audit log entries
  cleanupAuditLog() {
    const cutoff =
      Date.now() - this.securityConfig.auditRetentionDays * 24 * 60 * 60 * 1000;
    const originalLength = this.auditLog.length;

    this.auditLog = this.auditLog.filter((event) => event.timestamp >= cutoff);

    const removedCount = originalLength - this.auditLog.length;
    if (removedCount > 0) {
      console.log(`🧹 Cleaned up ${removedCount} old audit log entries`);
    }
  }
}

module.exports = SecurityManager;
