import { google } from "googleapis";
import { format } from "date-fns";
import { buildAuth, CALENDAR_ID, DEFAULT_TZ } from "../auth.js";
import { ManageCalendarSchema, formatZodError } from "../schemas.js";

export const manageCalendarTool = {
  name: "manage_calendar",
  description: `Create an event in Google Calendar.
Use when the user asks to schedule something, add a meeting, set a reminder, book a workout, etc.
Default timezone is Europe/Chisinau. After creating, return the event link so the user can verify.
You can specify recurrences, like ["RRULE:FREQ=WEEKLY;COUNT=10"].`,
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Event title (e.g. 'Тренировка', 'Созвон с командой')",
      },
      start: {
        type: "string",
        description: "Start time — ISO 8601 with offset, e.g. 2026-04-29T19:00:00+03:00",
      },
      end: {
        type: "string",
        description: "End time — ISO 8601 with offset, e.g. 2026-04-29T20:00:00+03:00",
      },
      description: {
        type: "string",
        description: "Optional event description or notes",
      },
      location: {
        type: "string",
        description: "Optional location (e.g. 'Zoom', 'Офис', 'Gym')",
      },
      recurrence: {
        type: "array",
        items: { type: "string" },
        description: "Optional recurrence rules, e.g. ['RRULE:FREQ=WEEKLY;COUNT=10']",
      },
    },
    required: ["summary", "start", "end"],
  },
  execute: async (toolCallId, args) => {
    console.log(`[manage_calendar] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
    
    let parsed;
    try {
      parsed = ManageCalendarSchema.parse(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Ошибка валидации: ${formatZodError(err)}` }],
      };
    }

    const { summary, start, end, description, location, recurrence } = parsed;

    try {
      const auth = buildAuth();
      const calendar = google.calendar({ version: "v3", auth });

      const res = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        requestBody: {
          summary,
          start: { dateTime: start, timeZone: DEFAULT_TZ },
          end: { dateTime: end, timeZone: DEFAULT_TZ },
          ...(description && { description }),
          ...(location && { location }),
          ...(recurrence && { recurrence }),
          // Всегда добавляем уведомление за 10 минут
          reminders: {
            useDefault: false,
            overrides: [{ method: "popup", minutes: 10 }],
          },
        },
      });

      const created = res.data;
      const link = created.htmlLink || "https://calendar.google.com";
      const startFmt = format(new Date(start), "dd.MM.yyyy, HH:mm");

      let responseText = `✅ Событие создано!\n📅 *${created.summary}*\n🕐 ${startFmt} (${DEFAULT_TZ})`;
      if (recurrence) responseText += `\n🔄 Повторение: ${recurrence.join(", ")}`;
      responseText += `\n🔗 ${link}`;

      return { content: [{ type: "text", text: responseText }] };
    } catch (err) {
      console.error("[Calendar Tool] Error in manage_calendar:", err);
      return {
        content: [{ type: "text", text: `❌ Ошибка создания события: ${err.message}` }],
      };
    }
  },
};
