const mongoose = require("mongoose");

const attendanceRecordSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      ref: "User",
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Subject",
    },
    date: {
      type: Date,
      required: true,
    },
    scheduledTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["present", "absent", "pending"],
      default: "pending",
    },
    responseTime: {
      type: Date,
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    confirmationSent: {
      type: Boolean,
      default: false,
    },
    autoMarked: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// instance methods
attendanceRecordSchema.methods.markPresent = function (
  responseTime = new Date()
) {
  this.status = "present";
  this.responseTime = responseTime;
  return this.save();
};

attendanceRecordSchema.methods.markAbsent = function (autoMarked = false) {
  this.status = "absent";
  this.autoMarked = autoMarked;
  if (autoMarked) {
    this.responseTime = new Date();
  }
  return this.save();
};

attendanceRecordSchema.methods.isOverdue = function (timeoutHours = 2) {
  if (this.status !== "pending") return false;

  const timeoutMs = timeoutHours * 60 * 60 * 1000;
  const confirmationTime = new Date(
    // 10 mins after class
    this.scheduledTime.getTime() + 10 * 60 * 1000
  );
  const deadline = new Date(confirmationTime.getTime() + timeoutMs);

  return new Date() > deadline;
};

// static methods
attendanceRecordSchema.statics.createForClass = function (
  userId,
  subjectId,
  scheduledTime
) {
  return new this({
    userId,
    subjectId,
    date: new Date(scheduledTime.toDateString()),
    scheduledTime,
  });
};

attendanceRecordSchema.statics.findPendingRecords = function () {
  return this.find({ status: "pending" }).populate("subjectId");
};

attendanceRecordSchema.statics.findOverdueRecords = function (
  timeoutHours = 2
) {
  const timeoutMs = timeoutHours * 60 * 60 * 1000;
  // account for 10-min delay
  const cutoffTime = new Date(Date.now() - timeoutMs - 10 * 60 * 1000);

  return this.find({
    status: "pending",
    scheduledTime: { $lt: cutoffTime },
  }).populate("subjectId");
};

attendanceRecordSchema.statics.getUserAttendanceStats = function (
  userId,
  subjectId = null
) {
  const match = { userId };
  if (subjectId) {
    match.subjectId = subjectId;
  }

  return this.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$subjectId",
        total: { $sum: 1 },
        present: {
          $sum: {
            $cond: [{ $eq: ["$status", "present"] }, 1, 0],
          },
        },
        absent: {
          $sum: {
            $cond: [{ $eq: ["$status", "absent"] }, 1, 0],
          },
        },
        pending: {
          $sum: {
            $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
          },
        },
      },
    },
    {
      $addFields: {
        attendancePercentage: {
          $round: [
            {
              $multiply: [
                {
                  $divide: ["$present", { $subtract: ["$total", "$pending"] }],
                },
                100,
              ],
            },
            2,
          ],
        },
      },
    },
  ]);
};

// compound indexes
attendanceRecordSchema.index({ userId: 1, subjectId: 1, date: -1 });
attendanceRecordSchema.index({ status: 1, scheduledTime: 1 });
attendanceRecordSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("AttendanceRecord", attendanceRecordSchema);
