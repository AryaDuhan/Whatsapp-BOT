const moment = require("moment");

class RateLimiter {
  constructor(options = {}) {
    this.limits = {
      commands: options.commandsPerMinute || 10,
      messages: options.messagesPerMinute || 20,
      registrations: options.registrationsPerHour || 5,
      subjects: options.subjectsPerHour || 20,
    };

    this.windows = {
      commands: options.commandWindow || 60,
      messages: options.messageWindow || 60,
      registrations: options.registrationWindow || 3600,
      subjects: options.subjectWindow || 3600,
    };

    // in mem store for rate limiting
    this.store = new Map();
    this.cleanup();
  }

  // check if user exceeded rate limit
  isRateLimited(userId, type = "messages") {
    try {
      if (!userId || !this.limits[type]) {
        return false;
      }

      const key = `${userId}:${type}`;
      const now = Date.now();

      // convert to milliseconds
      const window = this.windows[type] * 1000;
      const limit = this.limits[type];

      // get or create users request history
      let requests = this.store.get(key) || [];

      // remove old requests outside the window
      requests = requests.filter((timestamp) => now - timestamp < window);

      // check if limit exceeded
      if (requests.length >= limit) {
        console.warn(
          `⚠️ Rate limit exceeded for user ${userId} (${type}): ${requests.length}/${limit}`
        );
        return true;
      }

      // add current request
      requests.push(now);
      this.store.set(key, requests);

      return false;
    } catch (error) {
      console.error("Rate limiter error:", error);

      // fail open for safety
      return false;
    }
  }

  // get remaining requests for user
  getRemainingRequests(userId, type = "messages") {
    try {
      const key = `${userId}:${type}`;
      const now = Date.now();
      const window = this.windows[type] * 1000;
      const limit = this.limits[type];

      let requests = this.store.get(key) || [];
      requests = requests.filter((timestamp) => now - timestamp < window);

      return Math.max(0, limit - requests.length);
    } catch (error) {
      console.error("Error getting remaining requests:", error);

      // return full limit on error
      return this.limits[type];
    }
  }

  // get time until rate limit resets
  getResetTime(userId, type = "messages") {
    try {
      const key = `${userId}:${type}`;
      const requests = this.store.get(key) || [];

      if (requests.length === 0) return 0;

      const window = this.windows[type] * 1000;
      const oldestRequest = Math.min(...requests);
      const resetTime = oldestRequest + window - Date.now();

      return Math.max(0, Math.ceil(resetTime / 1000));
    } catch (error) {
      console.error("Error getting reset time:", error);
      return this.windows[type];
    }
  }

  // clear rate limit for a user (admin function)
  clearRateLimit(userId, type = null) {
    try {
      if (type) {
        const key = `${userId}:${type}`;
        this.store.delete(key);
      } else {
        // clear all rate limits for user
        for (const key of this.store.keys()) {
          if (key.startsWith(`${userId}:`)) {
            this.store.delete(key);
          }
        }
      }
      console.log(
        `🔄 Rate limit cleared for user ${userId}${type ? ` (${type})` : ""}`
      );
    } catch (error) {
      console.error("Error clearing rate limit:", error);
    }
  }

  // periodic cleanup of expired entries
  cleanup() {
    setInterval(() => {
      try {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [key, requests] of this.store.entries()) {
          const type = key.split(":")[1];
          const window = this.windows[type] * 1000;

          const validRequests = requests.filter(
            (timestamp) => now - timestamp < window
          );

          if (validRequests.length === 0) {
            this.store.delete(key);
            cleanedCount++;
          } else if (validRequests.length !== requests.length) {
            this.store.set(key, validRequests);
          }
        }

        if (cleanedCount > 0) {
          console.log(
            `🧹 Rate limiter cleanup: removed ${cleanedCount} expired entries`
          );
        }
      } catch (error) {
        console.error("Rate limiter cleanup error:", error);
      }
      // cleanup every minute
    }, 60000);
  }

  // get current statistics
  getStats() {
    const stats = {
      totalUsers: new Set(
        Array.from(this.store.keys()).map((key) => key.split(":")[0])
      ).size,
      totalEntries: this.store.size,
      limits: this.limits,
      windows: this.windows,
    };

    return stats;
  }

  // check for sus activity patterns
  detectSuspiciousActivity(userId) {
    try {
      const patterns = {
        rapidCommands: this.getRemainingRequests(userId, "commands") === 0,
        rapidMessages: this.getRemainingRequests(userId, "messages") === 0,
        rapidRegistrations:
          this.getRemainingRequests(userId, "registrations") === 0,
        rapidSubjects: this.getRemainingRequests(userId, "subjects") === 0,
      };

      const suspiciousCount = Object.values(patterns).filter(Boolean).length;

      if (suspiciousCount >= 2) {
        console.warn(
          `🚨 Suspicious activity detected for user ${userId}:`,
          patterns
        );
        return {
          isSuspicious: true,
          patterns,
          severity: suspiciousCount >= 3 ? "high" : "medium",
        };
      }

      return { isSuspicious: false, patterns };
    } catch (error) {
      console.error("Error detecting suspicious activity:", error);
      return { isSuspicious: false, patterns: {} };
    }
  }
}

module.exports = RateLimiter;
