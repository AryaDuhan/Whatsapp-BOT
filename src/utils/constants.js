const ATTENDANCE_THRESHOLDS = {
  LOW: 75,
  CRITICAL: 60,
  EXCELLENT: 90,
};

const TIME_CONSTANTS = {
  REMINDER_BEFORE_CLASS: 10,
  CONFIRMATION_AFTER_CLASS: 10,
  ABSENCE_TIMEOUT_HOURS: 2,
};

const MESSAGE_TEMPLATES = {
  WELCOME:
    "🎓 *Welcome to AttendanceBot!*\n\nI'll help you track your class attendance.",

  HELP: `🤖 *AttendanceBot Help*

📚 *Subject Management:*
• */add <subject> on <day> at <time> for <hours>*
• */edit <subject>* - Edit a subject's details
• */remove <subject>* - Remove a subject
• */list* - Show all your subjects

📊 *Attendance:*
• */show attendance* - View all attendance (includes mass bunks)
• */show attendancewithbunks* - View all attendance (excludes mass bunks)
• */show <subject>* - View specific subject attendance

⚙️ *Settings:*
• */timezone <timezone>* - Set your timezone
• */settings* - View/change preferences`,

  UNKNOWN_COMMAND:
    "❓ Unknown command.\n\nType */help* to see all available commands.",

  REGISTRATION_COMPLETE:
    "🎉 *Registration Complete!*\n\nWelcome to AttendanceBot!",

  LOW_ATTENDANCE_WARNING:
    "⚠️ *Low Attendance Warning!*\n\nYour attendance is below 75%.",
};

const ATTENDANCE_RESPONSES = {
  POSITIVE: [
    "yes",
    "y",
    "yeah",
    "yep",
    "yup",
    "present",
    "attended",
    "there",
    "came",
    "went",
    "हां",
    "जी",
    "उपस्थित",
    "आया",
    "गया",
    "था",
  ],
  NEGATIVE: [
    "no",
    "n",
    "nope",
    "nah",
    "absent",
    "missed",
    "not",
    "couldn't",
    "skip",
    "skipped",
    "नहीं",
    "ना",
    "अनुपस्थित",
    "नहीं आया",
    "छूटा",
    "नहीं गया",
  ],
  MASS_BUNK: ["mass bunk", "massbunk", "bunked"],
  HOLIDAY: ["holiday"],
};

const DAY_MAPPINGS = {
  mon: "Monday",
  monday: "Monday",
  tue: "Tuesday",
  tuesday: "Tuesday",
  tues: "Tuesday",
  wed: "Wednesday",
  wednesday: "Wednesday",
  thu: "Thursday",
  thursday: "Thursday",
  thurs: "Thursday",
  fri: "Friday",
  friday: "Friday",
  sat: "Saturday",
  saturday: "Saturday",
  sun: "Sunday",
  sunday: "Sunday",
};

const TIMEZONE_MAPPINGS = {
  india: "Asia/Kolkata",
  indian: "Asia/Kolkata",
  ist: "Asia/Kolkata",
  usa: "America/New_York",
  america: "America/New_York",
  us: "America/New_York",
  est: "America/New_York",
  pst: "America/Los_Angeles",
  uk: "Europe/London",
  britain: "Europe/London",
  london: "Europe/London",
  gmt: "Europe/London",
};

const ATTENDANCE_EMOJIS = {
  EXCELLENT: "🌟",
  GOOD: "✅",
  WARNING: "⚠️",
  CRITICAL: "❌",
};

const VALIDATION = {
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 50,
  SUBJECT_MIN_LENGTH: 2,
  SUBJECT_MAX_LENGTH: 100,
  MIN_CLASS_DURATION: 0.5,
  MAX_CLASS_DURATION: 8,
  MAX_SUBJECTS_PER_USER: 20,
};

module.exports = {
  ATTENDANCE_THRESHOLDS,
  TIME_CONSTANTS,
  MESSAGE_TEMPLATES,
  ATTENDANCE_RESPONSES,
  DAY_MAPPINGS,
  TIMEZONE_MAPPINGS,
  ATTENDANCE_EMOJIS,
  VALIDATION,
};
