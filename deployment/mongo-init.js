print("Initializing attendance_bot database...");

// switch to the attendance_bot db
db = db.getSiblingDB("attendance_bot");

// create collecs with initial ds
print("Creating collections...");

// user collecs
db.createCollection("users");
db.users.createIndex({ _id: 1 }, { unique: true });
db.users.createIndex({ isRegistered: 1 });

// subject collecs
db.createCollection("subjects");
db.subjects.createIndex({ userId: 1, subjectName: 1, isActive: 1 });
db.subjects.createIndex({ userId: 1, isActive: 1 });
db.subjects.createIndex({ "schedule.day": 1, "schedule.time": 1 });

// attendance records collec
db.createCollection("attendancerecords");
db.attendancerecords.createIndex({ userId: 1, subjectId: 1, date: -1 });
db.attendancerecords.createIndex({ status: 1, scheduledTime: 1 });
db.attendancerecords.createIndex({ userId: 1, status: 1 });

print("Database initialization completed successfully!");

// create a user for testing
/*
db.users.insertOne({
    "_id": "1234567890",
    "name": "Test User",
    "isRegistered": true,
    "timezone": "Asia/Kolkata",
    "registrationStep": "completed",
    "preferences": {
        "reminderEnabled": true,
        "lowAttendanceAlerts": true
    },
    "createdAt": new Date(),
    "updatedAt": new Date()
});

print('Sample user created for testing');
*/
