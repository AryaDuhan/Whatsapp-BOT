const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getLogger } = require("../utils/logger");

class TimetableParserService {
  constructor() {
    this.logger = getLogger();
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    this.maxRetries = 2; // Number of times to retry on failure
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
   * Parses a timetable image using an advanced, reasoning-based approach with few-shot prompting.
   * @param {Buffer} imageBuffer The image of the timetable.
   * @param {string} userId The ID of the user.
   * @returns {Promise<Array>} A promise that resolves to an array of parsed class objects.
   */
  async parseTimetableImage(imageBuffer, userId) {
    this.logger.info("Starting advanced AI timetable parsing with reasoning", {
      userId,
    });

    const initialPrompt = `
Your task is to act as an expert data extractor. Analyze the provided timetable image and convert it into a structured JSON format.

Here is an example of how to think about the task:
If you see a cell for "Physics LAB" that starts in the "10:00 to 11:00" column and spans across to the end of the "11:00 to 12:00" column on a Monday, the correct JSON object would be:
{
  "subject": "Physics LAB",
  "day": "Monday",
  "startTime": "10:00",
  "endTime": "12:00",
  "duration": 2.0
}

Now, apply this logic to the image provided.

**CRITICAL INSTRUCTIONS:**
1.  **Analyze the Layout:** First, understand the grid. Identify the days of the week on the vertical axis and the time slots on the horizontal axis.
2.  **Interpret Times:** Convert all time slots to a 24-hour HH:MM format. For example, a column labeled "1:00 to 2:00" should be interpreted as "13:00" to "14:00".
3.  **Handle Merged Cells:** For cells that span multiple time columns, the start time is from the beginning of the first column, and the end time is from the end of the last column it covers.
4.  **Extract Core Subject:** From each class block, extract only the essential subject name and its type (e.g., "DSA LEC", "DME LAB"). Ignore all other codes, names, or locations.
5.  **Ignore Blanks:** Do not create entries for empty or filler cells (like those with "XX" or "E1").
6.  **Final Output:** Your final output must be ONLY the raw JSON array and nothing else. No explanations or markdown.

JSON structure:
[
  {
    "subject": "Core Subject Name",
    "day": "Day of Week",
    "startTime": "HH:MM",
    "endTime": "HH:MM",
    "duration": "Duration in hours (decimal)"
  }
]
`;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        this.logger.info(`AI parsing attempt ${attempt}`, { userId });
        const text = await this._makeApiCall(imageBuffer, initialPrompt);

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          throw new Error("No valid JSON array found in AI response.");
        }

        const parsedData = JSON.parse(jsonMatch[0]);
        const validatedData = this.validateAndCleanData(parsedData);

        this.logger.info("AI timetable parsing successful", {
          userId,
          classesFound: validatedData.length,
        });
        return validatedData;
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
   * validate and clean parsed data
   * @param {Array} data
   * @returns {Array}
   */
  validateAndCleanData(data) {
    if (!Array.isArray(data)) {
      throw new Error("Invalid data format: expected array");
    }

    const validDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    const cleanedData = [];

    for (const item of data) {
      try {
        if (!item.subject || !item.day || !item.startTime || !item.endTime) {
          this.logger.warn("Skipping invalid class entry", { item });
          continue;
        }

        const day = item.day.toLowerCase().trim();
        if (!validDays.includes(day)) {
          this.logger.warn("Invalid day found, skipping", { day: item.day });
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

        const duration = this.calculateDuration(startTime, endTime);
        if (duration <= 0 || duration > 8) {
          this.logger.warn("Invalid duration, skipping", { duration });
          continue;
        }

        const subject = this.cleanSubjectName(item.subject);

        cleanedData.push({
          subject,
          day: this.capitalizeFirstLetter(day),
          startTime,
          endTime,
          duration,
        });
      } catch (error) {
        this.logger.warn("Error processing class entry", error, { item });
        continue;
      }
    }

    return cleanedData;
  }

  /**
   * normalize time format
   * @param {string} time
   * @returns {string}
   */
  normalizeTime(time) {
    if (!time) return null;

    time = time.toString().trim();

    const timePatterns = [
      /^(\d{1,2}):(\d{2})$/i,
      /^(\d{1,2})\.(\d{2})$/i,
      /^(\d{1,2})h(\d{2})?$/i,
      /^(\d{1,2})(\d{2})$/i,
      /^(\d{1,2}):(\d{2})(am|pm)$/i,
      /^(\d{1,2})\.(\d{2})(am|pm)$/i,
    ];

    for (const pattern of timePatterns) {
      const match = time.match(pattern);
      if (match) {
        let hours = parseInt(match[1]);
        let minutes = parseInt(match[2] || "0");
        const period = match[3]?.toLowerCase();

        if (period === "pm" && hours !== 12) {
          hours += 12;
        } else if (period === "am" && hours === 12) {
          hours = 0;
        }

        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
          return `${hours.toString().padStart(2, "0")}:${minutes
            .toString()
            .padStart(2, "0")}`;
        }
      }
    }

    return null;
  }

  /**
   * calculate duration between two times
   * @param {string} startTime
   * @param {string} endTime
   * @returns {number}
   */
  calculateDuration(startTime, endTime) {
    const [startHour, startMin] = startTime.split(":").map(Number);
    const [endHour, endMin] = endTime.split(":").map(Number);

    let startMinutes = startHour * 60 + startMin;
    let endMinutes = endHour * 60 + endMin;

    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60;
    }

    const durationMinutes = endMinutes - startMinutes;
    return durationMinutes / 60;
  }

  /**
   * clean subject name
   * @param {string} subject
   * @returns {string}
   */
  cleanSubjectName(subject) {
    if (!subject) return "Unknown Subject";

    return subject
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[^\w\s\-]/g, "")
      .substring(0, 100);
  }

  /**
   * capitalize first letter
   * @param {string} str - input string
   * @returns {string} string with first letter capitalized
   */
  capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * check if AI service is available
   * @returns {boolean} true if API key is configured
   */
  isAvailable() {
    return !!process.env.GEMINI_API_KEY;
  }
}

module.exports = TimetableParserService;
