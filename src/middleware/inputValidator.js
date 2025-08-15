const validator = require("validator");
const DOMPurify = require("isomorphic-dompurify");

class InputValidator {
  constructor() {
    this.maxLengths = {
      name: 50,
      subject: 100,
      message: 1000,
      timezone: 50,
      command: 500,
    };

    this.patterns = {
      phoneNumber: /^\d{10,15}$/,
      time24h: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      time12h: /^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(am|pm)$/i,
      day: /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)$/i,
      duration: /^\d+(\.\d+)?$/,
      command: /^\/[a-zA-Z]+(\s.*)?$/,
    };

    this.forbiddenPatterns = [
      // script injection
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,

      // sql injection patterns
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION)\b)/gi,

      // injection patterns
      /(\$where|\$ne|\$in|\$regex|\$gt|\$lt)/gi,

      // command injection
      /(;|\||&|`|\$\(|\$\{)/g,

      // file system access
      /(\.\.\/|\.\.\\|\/etc\/|\/var\/|\/usr\/|\/bin\/)/gi,

      // executable extensions
      /\.(exe|bat|sh|cmd|scr|vbs|js|jar|msi|dll)$/gi,
    ];
  }

  // sanitize and validate data
  validateInput(input, type = "message", options = {}) {
    try {
      if (input === null || input === undefined) {
        return {
          isValid: false,
          error: "Input cannot be null or undefined",
          sanitized: "",
        };
      }

      // convert to string and basic sanitization
      let sanitized = String(input).trim();

      // check length limits
      if (this.maxLengths[type] && sanitized.length > this.maxLengths[type]) {
        return {
          isValid: false,
          error: `Input too long. Maximum ${this.maxLengths[type]} characters allowed.`,
          sanitized: sanitized.substring(0, this.maxLengths[type]),
        };
      }

      // check for forbidden patterns
      const maliciousPattern = this.forbiddenPatterns.find((pattern) =>
        pattern.test(sanitized)
      );
      if (maliciousPattern) {
        console.warn(`🚨 Malicious pattern detected in ${type}:`, sanitized);
        return {
          isValid: false,
          error: "Input contains forbidden patterns",
          sanitized: this.sanitizeString(sanitized),
        };
      }

      // type specific validation
      const typeValidation = this.validateByType(sanitized, type, options);
      if (!typeValidation.isValid) {
        return typeValidation;
      }

      // html sanitization for text field
      if (["name", "subject", "message"].includes(type)) {
        sanitized = DOMPurify.sanitize(sanitized, {
          ALLOWED_TAGS: [],
          ALLOWED_ATTR: [],
        });
      }

      // final sanitization
      sanitized = this.sanitizeString(sanitized);

      return {
        isValid: true,
        sanitized,
        originalLength: input.length,
        sanitizedLength: sanitized.length,
      };
    } catch (error) {
      console.error("Input validation error:", error);
      return {
        isValid: false,
        error: "Validation failed due to internal error",
        sanitized: "",
      };
    }
  }

  // type specific validation
  validateByType(input, type, options = {}) {
    switch (type) {
      case "name":
        return this.validateName(input);
      case "subject":
        return this.validateSubject(input);
      case "time":
        return this.validateTime(input);
      case "day":
        return this.validateDay(input);
      case "duration":
        return this.validateDuration(input);
      case "timezone":
        return this.validateTimezone(input);
      case "command":
        return this.validateCommand(input);
      case "phoneNumber":
        return this.validatePhoneNumber(input);
      case "message":
        return this.validateMessage(input);
      default:
        return { isValid: true, sanitized: input };
    }
  }

  validateName(name) {
    if (!name || name.length < 2) {
      return {
        isValid: false,
        error: "Name must be at least 2 characters long",
      };
    }

    if (!/^[a-zA-Z\s\u00C0-\u017F\u0900-\u097F]+$/.test(name)) {
      return {
        isValid: false,
        error: "Name can only contain letters and spaces",
      };
    }

    return { isValid: true, sanitized: name };
  }

  validateSubject(subject) {
    if (!subject || subject.length < 2) {
      return {
        isValid: false,
        error: "Subject name must be at least 2 characters long",
      };
    }

    if (!/^[a-zA-Z0-9\s\-\(\)\u00C0-\u017F\u0900-\u097F]+$/.test(subject)) {
      return {
        isValid: false,
        error: "Subject name contains invalid characters",
      };
    }

    return { isValid: true, sanitized: subject };
  }

  validateTime(time) {
    if (
      !this.patterns.time24h.test(time) &&
      !this.patterns.time12h.test(time)
    ) {
      return {
        isValid: false,
        error: "Invalid time format. Use HH:MM or HH:MM AM/PM",
      };
    }

    return { isValid: true, sanitized: time };
  }

  validateDay(day) {
    if (!this.patterns.day.test(day)) {
      return {
        isValid: false,
        error: "Invalid day. Use full day names or abbreviations",
      };
    }

    return { isValid: true, sanitized: day };
  }

  validateDuration(duration) {
    const num = parseFloat(duration);
    if (
      !this.patterns.duration.test(duration) ||
      isNaN(num) ||
      num <= 0 ||
      num > 24
    ) {
      return {
        isValid: false,
        error: "Duration must be a positive number up to 24 hours",
      };
    }

    return { isValid: true, sanitized: duration };
  }

  validateTimezone(timezone) {
    try {
      // check if timezone is valid using moment
      const moment = require("moment-timezone");
      if (!moment.tz.zone(timezone)) {
        return { isValid: false, error: "Invalid timezone" };
      }
      return { isValid: true, sanitized: timezone };
    } catch (error) {
      return { isValid: false, error: "Invalid timezone format" };
    }
  }

  validateCommand(command) {
    if (!this.patterns.command.test(command)) {
      return { isValid: false, error: "Invalid command format" };
    }

    // check for command injection
    if (/[;&|`$]/.test(command)) {
      return { isValid: false, error: "Command contains forbidden characters" };
    }

    return { isValid: true, sanitized: command };
  }

  validatePhoneNumber(phone) {
    const cleaned = phone.replace(/\D/g, "");
    if (!this.patterns.phoneNumber.test(cleaned)) {
      return { isValid: false, error: "Invalid phone number format" };
    }

    return { isValid: true, sanitized: cleaned };
  }

  validateMessage(message) {
    if (message.length > this.maxLengths.message) {
      return {
        isValid: false,
        error: `Message too long. Maximum ${this.maxLengths.message} characters allowed`,
      };
    }

    return { isValid: true, sanitized: message };
  }

  // sanitize string
  sanitizeString(input) {
    return (
      input
        // remove null bytes
        .replace(/\0/g, "")
        // remove zero width char
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        // normalize unicode
        .normalize("NFKC")
        // remove excessive whitespace
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  // validate whatsapp message structure
  validateWhatsAppMessage(message) {
    try {
      if (!message || typeof message !== "object") {
        return { isValid: false, error: "Invalid message object" };
      }

      // check for required from field
      if (!message.from) {
        return { isValid: false, error: "Missing required field: from" };
      }

      // validate sender id format
      const phoneValidation = this.validatePhoneNumber(
        message.from.replace("@c.us", "")
      );
      if (!phoneValidation.isValid) {
        return { isValid: false, error: "Invalid sender phone number" };
      }

      // handle media messages
      if (message.hasMedia) {
        if (message.body) {
          //validate if body exists
          const bodyValidation = this.validateInput(message.body, "message");
          if (!bodyValidation.isValid) {
            return bodyValidation;
          }
          return {
            isValid: true,
            sanitized: {
              ...message,
              body: bodyValidation.sanitized,
            },
          };
        } else {
          // media message without body is valid
          return {
            isValid: true,
            sanitized: {
              ...message,
              // ensure body field exists
              body: "",
            },
          };
        }
      }

      // for text mesgs body is required
      if (!message.body) {
        return { isValid: false, error: "Missing required field: body" };
      }

      // validate msgs body
      const bodyValidation = this.validateInput(message.body, "message");
      if (!bodyValidation.isValid) {
        return bodyValidation;
      }

      return {
        isValid: true,
        sanitized: {
          ...message,
          body: bodyValidation.sanitized,
        },
      };
    } catch (error) {
      console.error("WhatsApp message validation error:", error);
      return { isValid: false, error: "Message validation failed" };
    }
  }

  // validate database query param
  validateDatabaseQuery(query, allowedFields = []) {
    try {
      if (!query || typeof query !== "object") {
        return { isValid: false, error: "Invalid query object" };
      }

      const sanitizedQuery = {};

      for (const [key, value] of Object.entries(query)) {
        // check if field is allowed
        if (allowedFields.length > 0 && !allowedFields.includes(key)) {
          console.warn(`🚨 Unauthorized field in query: ${key}`);
          continue;
        }

        // prevent nosql injection
        if (typeof value === "object" && value !== null) {
          const hasInjection = Object.keys(value).some((k) =>
            k.startsWith("$")
          );
          if (hasInjection) {
            console.warn(`🚨 Potential NoSQL injection in field: ${key}`);
            continue;
          }
        }

        // sanitize string values
        if (typeof value === "string") {
          const validation = this.validateInput(value, "message");
          sanitizedQuery[key] = validation.sanitized;
        } else {
          sanitizedQuery[key] = value;
        }
      }

      return { isValid: true, sanitized: sanitizedQuery };
    } catch (error) {
      console.error("Database query validation error:", error);
      return { isValid: false, error: "Query validation failed" };
    }
  }

  // check for rate limiting bypass attempts
  detectBypassAttempts(input) {
    const bypassPatterns = [
      // unicode variations
      /[\u00A0\u180E\u2000-\u200A\u202F\u205F\u3000]/,
      // hidden characters
      /[\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180D]/,
      // rtl/ltr marks
      /[\u200E\u200F\u202A-\u202E]/,
    ];

    return bypassPatterns.some((pattern) => pattern.test(input));
  }

  // security check
  securityCheck(input, context = {}) {
    const checks = {
      validation: this.validateInput(input, context.type || "message"),
      bypassAttempt: this.detectBypassAttempts(input),
      suspiciousLength: input.length > (this.maxLengths[context.type] || 1000),
      encoding: this.checkEncoding(input),
    };

    const isSecure =
      checks.validation.isValid &&
      !checks.bypassAttempt &&
      !checks.suspiciousLength &&
      checks.encoding.isValid;

    return {
      isSecure,
      checks,
      sanitized: checks.validation.sanitized,
      warnings: this.generateWarnings(checks),
    };
  }

  checkEncoding(input) {
    try {
      // check for valid utf8
      const encoded = Buffer.from(input, "utf8");
      const decoded = encoded.toString("utf8");

      return {
        isValid: decoded === input,
        encoding: "utf8",
      };
    } catch (error) {
      return {
        isValid: false,
        encoding: "invalid",
        error: error.message,
      };
    }
  }

  generateWarnings(checks) {
    const warnings = [];

    if (!checks.validation.isValid) {
      warnings.push(`Validation failed: ${checks.validation.error}`);
    }

    if (checks.bypassAttempt) {
      warnings.push("Potential rate limiting bypass attempt detected");
    }

    if (checks.suspiciousLength) {
      warnings.push("Input length exceeds normal limits");
    }

    if (!checks.encoding.isValid) {
      warnings.push("Invalid character encoding detected");
    }

    return warnings;
  }
}

module.exports = InputValidator;
