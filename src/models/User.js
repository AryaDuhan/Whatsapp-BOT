const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    _id: {
      type: String, // watsapp user id (phone number)
      required: true,
    },
    name: {
      type: String,
      required: false, // allow null during registration
      trim: true,
    },
    isRegistered: {
      type: Boolean,
      default: false,
    },
    timezone: {
      type: String,
      default: "Asia/Kolkata",
    },
    registrationStep: {
      type: String,
      enum: ["name", "timezone", "completed"],
      default: "name",
    },
    preferences: {
      reminderEnabled: {
        type: Boolean,
        default: true,
      },
      lowAttendanceAlerts: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// instance methods
userSchema.methods.isFullyRegistered = function () {
  return (
    this.isRegistered && this.registrationStep === "completed" && this.name
  );
};

userSchema.methods.getDisplayName = function () {
  return this.name || `User ${this._id.substring(0, 4)}****`;
};

// static methods
userSchema.statics.findByWhatsAppId = function (whatsappId) {
  return this.findById(whatsappId);
};

userSchema.statics.createNewUser = function (whatsappId, name = null) {
  return new this({
    _id: whatsappId,
    name: name || null,
    // if name is provided, mark as registered
    isRegistered: !!name,
    registrationStep: name ? "timezone" : "name",
  });
};

userSchema.statics.deleteUserAndData = async function (userId) {
  if (process.env.NODE_ENV === "production") {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const Subject = mongoose.model("Subject");
      const AttendanceRecord = mongoose.model("AttendanceRecord");
      // delete all attendance records for the user
      await AttendanceRecord.deleteMany({ userId: userId }, { session });
      // delete all subjects for the user
      await Subject.deleteMany({ userId: userId }, { session });
      // delete the user
      const result = await this.deleteOne({ _id: userId }, { session });

      await session.commitTransaction();
      session.endSession();
      return result.deletedCount > 0;
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  } else {
    // Non transactional deletion for development
    const Subject = mongoose.model("Subject");
    const AttendanceRecord = mongoose.model("AttendanceRecord");
    await AttendanceRecord.deleteMany({ userId: userId });
    await Subject.deleteMany({ userId: userId });
    const result = await this.deleteOne({ _id: userId });
    return result.deletedCount > 0;
  }
};

module.exports = mongoose.model("User", userSchema);
