import { google } from "googleapis";
import { buildAuth, CALENDAR_ID } from "../auth.js";
import { DeleteEventSchema, formatZodError } from "../schemas.js";

export const deleteEventTool = {
  name: "delete_event",
  description: `Delete a Google Calendar event.
Use when the user wants to cancel or delete an event.
First call list_events to get the event ID (shown in square brackets), then call this tool.`,
  parameters: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "The event ID to delete.",
      },
    },
    required: ["eventId"],
  },
  execute: async (toolCallId, args) => {
    console.log(`[delete_event] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
    
    let parsed;
    try {
      parsed = DeleteEventSchema.parse(args);
    } catch (err) {
      return {
        content: [{ type: "text", text: `❌ Ошибка валидации: ${formatZodError(err)}` }],
      };
    }

    const { eventId } = parsed;

    try {
      const auth = buildAuth();
      const calendar = google.calendar({ version: "v3", auth });

      await calendar.events.delete({
        calendarId: CALENDAR_ID,
        eventId,
      });

      return {
        content: [{ type: "text", text: `✅ Событие успешно удалено.` }],
      };
    } catch (err) {
      console.error("[Calendar Tool] Error in delete_event:", err);
      return {
        content: [{ type: "text", text: `❌ Ошибка удаления события: ${err.message}` }],
      };
    }
  },
};
