/**
 * Reminder Tool Extension for Pi-Agent.
 *
 * Registers tools so the agent can create, list, and delete reminders.
 * Reminders are stored persistently and checked every minute by the cron job.
 */

import { reminderManager } from "../../services/reminder.js";

export default function (pi) {
  // ── Create reminder ────────────────────────────────────────────
  pi.registerTool({
    name: "set_reminder",
    description: `Create a reminder for a specific time or delay.
Use when user says "напомни через 10 минут", "напомни в 19:00", "поставь таймер на 30 минут".
Time format: "10m" (minutes), "2h" (hours), "1d" (days), or absolute: "HH:MM" (today) or "YYYY-MM-DD HH:MM".
Chat ID is inferred from context — do not ask for it.`,
    parameters: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Текст напоминания",
        },
        delay: {
          type: "string",
          description:
            'Время: "10m" (минут), "2h" (часов), "1d" (дней), "HH:MM" (сегодня), "YYYY-MM-DD HH:MM" (абсолютное)',
        },
      },
      required: ["text", "delay"],
    },
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const chatId = ctx?.sessionManager?.getBranch?.()?.[0]?.chatId;
      if (!chatId) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Не удалось определить chatId для напоминания.",
            },
          ],
        };
      }

      const { text, delay } = params;
      let dueAt;

      // Parse delay string
      const now = Date.now();
      const match = delay.match(/^(\d+)(m|h|d)$/);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        const ms = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
        dueAt = now + value * ms;
      } else if (delay.includes(":")) {
        // Absolute time
        const parsed = new Date(delay);
        if (isNaN(parsed.getTime())) {
          return {
            content: [
              {
                type: "text",
                text: `❌ Неверный формат времени: "${delay}". Используй "10m", "2h", "HH:MM" или "YYYY-MM-DD HH:MM".`,
              },
            ],
          };
        }
        // If only time given (HH:MM), set for today
        if (delay.length <= 5) {
          const today = new Date();
          parsed.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
        }
        dueAt = parsed.getTime();
        // If the time is already past, schedule for tomorrow
        if (dueAt <= now && delay.length <= 5) {
          dueAt += 86_400_000;
        }
      } else {
        return {
          content: [
            {
              type: "text",
              text: `❌ Неверный формат: "${delay}". Используй "10m", "2h", "1d", "19:00" или "2026-05-01 19:00".`,
            },
          ],
        };
      }

      try {
        const reminder = await reminderManager.add(chatId, text, dueAt);
        const timeStr = new Date(dueAt).toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
        });
        return {
          content: [
            {
              type: "text",
              text: `✅ Напоминание создано!\n📝 ${text}\n🕐 ${timeStr}\n🆔 \`${reminder.id}\``,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Ошибка создания напоминания: ${err.message}`,
            },
          ],
        };
      }
    },
  });

  // ── List reminders ─────────────────────────────────────────────
  pi.registerTool({
    name: "list_reminders",
    description: `List all pending reminders for the current user.
Use when user asks "какие у меня напоминания", "что я просил напомнить", "покажи таймеры".`,
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async (_toolCallId, _params, _signal, _onUpdate, ctx) => {
      const chatId = ctx?.sessionManager?.getBranch?.()?.[0]?.chatId;
      if (!chatId) {
        return { content: [{ type: "text", text: "❌ Не удалось определить пользователя." }] };
      }

      const reminders = reminderManager.list(chatId);
      if (reminders.length === 0) {
        return {
          content: [{ type: "text", text: "📭 Нет активных напоминаний." }],
        };
      }

      const lines = reminders.map((r) => {
        const timeStr = new Date(r.dueAt).toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
        });
        return `• [${r.id}] 🕐 ${timeStr} — ${r.text}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `📋 Активные напоминания (${reminders.length}):\n\n${lines.join("\n")}`,
          },
        ],
      };
    },
  });

  // ── Delete reminder ────────────────────────────────────────────
  pi.registerTool({
    name: "delete_reminder",
    description: `Delete a pending reminder by its ID.
Use after list_reminders to get the ID, then call this tool.
Use when user says "удали напоминание", "отмени таймер", "убери напоминание про ...".`,
    parameters: {
      type: "object",
      properties: {
        reminderId: {
          type: "string",
          description: "ID напоминания из list_reminders (в квадратных скобках).",
        },
      },
      required: ["reminderId"],
    },
    execute: async (_toolCallId, params) => {
      const { reminderId } = params;
      const removed = await reminderManager.remove(reminderId);
      if (removed) {
        return {
          content: [{ type: "text", text: "✅ Напоминание удалено." }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `❌ Напоминание с ID "${reminderId}" не найдено.`,
          },
        ],
      };
    },
  });
}
