import { google } from "googleapis";
import { buildAuth, CALENDAR_ID, DEFAULT_TZ } from "../auth.js";
import { UpdateEventSchema, formatZodError } from "../schemas.js";

export const updateEventTool = {
  name: "update_event",
  description: `Update (patch) an existing Google Calendar event.
Use when the user wants to reschedule, rename, move, or edit an event.
First call list_events to get the event ID (shown in square brackets), then call this tool.
Only the fields you provide will be changed — omitted fields stay as-is.`,
  parameters: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID from list_events.",
      },
      summary: {
        type: "string",
        description: "New event title.",
      },
      start: {
        type: "string",
        description: "New start time — ISO 8601 with offset.",
      },
      end: {
        type: "string",
        description: "New end time — ISO 8601 with offset.",
      },
      description: {
        type: "string",
        description: "New description.",
      },
      location: {
        type: "string",
        description: "New location.",
      },
      recurrence: {
        type: "array",
        items: { type: "string" },
        description: "New recurrence rules.",
      },
    },
    required: ["eventId"],
  },
  execute: async (toolCallId, args) => {
    console.log(`[update_event] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
    
    let parsed;
    try {
      parsed = UpdateEventSchema.parse(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Ошибка валидации: ${formatZodError(err)}` }],
      };
    }

    const { eventId, summary, start, end, description, location, recurrence } = parsed;

    try {
      const auth = buildAuth();
      const calendar = google.calendar({ version: "v3", auth });

      const patch = {};
      if (summary !== undefined) patch.summary = summary;
      if (description !== undefined) patch.description = description;
      if (location !== undefined) patch.location = location;
      if (recurrence !== undefined) patch.recurrence = recurrence;
      if (start !== undefined)
        patch.start = { dateTime: start, timeZone: DEFAULT_TZ };
      if (end !== undefined)
        patch.end = { dateTime: end, timeZone: DEFAULT_TZ };

      const res = await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId,
        requestBody: patch,
      });

      const updated = res.data;
      const rawStart = updated.start?.dateTime || updated.start?.date || "";
      const startFmt = rawStart
        ? new Date(rawStart).toLocaleString("ru-RU", {
            timeZone: DEFAULT_TZ,
            dateStyle: "medium",
            timeStyle: "short",
          })
        : "";
      const link = updated.htmlLink || "https://calendar.google.com";

      return {
        content: [
          {
            type: "text",
            text: `✅ Событие обновлено!\n📅 *${updated.summary}*${startFmt ? `\n🕐 ${startFmt} (${DEFAULT_TZ})` : ""}\n🔗 ${link}`,
          },
        ],
      };
    } catch (err) {
      console.error("[Calendar Tool] Error in update_event:", err);
      return {
        content: [{ type: "text", text: `❌ Ошибка обновления события: ${err.message}` }],
      };
    }
  },
};
