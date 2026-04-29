/**
 * Calendar Tool Extension for Pi-Agent.
 *
 * Registers calendar management tools so the agent can:
 *   - manage_calendar  → create events
 *   - list_events      → read upcoming events (collision detection)
 *   - update_event     → patch any field on an existing event
 *
 * Requires credentials.json + token.json in the project root.
 * Run `node auth.js` once to generate token.json.
 */

import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CREDENTIALS_PATH = path.join(ROOT, "credentials", "credentials.json");
const TOKEN_PATH = path.join(ROOT, "credentials", "token.json");
const CALENDAR_ID = "primary";
const DEFAULT_TZ = "Europe/Chisinau";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function buildAuth() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`credentials.json not found at ${CREDENTIALS_PATH}`);
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `token.json not found. Run 'node auth.js' once to authorize.`,
    );
  }

  const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
  const creds = JSON.parse(raw);
  const { client_id, client_secret, redirect_uris } =
    creds.installed || creds.web || creds;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0],
  );

  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  oAuth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oAuth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return oAuth2Client;
}

// ─── Plugin export ────────────────────────────────────────────────────────────

export default function (pi) {
  // ── Tool 1: Create a calendar event ────────────────────────────────────────
  pi.registerTool({
    name: "manage_calendar",
    description: `Create an event in Google Calendar.
Use when the user asks to schedule something, add a meeting, set a reminder, book a workout, etc.
Default timezone is Europe/Chisinau. After creating, return the event link so the user can verify.`,
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Event title (e.g. 'Тренировка', 'Созвон с командой')",
        },
        start: {
          type: "string",
          description:
            "Start time — ISO 8601 with offset, e.g. 2026-04-29T19:00:00+03:00",
        },
        end: {
          type: "string",
          description:
            "End time — ISO 8601 with offset, e.g. 2026-04-29T20:00:00+03:00",
        },
        description: {
          type: "string",
          description: "Optional event description or notes",
        },
        location: {
          type: "string",
          description: "Optional location (e.g. 'Zoom', 'Офис', 'Gym')",
        },
      },
      required: ["summary", "start", "end"],
    },
    // IMPORTANT: The first argument in pi-coding-agent tools is the toolCallId,
    // and the parameters object is the SECOND argument!
    execute: async (toolCallId, args) => {
      console.log(`[manage_calendar] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
      
      const { summary, start, end, description, location } = args;

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
          },
        });

        const created = res.data;
        const link = created.htmlLink || "https://calendar.google.com";
        const startFmt = new Date(start).toLocaleString("ru-RU", {
          timeZone: DEFAULT_TZ,
          dateStyle: "medium",
          timeStyle: "short",
        });

        return {
          content: [
            {
              type: "text",
              text: `✅ Событие создано!\n📅 *${created.summary}*\n🕐 ${startFmt} (${DEFAULT_TZ})\n🔗 ${link}`,
            },
          ],
        };
      } catch (err) {
        console.error("[Calendar Tool] Error in manage_calendar:", err);
        return {
          content: [
            { type: "text", text: `❌ Ошибка создания события: ${err.message}` },
          ],
        };
      }
    },
  });

  // ── Tool 2: List upcoming events ────────────────────────────────────────────
  pi.registerTool({
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
    // The second argument is the actual parameters object
    execute: async (toolCallId, args = {}) => {
      console.log(`[list_events] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
      
      const { timeMin, timeMax, maxResults = 10 } = args;

      try {
        const auth = buildAuth();
        const calendar = google.calendar({ version: "v3", auth });

        const now = new Date();
        const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

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
            content: [
              {
                type: "text",
                text: "📭 Нет запланированных событий в этом периоде.",
              },
            ],
          };
        }

        const lines = events.map((e) => {
          const start = e.start.dateTime || e.start.date;
          const formatted = new Date(start).toLocaleString("ru-RU", {
            timeZone: DEFAULT_TZ,
            dateStyle: "short",
            timeStyle: "short",
          });
          return `• [${e.id}] ${formatted} — *${e.summary || "(без названия)"}*`;
        });

        return {
          content: [
            {
              type: "text",
              text: `📅 Найдено событий: ${events.length}\n\n${lines.join("\n")}\n\n_ID в скобках используй для update_event._`,
            },
          ],
        };
      } catch (err) {
        console.error("[Calendar Tool] Error in list_events:", err);
        return {
          content: [
            { type: "text", text: `❌ Ошибка чтения календаря: ${err.message}` },
          ],
        };
      }
    },
  });

  // ── Tool 3: Update an existing event ───────────────────────────────────────
  pi.registerTool({
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
          description:
            "The event ID from list_events (the value inside the square brackets).",
        },
        summary: {
          type: "string",
          description: "New event title (omit to keep existing).",
        },
        start: {
          type: "string",
          description:
            "New start time — ISO 8601 with offset, e.g. 2026-04-29T19:00:00+03:00.",
        },
        end: {
          type: "string",
          description: "New end time — ISO 8601 with offset.",
        },
        description: {
          type: "string",
          description: "New description (omit to keep existing).",
        },
        location: {
          type: "string",
          description: "New location (omit to keep existing).",
        },
      },
      required: ["eventId"],
    },
    // The second argument is the actual parameters object
    execute: async (toolCallId, args) => {
      console.log(`[update_event] Execution started. callId: ${toolCallId}, args: ${JSON.stringify(args)}`);
      
      const { eventId, summary, start, end, description, location } = args;

      try {
        const auth = buildAuth();
        const calendar = google.calendar({ version: "v3", auth });

        const patch = {};
        if (summary !== undefined) patch.summary = summary;
        if (description !== undefined) patch.description = description;
        if (location !== undefined) patch.location = location;
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
          content: [
            {
              type: "text",
              text: `❌ Ошибка обновления события: ${err.message}`,
            },
          ],
        };
      }
    },
  });
}
