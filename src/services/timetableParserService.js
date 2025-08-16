const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getLogger } = require("../utils/logger");

class TimetableParserService {
  constructor() {
    this.logger = getLogger();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    this.maxRetries = 3; // Increased retries
  }

  async _makeApiCall(imageBuffer, prompt) {
    const result = await this.model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBuffer.toString("base64"),
        },
      },
    ]);
    const response = await result.response;
    return response.text();
  }

  /**
   * Parses a timetable image using an enhanced multi-step approach
   */
  async parseTimetableImage(imageBuffer, userId) {
    this.logger.info("Starting enhanced AI timetable parsing", { userId });

    // Step 1: Analyze timetable structure
    const structureAnalysis = await this._analyzeStructure(imageBuffer, userId);

    // Step 2: Parse with structure-aware prompt
    const enhancedPrompt = this._buildEnhancedPrompt(structureAnalysis);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.info(`AI parsing attempt ${attempt}`, { userId });
        const text = await this._makeApiCall(imageBuffer, enhancedPrompt);

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error("No valid JSON array found in AI response.");
        }

        const parsedData = JSON.parse(jsonMatch[0]);
        const validatedData = this.validateAndCleanData(parsedData);

        // Additional validation step
        const finalData = this._performDurationValidation(
          validatedData,
          structureAnalysis
        );

        this.logger.info("AI timetable parsing successful", {
          userId,
          classesFound: finalData.length,
        });
        return finalData;
      } catch (error) {
        this.logger.warn(`AI parsing attempt ${attempt} failed`, {
          userId,
          error: error.message,
        });
        if (attempt === this.maxRetries) {
          this.logger.error("AI timetable parsing failed after all retries", {
            userId,
          });
          throw new Error(`Failed to parse timetable: ${error.message}`);
        }
      }
    }
  }

  /**
   * First pass: Analyze the timetable structure
   */
  async _analyzeStructure(imageBuffer, userId) {
    const structurePrompt = `
Analyze this timetable image with extreme precision and provide ONLY a JSON response:

{
  "timeFormat": "12-hour" or "24-hour",
  "timeSlots": ["exact list of ALL time column headers you see"],
  "days": ["exact list of ALL day row headers you see"],
  "hasHeaders": true/false,
  "gridType": "merged-cells" or "simple-grid",
  "estimatedSlotDuration": "duration in minutes for each standard slot",
  "timePattern": "describe the time format pattern",
  "visualLayout": "describe the grid structure and cell merging pattern"
}

CRITICAL: Look at EVERY time column header and EVERY day row header. 
Count them precisely. Look for:
- Time headers like "8:00", "9:00", "10:00", "11:00", "12:00", "1:00", "2:00", etc.
- Day headers like "Mon", "Tues", "Wed", "Thurs", "Fri"
- How cells are visually merged or span multiple columns
- The exact pattern of time progression

Respond with ONLY the JSON object.`;

    try {
      const response = await this._makeApiCall(imageBuffer, structurePrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      this.logger.warn("Structure analysis failed, using defaults", {
        userId,
        error: error.message,
      });
    }

    // Default structure if analysis fails
    return {
      timeFormat: "24-hour",
      timeSlots: [],
      days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      hasHeaders: true,
      gridType: "merged-cells",
      estimatedSlotDuration: "60",
    };
  }

  /**
   * Build enhanced prompt based on structure analysis
   */
  _buildEnhancedPrompt(structure) {
    return `
You are an expert timetable parser with matrix analysis capabilities. Treat this timetable as an M x N matrix.

MATRIX ANALYSIS APPROACH:
- Each cell in the grid represents 1 hour
- Row = Day, Column = Time slot  
- If a subject spans multiple adjacent columns, it's ONE continuous class
- Only use the FIRST time column header as start time
- Count total columns spanned for duration

DETECTED STRUCTURE:
- Time format: ${structure.timeFormat}
- Time slots detected: ${
      structure.timeSlots ? structure.timeSlots.join(", ") : "Standard hourly"
    }
- Days: ${structure.days.join(", ")}
- Grid type: ${structure.gridType}
- Slot duration: ${structure.estimatedSlotDuration} minutes

CRITICAL MATRIX RULES:

1. **MATRIX BLOCK DETECTION:**
   - Look at each colored/filled rectangle as ONE continuous block
   - Example: If "DSA" appears in columns [9:00-10:00] AND [10:00-11:00], it's ONE class:
     * Start time: 09:00 (first column)
     * Duration: 2 hours (spans 2 columns)
     * End time: 11:00
   - DO NOT split continuous blocks into separate classes

2. **TIME COLUMN MAPPING (Use FIRST time only):**
   - "8:00" column = Start at "08:00"
   - "9:00" column = Start at "09:00" 
   - "10:00" column = Start at "10:00"
   - "11:00" column = Start at "11:00"
   - "12:00" column = Start at "12:00" (noon)
   - "1:00" column = Start at "13:00" (1 PM)
   - "2:00" column = Start at "14:00" (2 PM)

3. **BLOCK SPAN COUNTING:**
   - Count how many consecutive columns each colored block covers
   - 1 column = 1 hour duration
   - 2 columns = 2 hours duration  
   - 3 columns = 3 hours duration
   - etc.

4. **MATRIX EXAMPLES:**
   - Block in matrix positions [Tuesday, 8:00] + [Tuesday, 9:00] + [Tuesday, 10:00] = 
     {"subject": "Subject Name", "day": "Tuesday", "startTime": "08:00", "endTime": "11:00", "duration": 3.0}
   - Block in matrix position [Monday, 12:00] + [Monday, 1:00] = 
     {"subject": "Subject Name", "day": "Monday", "startTime": "12:00", "endTime": "14:00", "duration": 2.0}

5. **VISUAL BLOCK IDENTIFICATION:**
   - Each distinct colored rectangle = ONE class entry
   - Same subject in adjacent cells = ONE continuous class
   - Different colored blocks = separate classes
   - Gaps between blocks = separate classes

6. **ROW-BY-ROW MATRIX SCAN:**
   For each day row:
   - Scan left to right across time columns
   - When you find a colored block, identify:
     * Which column it starts at (leftmost boundary)
     * How many consecutive columns it spans
     * The subject text within that block
   - Create ONE entry per continuous block

7. **SUBJECT CONSOLIDATION:**
   - If same subject appears in adjacent matrix cells, treat as ONE class
   - Don't create separate entries for each hour of the same class

BE EXTREMELY CAREFUL: Look at visual boundaries, not text placement. A 3-hour "EE315" block should be ONE entry with 3-hour duration, not three separate 1-hour entries.

Output ONLY the JSON array with NO explanations:
[
  {
    "subject": "Exact Subject Name",
    "day": "Day",
    "startTime": "HH:MM",
    "endTime": "HH:MM", 
    "duration": total_hours_as_number
  }
]`;
  }

  /**
   * Enhanced validation with duration checks
   */
  validateAndCleanData(data) {
    if (!Array.isArray(data)) {
      throw new Error("Invalid data format: expected array");
    }

    // Map of day variations to standard names
    const dayMap = {
      // Full names
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      saturday: "Saturday",
      sunday: "Sunday",

      // Common abbreviations
      mon: "Monday",
      tue: "Tuesday",
      tues: "Tuesday",
      wed: "Wednesday",
      thu: "Thursday",
      thur: "Thursday",
      thurs: "Thursday",
      fri: "Friday",
      sat: "Saturday",
      sun: "Sunday",

      // Short abbreviations
      m: "Monday",
      t: "Tuesday",
      w: "Wednesday",
      th: "Thursday",
      f: "Friday",
      s: "Saturday",
      su: "Sunday",
    };

    const cleanedData = [];

    for (const item of data) {
      try {
        if (!item.subject || !item.day || !item.startTime || !item.endTime) {
          this.logger.warn(
            "Skipping invalid class entry - missing required fields",
            { item }
          );
          continue;
        }

        const day = item.day.toLowerCase().trim();
        const standardDay = dayMap[day];

        if (!standardDay) {
          this.logger.warn("Invalid day found, skipping", {
            day: item.day,
            parsed: day,
            availableFormats: Object.keys(dayMap).join(", "),
          });
          continue;
        }

        const startTime = this.normalizeTime(item.startTime);
        const endTime = this.normalizeTime(item.endTime);

        if (!startTime || !endTime) {
          this.logger.warn("Invalid time format, skipping", {
            startTime: item.startTime,
            endTime: item.endTime,
          });
          continue;
        }

        const calculatedDuration = this.calculateDuration(startTime, endTime);

        // Use provided duration if reasonable, otherwise use calculated
        let finalDuration = calculatedDuration;
        if (
          item.duration &&
          typeof item.duration === "number" &&
          item.duration > 0 &&
          item.duration <= 8
        ) {
          // Verify provided duration matches calculated (within 15-minute tolerance)
          const timeDiff = Math.abs(calculatedDuration - item.duration);
          if (timeDiff <= 0.25) {
            // 15 minutes tolerance
            finalDuration = item.duration;
          } else {
            this.logger.warn("Duration mismatch, using calculated", {
              provided: item.duration,
              calculated: calculatedDuration,
              subject: item.subject,
            });
          }
        }

        if (finalDuration <= 0 || finalDuration > 8) {
          this.logger.warn("Invalid duration, skipping", {
            duration: finalDuration,
            subject: item.subject,
            startTime,
            endTime,
          });
          continue;
        }

        const subject = this.cleanSubjectName(item.subject);

        cleanedData.push({
          subject,
          day: standardDay, // Use the standardized day name
          startTime,
          endTime,
          duration: Math.round(finalDuration * 4) / 4, // Round to nearest 15 minutes
        });
      } catch (error) {
        this.logger.warn("Error processing class entry", {
          error: error.message,
          item,
        });
        continue;
      }
    }

    return cleanedData;
  }

  /**
   * Additional validation pass with matrix-based consolidation
   */
  _performDurationValidation(data, structure) {
    const slotDuration = parseInt(structure.estimatedSlotDuration) || 60;

    // Group by day and subject for consolidation
    const dayGroups = {};
    data.forEach((item) => {
      if (!dayGroups[item.day]) dayGroups[item.day] = [];
      dayGroups[item.day].push(item);
    });

    const consolidatedData = [];

    Object.entries(dayGroups).forEach(([day, classes]) => {
      // Sort classes by start time
      classes.sort((a, b) => {
        const timeA = this._timeToMinutes(a.startTime);
        const timeB = this._timeToMinutes(b.startTime);
        return timeA - timeB;
      });

      const processedClasses = [];
      let i = 0;

      while (i < classes.length) {
        const currentClass = classes[i];
        let consolidatedClass = { ...currentClass };
        let j = i + 1;

        // Look for consecutive classes of the same subject
        while (j < classes.length) {
          const nextClass = classes[j];

          // Check if it's the same subject and consecutive time
          if (
            this._isSameSubject(currentClass.subject, nextClass.subject) &&
            this._isConsecutiveTime(
              consolidatedClass.endTime,
              nextClass.startTime
            )
          ) {
            this.logger.info("Consolidating consecutive classes", {
              subject: currentClass.subject,
              day: day,
              originalEnd: consolidatedClass.endTime,
              nextStart: nextClass.startTime,
              nextEnd: nextClass.endTime,
            });

            // Extend the consolidated class
            consolidatedClass.endTime = nextClass.endTime;
            consolidatedClass.duration = this.calculateDuration(
              consolidatedClass.startTime,
              consolidatedClass.endTime
            );
            j++;
          } else {
            break;
          }
        }

        // Validate the consolidated class
        const finalDuration = this.calculateDuration(
          consolidatedClass.startTime,
          consolidatedClass.endTime
        );
        if (Math.abs(finalDuration - consolidatedClass.duration) > 0.1) {
          consolidatedClass.duration = finalDuration;
        }

        // Ensure duration is reasonable
        if (consolidatedClass.duration > 0 && consolidatedClass.duration <= 8) {
          processedClasses.push(consolidatedClass);
        } else {
          this.logger.warn("Skipping class with unreasonable duration", {
            subject: consolidatedClass.subject,
            duration: consolidatedClass.duration,
          });
        }

        i = j;
      }

      consolidatedData.push(...processedClasses);
    });

    return consolidatedData;
  }

  /**
   * Check if two subjects are the same (allowing for minor variations)
   */
  _isSameSubject(subject1, subject2) {
    if (!subject1 || !subject2) return false;

    // Normalize subjects for comparison
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    return normalize(subject1) === normalize(subject2);
  }

  /**
   * Check if two times are consecutive (within 15 minutes)
   */
  _isConsecutiveTime(endTime, startTime) {
    const endMinutes = this._timeToMinutes(endTime);
    const startMinutes = this._timeToMinutes(startTime);
    const gap = startMinutes - endMinutes;

    // Allow up to 15 minutes gap (for breaks) or exact consecutive times
    return gap >= 0 && gap <= 15;
  }

  /**
   * Convert time to minutes for comparison
   */
  _timeToMinutes(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Check if two classes have overlapping times
   */
  _hasTimeOverlap(class1, class2) {
    const start1 = this._timeToMinutes(class1.startTime);
    const end1 = this._timeToMinutes(class1.endTime);
    const start2 = this._timeToMinutes(class2.startTime);
    const end2 = this._timeToMinutes(class2.endTime);

    return start1 < end2 && start2 < end1;
  }

  /**
   * Attempt to resolve time overlap between classes
   */
  _resolveOverlap(class1, class2) {
    // Simple resolution: adjust end time of earlier class to start time of later class
    const start1 = this._timeToMinutes(class1.startTime);
    const start2 = this._timeToMinutes(class2.startTime);

    if (start1 < start2) {
      // class1 starts earlier, adjust its end time
      const newEndTime = class2.startTime;
      const newDuration = this.calculateDuration(class1.startTime, newEndTime);
      return {
        ...class1,
        endTime: newEndTime,
        duration: newDuration,
      };
    }

    return class1; // Return unchanged if can't resolve
  }

  /**
   * Add minutes to a time string
   */
  _addMinutesToTime(timeString, minutes) {
    const [hours, mins] = timeString.split(":").map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMins = totalMinutes % 60;

    return `${newHours.toString().padStart(2, "0")}:${newMins
      .toString()
      .padStart(2, "0")}`;
  }

  /**
   * Enhanced time normalization with academic-specific patterns
   */
  normalizeTime(time) {
    if (!time) return null;

    time = time.toString().trim().toLowerCase();

    // Handle various time formats with academic context
    const timePatterns = [
      // Standard 24-hour formats
      { pattern: /^(\d{1,2}):(\d{2})$/, format: "hm" },
      { pattern: /^(\d{2})(\d{2})$/, format: "hhmm" },

      // 12-hour formats
      { pattern: /^(\d{1,2}):(\d{2})\s*(am|pm)$/, format: "hm12" },
      { pattern: /^(\d{1,2})\s*(am|pm)$/, format: "h12" },
      { pattern: /^(\d{1,2})\.(\d{2})\s*(am|pm)?$/, format: "hm12" },

      // Academic time slots
      { pattern: /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/, format: "range" },
      { pattern: /^(\d{1,2})-(\d{1,2})$/, format: "hour_range" },

      // Slot-based (T1, T2, etc.)
      { pattern: /^t(\d+)$/i, format: "slot" },
      { pattern: /^slot\s*(\d+)$/i, format: "slot" },

      // Academic periods
      { pattern: /^p(\d+)$/i, format: "period" },
      { pattern: /^period\s*(\d+)$/i, format: "period" },
    ];

    for (const { pattern, format } of timePatterns) {
      const match = time.match(pattern);
      if (match) {
        let hours,
          minutes = 0;

        switch (format) {
          case "hm":
            hours = parseInt(match[1]);
            minutes = parseInt(match[2] || "0");
            break;

          case "hhmm":
            const timeStr = match[0];
            if (timeStr.length === 4) {
              hours = parseInt(timeStr.substring(0, 2));
              minutes = parseInt(timeStr.substring(2, 4));
            } else if (timeStr.length === 3) {
              hours = parseInt(timeStr.substring(0, 1));
              minutes = parseInt(timeStr.substring(1, 3));
            }
            break;

          case "hm12":
            hours = parseInt(match[1]);
            minutes = parseInt(match[2] || "0");
            const period = match[3];
            if (period === "pm" && hours !== 12) hours += 12;
            else if (period === "am" && hours === 12) hours = 0;
            // If no period specified but hour is 1-7, assume PM (afternoon classes)
            else if (!period && hours >= 1 && hours <= 7) hours += 12;
            break;

          case "h12":
            hours = parseInt(match[1]);
            const period12 = match[2];
            if (period12 === "pm" && hours !== 12) hours += 12;
            else if (period12 === "am" && hours === 12) hours = 0;
            break;

          case "range":
            // Take start time from range
            hours = parseInt(match[1]);
            minutes = parseInt(match[2]);
            break;

          case "hour_range":
            // Take start hour from range
            hours = parseInt(match[1]);
            // Apply academic context - if hour is 1-7, likely PM
            if (hours >= 1 && hours <= 7) hours += 12;
            break;

          case "slot":
            // Convert slot number to time (starting from 8:00)
            const slotNum = parseInt(match[1]);
            hours = 7 + slotNum; // T1=8:00, T2=9:00, etc.
            break;

          case "period":
            // Similar to slot
            const periodNum = parseInt(match[1]);
            hours = 7 + periodNum;
            break;
        }

        // Academic schedule context adjustments
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          // Adjust for common academic patterns
          if (hours < 8 && hours > 0) {
            // Likely afternoon class (1:00 = 13:00, 2:00 = 14:00, etc.)
            hours += 12;
          }

          return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}`;
        }
      }
    }

    // Last resort: try to extract any numbers and make reasonable assumptions
    const numbers = time.match(/\d+/g);
    if (numbers && numbers.length > 0) {
      let hours = parseInt(numbers[0]);
      let minutes = numbers.length > 1 ? parseInt(numbers[1]) : 0;

      // Academic context: single digits 1-7 are likely PM
      if (hours >= 1 && hours <= 7 && minutes < 60) {
        hours += 12;
      }

      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return `${hours.toString().padStart(2, "0")}:${minutes
          .toString()
          .padStart(2, "0")}`;
      }
    }

    this.logger.warn("Unable to parse time format", {
      time,
      originalTime: arguments[0],
    });
    return null;
  }

  /**
   * Enhanced duration calculation with better accuracy
   */
  calculateDuration(startTime, endTime) {
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    let startMinutes = startHour * 60 + startMin;
    let endMinutes = endHour * 60 + endMin;

    // Handle overnight classes (rare but possible)
    if (endMinutes <= startMinutes) {
      endMinutes += 24 * 60;
    }

    const durationMinutes = endMinutes - startMinutes;
    const durationHours = durationMinutes / 60;

    // Round to nearest 15 minutes for practical purposes
    return Math.round(durationHours * 4) / 4;
  }

  /**
   * Enhanced subject name cleaning
   */
  cleanSubjectName(subject) {
    if (!subject) return "Unknown Subject";

    return subject
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s\-&]/g, "")
      .replace(/\b(room|r|hall|h)\s*\d+/gi, "") // Remove room numbers
      .replace(/\b[a-z]\d+[a-z]?\b/gi, "") // Remove codes like "m2g1"
      .trim()
      .substring(0, 100);
  }

  capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  isAvailable() {
    return !!process.env.GEMINI_API_KEY;
  }
}

module.exports = TimetableParserService;
