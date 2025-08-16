const moment = require("moment-timezone");
const {
  DAY_MAPPINGS,
  TIMEZONE_MAPPINGS,
  ATTENDANCE_EMOJIS,
  ATTENDANCE_THRESHOLDS,
} = require("./constants");

class Helpers {
  static capitalizeWords(str) {
    return str.replace(
      /\b\w+/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
  }

  static normalizeDayName(day) {
    const normalized = DAY_MAPPINGS[day.toLowerCase()];
    return normalized || this.capitalizeWords(day);
  }

  static normalizeTimezone(timezone) {
    const mapped = TIMEZONE_MAPPINGS[timezone.toLowerCase()];
    return mapped || timezone;
  }

  static normalizeTime(timeStr) {
    try {
      timeStr = timeStr.replace(/\s/g, "");

      if (timeStr.match(/[ap]m/i)) {
        const isPM = /pm/i.test(timeStr);
        timeStr = timeStr.replace(/[ap]m/i, "");

        let [hours, minutes = "00"] = timeStr.split(":");
        hours = parseInt(hours);
        minutes = parseInt(minutes);

        if (isPM && hours !== 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        return `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}`;
      }

      if (timeStr.includes(":")) {
        const [hours, minutes] = timeStr.split(":");
        return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
      }

      const hours = parseInt(timeStr);
      if (hours >= 0 && hours <= 23) {
        return `${hours.toString().padStart(2, "0")}:00`;
      }

      throw new Error("Invalid time format");
    } catch (error) {
      console.error("Error normalizing time:", error);
      return null;
    }
  }

  static getAttendanceEmoji(percentage) {
    if (percentage >= ATTENDANCE_THRESHOLDS.LOW) return ATTENDANCE_EMOJIS.GOOD;
    return ATTENDANCE_EMOJIS.CRITICAL;
  }

  static getAttendanceStatus(percentage) {
    if (percentage >= ATTENDANCE_THRESHOLDS.LOW) return "Good";
    return "Critical";
  }

  static calculateClassesNeeded(attended, total, targetPercentage) {
    if (total === 0) return 0;

    const currentPercentage = (attended / total) * 100;
    if (currentPercentage >= targetPercentage) return 0;

    const numerator = targetPercentage * total - 100 * attended;
    const denominator = 100 - targetPercentage;

    return Math.max(0, Math.ceil(numerator / denominator));
  }

  static calculateBreakeven(attended, total, targetPercentage) {
    const currentPercentage = total > 0 ? (attended / total) * 100 : 100;

    if (currentPercentage > targetPercentage) {
      // User is above the target, calculate how many classes they can miss
      const classesToMiss = Math.floor(
        (100 * attended - targetPercentage * total) / targetPercentage
      );
      return { type: "surplus", classes: classesToMiss };
    } else if (currentPercentage < targetPercentage) {
      // User is below the target, calculate how many classes they need to attend
      const classesToAttend = Math.ceil(
        (targetPercentage * total - 100 * attended) / (100 - targetPercentage)
      );
      return { type: "deficit", classes: classesToAttend };
    } else {
      // User is exactly at the target
      return { type: "even", classes: 0 };
    }
  }

  static isValidTimezone(timezone) {
    try {
      moment.tz.zone(timezone);
      return true;
    } catch {
      return false;
    }
  }

  static isValidTime(timeStr) {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(timeStr);
  }

  static isValidDay(day) {
    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    return validDays.includes(this.normalizeDayName(day));
  }

  static formatDate(date, timezone = "UTC", format = "dddd, MMM Do YYYY") {
    return moment(date).tz(timezone).format(format);
  }

  static formatTime(time, timezone = "UTC", format = "h:mm A") {
    return moment(time).tz(timezone).format(format);
  }
}

module.exports = Helpers;
