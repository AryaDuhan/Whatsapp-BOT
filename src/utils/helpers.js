const moment = require('moment-timezone');
const { DAY_MAPPINGS, TIMEZONE_MAPPINGS, ATTENDANCE_EMOJIS, ATTENDANCE_THRESHOLDS } = require('./constants');

class Helpers {
    /**
     * Capitalize the first letter of each word
     */
    static capitalizeWords(str) {
        return str.replace(/\b\w+/g, word => 
            word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        );
    }

    /**
     * Normalize day name to full day name
     */
    static normalizeDayName(day) {
        const normalized = DAY_MAPPINGS[day.toLowerCase()];
        return normalized || this.capitalizeWords(day);
    }

    /**
     * Normalize timezone string
     */
    static normalizeTimezone(timezone) {
        const mapped = TIMEZONE_MAPPINGS[timezone.toLowerCase()];
        return mapped || timezone;
    }

    /**
     * Convert time string to 24-hour format
     */
    static normalizeTime(timeStr) {
        try {
            // Remove any spaces
            timeStr = timeStr.replace(/\s/g, '');
            
            // Handle 12-hour format
            if (timeStr.match(/[ap]m/i)) {
                const isPM = /pm/i.test(timeStr);
                timeStr = timeStr.replace(/[ap]m/i, '');
                
                let [hours, minutes = '00'] = timeStr.split(':');
                hours = parseInt(hours);
                minutes = parseInt(minutes);
                
                if (isPM && hours !== 12) hours += 12;
                if (!isPM && hours === 12) hours = 0;
                
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
            
            // Handle 24-hour format
            if (timeStr.includes(':')) {
                const [hours, minutes] = timeStr.split(':');
                return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
            }
            
            // Handle single number (assume it's hours)
            const hours = parseInt(timeStr);
            if (hours >= 0 && hours <= 23) {
                return `${hours.toString().padStart(2, '0')}:00`;
            }
            
            throw new Error('Invalid time format');
        } catch (error) {
            console.error('Error normalizing time:', error);
            return null;
        }
    }

    /**
     * Get appropriate emoji for attendance percentage
     */
    static getAttendanceEmoji(percentage) {
        if (percentage >= ATTENDANCE_THRESHOLDS.EXCELLENT) return ATTENDANCE_EMOJIS.EXCELLENT;
        if (percentage >= ATTENDANCE_THRESHOLDS.LOW) return ATTENDANCE_EMOJIS.GOOD;
        if (percentage >= ATTENDANCE_THRESHOLDS.CRITICAL) return ATTENDANCE_EMOJIS.WARNING;
        return ATTENDANCE_EMOJIS.CRITICAL;
    }

    /**
     * Get attendance status description
     */
    static getAttendanceStatus(percentage) {
        if (percentage >= ATTENDANCE_THRESHOLDS.EXCELLENT) return 'Excellent';
        if (percentage >= ATTENDANCE_THRESHOLDS.LOW) return 'Good';
        if (percentage >= ATTENDANCE_THRESHOLDS.CRITICAL) return 'Warning';
        return 'Critical';
    }

    /**
     * Calculate how many classes needed to reach target percentage
     */
    static calculateClassesNeeded(attended, total, targetPercentage) {
        if (total === 0) return 0;
        
        const currentPercentage = (attended / total) * 100;
        if (currentPercentage >= targetPercentage) return 0;
        
        // Formula: (attended + x) / (total + x) >= target/100
        // Solving for x: x >= (target * total - 100 * attended) / (100 - target)
        const numerator = targetPercentage * total - 100 * attended;
        const denominator = 100 - targetPercentage;
        
        return Math.max(0, Math.ceil(numerator / denominator));
    }

    /**
     * Validate timezone string
     */
    static isValidTimezone(timezone) {
        try {
            moment.tz.zone(timezone);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate time format (HH:MM)
     */
    static isValidTime(timeStr) {
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        return timeRegex.test(timeStr);
    }

    /**
     * Validate day name
     */
    static isValidDay(day) {
        const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        return validDays.includes(this.normalizeDayName(day));
    }

    /**
     * Format date for display
     */
    static formatDate(date, timezone = 'UTC', format = 'dddd, MMM Do YYYY') {
        return moment(date).tz(timezone).format(format);
    }

    /**
     * Format time for display
     */
    static formatTime(time, timezone = 'UTC', format = 'h:mm A') {
        return moment(time).tz(timezone).format(format);
    }

    /**
     * Get next occurrence of a day and time
     */
    static getNextClassTime(day, time, timezone = 'UTC') {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const targetDay = days.indexOf(day);
        
        if (targetDay === -1) {
            throw new Error('Invalid day');
        }

        const [hours, minutes] = time.split(':').map(Number);
        const now = moment().tz(timezone);
        
        let nextClass = now.clone().day(targetDay).hour(hours).minute(minutes).second(0);
        
        // If the class time has passed today, schedule for next week
        if (nextClass.isSameOrBefore(now)) {
            nextClass.add(1, 'week');
        }
        
        return nextClass;
    }

    /**
     * Check if two times are within a certain range (in minutes)
     */
    static isWithinTimeRange(time1, time2, rangeMinutes = 1) {
        const diff = Math.abs(moment(time1).diff(moment(time2), 'minutes'));
        return diff <= rangeMinutes;
    }

    /**
     * Sanitize input string
     */
    static sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        return input.trim().replace(/[^\w\s-]/gi, '');
    }

    /**
     * Generate user-friendly error messages
     */
    static getErrorMessage(error) {
        const errorMessages = {
            'INVALID_TIMEZONE': 'Invalid timezone. Please use a valid timezone like Asia/Kolkata or America/New_York.',
            'INVALID_TIME': 'Invalid time format. Please use HH:MM format (e.g., 14:30 or 2:30pm).',
            'INVALID_DAY': 'Invalid day. Please use full day names like Monday, Tuesday, etc.',
            'INVALID_DURATION': 'Invalid duration. Please specify duration in hours (e.g., 1, 1.5, 2).',
            'SUBJECT_EXISTS': 'A subject with this name already exists.',
            'SUBJECT_NOT_FOUND': 'Subject not found.',
            'USER_NOT_REGISTERED': 'You need to register first. Type /start to begin.',
            'DATABASE_ERROR': 'Database error occurred. Please try again later.',
            'PARSING_ERROR': 'Could not understand the command format. Please check the syntax.'
        };

        return errorMessages[error] || 'An unexpected error occurred. Please try again.';
    }

    /**
     * Log activity with timestamp and user info
     */
    static logActivity(userId, action, details = '') {
        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
        console.log(`[${timestamp}] User ${userId}: ${action} ${details}`);
    }

    /**
     * Parse duration string to number
     */
    static parseDuration(durationStr) {
        try {
            // Remove common words and extract number
            const cleaned = durationStr.toLowerCase()
                .replace(/hours?|hrs?|h/g, '')
                .trim();
            
            const duration = parseFloat(cleaned);
            
            if (isNaN(duration) || duration <= 0 || duration > 8) {
                return null;
            }
            
            return duration;
        } catch {
            return null;
        }
    }

    /**
     * Generate attendance summary text
     */
    static generateAttendanceSummary(subjects) {
        if (!subjects || subjects.length === 0) {
            return '📚 *No Subjects Found*\n\nYou haven\'t added any subjects yet.';
        }

        let summary = '📊 *Your Attendance Overview*\n\n';
        
        subjects.forEach(subject => {
            const emoji = this.getAttendanceEmoji(subject.attendancePercentage);
            summary += `${emoji} *${subject.subjectName}*\n`;
            summary += `   ${subject.attendedClasses}/${subject.totalClasses} classes (${subject.attendancePercentage}%)\n\n`;
        });

        return summary + '_💡 Type /show <subject name> for detailed view_';
    }

    /**
     * Validate subject addition command
     */
    static validateSubjectData(subjectName, day, time, duration) {
        const errors = [];

        if (!subjectName || subjectName.length < 2) {
            errors.push('Subject name must be at least 2 characters long');
        }

        if (!this.isValidDay(day)) {
            errors.push('Invalid day name');
        }

        if (!this.isValidTime(time)) {
            errors.push('Invalid time format');
        }

        if (!duration || duration < 0.5 || duration > 8) {
            errors.push('Duration must be between 0.5 and 8 hours');
        }

        return errors;
    }
}

module.exports = Helpers;