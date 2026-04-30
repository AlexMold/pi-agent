import { google } from "googleapis";
import { format, addDays } from "date-fns";
import { buildAuth, CALENDAR_ID, DEFAULT_TZ } from "../auth.js";
import { ListEventsSchema, formatZodError } from "../schemas.js";

export const listEventsTool = {
  name: "list_events",
  description: `List upcoming events from Google Calendar.
Use to check schedule, find free slots, detect conflicts, or answer questions like 'what's planned today/tomorrow'.
Returns events sorted by start time including their IDs — required for update_event.`,
  parameters: {
    type: "object",
    properties: {
      timeMin: {
        type: "string",
        description:
          "Start of range — ISO 8601 with offset. Defaults to now if omitted.",
      },
      timeMax: {
        type: "string",
        description:
          "End of range — ISO 8601 with offset. Defaults to 7 days from now if omitted.",
      },
      maxResults: {
        type: "number",
        description: "Max events to return (1–50, default 10)",
      },
    },
    required: [],
  },
  execute: async (toolCallId, args = {}) => {
    console.log(`[list_events] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
    
    let parsed;
    try {
      parsed = ListEventsSchema.parse(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Ошибка валидации: ${formatZodError(err)}` }],
      };
    }

    const { timeMin, timeMax, maxResults = 10 } = parsed;

    try {
      const auth = buildAuth();
      const calendar = google.calendar({ version: "v3", auth });

      const now = new Date();
      const weekLater = addDays(now, 7);

      const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: timeMin || now.toISOString(),
        timeMax: timeMax || weekLater.toISOString(),
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
        timeZone: DEFAULT_TZ,
      });

      const events = res.data.items || [];

      if (!events.length) {
        return {
          content: [{ type: "text", text: "📭 Нет запланированных событий в этом периоде." }],
        };
      }

      const lines = events.map((e) => {
        const start = e.start.dateTime || e.start.date;
        const formatted = format(new Date(start), "dd.MM.yy, HH:mm");
        return `• [${e.id}] ${formatted} — *${e.summary || "(без названия)"}*`;
      });

      return {
        content: [
          {
            type: "text",
            text: `📅 Найдено событий: ${events.length}\n\n${lines.join("\n")}\n\n_ID в скобках используй для update_event или delete_event._`,
          },
        ],
      };
    } catch (err) {
      console.error("[Calendar Tool] Error in list_events:", err);
      return {
        content: [{ type: "text", text: `❌ Ошибка чтения календаря: ${err.message}` }],
      };
    }
  },
};
