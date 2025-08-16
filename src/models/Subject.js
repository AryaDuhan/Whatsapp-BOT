const mongoose = require("mongoose");
const moment = require("moment-timezone");

const subjectSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      ref: "User",
    },
    subjectName: {
      type: String,
      required: true,
      trim: true,
    },
    schedule: {
      day: {
        type: String,
        required: true,
        enum: [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday",
        ],
      },
      time: {
        type: String,
        required: true,
        match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
      },
      duration: {
        type: Number,
        required: true,
        min: 0.5,
        max: 8,
      },
    },
    totalClasses: {
      type: Number,
      default: 0,
      min: 0,
    },
    attendedClasses: {
      type: Number,
      default: 0,
      min: 0,
    },
    massBunkedClasses: {
      type: Number,
      default: 0,
      min: 0,
    },
    holidayClasses: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// --- Virtuals ---

subjectSchema.virtual("attendancePercentage").get(function () {
  const effectiveTotal = this.totalClasses;
  if (effectiveTotal <= 0) return 100;
  return Math.round((this.attendedClasses / effectiveTotal) * 100);
});

subjectSchema.virtual("attendancePercentageWithBunks").get(function () {
  const effectiveTotal = this.totalClasses - this.massBunkedClasses;
  if (effectiveTotal <= 0) return 100;
  return Math.round((this.attendedClasses / effectiveTotal) * 100);
});

subjectSchema.set("toJSON", { virtuals: true });
subjectSchema.set("toObject", { virtuals: true });

// --- Instance Methods ---

subjectSchema.methods.markAttendance = function (
  isPresent = true,
  isMassBunk = false,
  isHoliday = false
) {
  if (isHoliday) {
    this.holidayClasses += 1;
  } else {
    this.totalClasses += 1;
    if (isPresent) {
      this.attendedClasses += 1;
    }
    if (isMassBunk) {
      this.massBunkedClasses += 1;
    }
  }
  return this.save();
};

subjectSchema.methods.getAttendanceStatus = function () {
  const percentage = this.attendancePercentage;
  if (percentage >= 75) return "good";
  if (percentage >= 60) return "warning";
  return "critical";
};

subjectSchema.methods.getNextClassTime = function (timezone = "Asia/Kolkata") {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  const now = moment().tz(timezone);
  const targetDay = days.indexOf(this.schedule.day);
  const [hours, minutes] = this.schedule.time.split(":").map(Number);

  let nextClass = now
    .clone()
    .day(targetDay)
    .hour(hours)
    .minute(minutes)
    .second(0);

  if (nextClass.isSameOrBefore(now)) {
    nextClass.add(1, "week");
  }

  return nextClass;
};

// --- Static Methods ---

subjectSchema.statics.findByUserAndName = function (userId, subjectName) {
  return this.findOne({
    userId,
    subjectName: new RegExp(`^${subjectName}$`, "i"),
    isActive: true,
  });
};

subjectSchema.statics.findByUserAndNameAndDay = function (
  userId,
  subjectName,
  day
) {
  return this.findOne({
    userId,
    subjectName: new RegExp(`^${subjectName}$`, "i"),
    "schedule.day": day,
    isActive: true,
  });
};

subjectSchema.statics.findActiveByUser = function (userId) {
  return this.find({ userId, isActive: true }).sort({
    "schedule.day": 1,
    "schedule.time": 1,
  });
};

subjectSchema.statics.findActiveByUserAndDay = function (userId, day) {
  return this.find({ userId, isActive: true, "schedule.day": day }).sort({
    "schedule.time": 1,
  });
};

subjectSchema.statics.findLowAttendance = function (userId, threshold = 75) {
  return this.find({
    userId,
    isActive: true,
    totalClasses: { $gt: 0 },
  }).then((subjects) => {
    return subjects.filter(
      (subject) => subject.attendancePercentage < threshold
    );
  });
};

// --- Indexes ---
subjectSchema.index({ userId: 1, subjectName: 1, isActive: 1 });
subjectSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model("Subject", subjectSchema);
