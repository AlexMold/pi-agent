/**
 * bot.ts — Telegram Bot entry point (grammY).
 *
 * Thin orchestrator: wires middleware, commands, callbacks, and message handler.
 * All business logic lives in handlers/ and services/.
 *
 * Flow:
 *  1. Voice message  → Whisper.cpp (host) → text
 *  2. SmartRouter    → pick local/cloud model (LLM classifier)
 *  3. LongTermMemory → store & retrieve context (hybrid)
 *  4. Pi-Agent       → execute task in Docker sandbox
 *  5. Response       → Markdown → HTML → Telegram
 */

import { Bot } from "grammy";
import "dotenv/config";

import { config } from "./services/config.js";
import { registerCommands } from "./handlers/commands.js";
import { registerCallbacks } from "./handlers/callbacks.js";
import { registerMessageHandler } from "./handlers/messages.js";
import { memory } from "./memory.js";
import { reminderManager } from "./services/reminder.js";
import { Cron } from "croner";
import { runBackup } from "./tools/backup.js";

// ── Init ──────────────────────────────────────────────────────────

const bot = new Bot(config.telegramToken);

await memory.init().catch((err) => console.error("[Memory] Init failed:", err));
await reminderManager.init(bot).catch((err) => console.error("[Reminder] Init failed:", err));

// ── Auth middleware ────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId && userId !== config.allowedUserId && config.allowedUserId !== 0) {
    await ctx.reply(`⛔ Доступ запрещён. ID: <code>${userId}</code>`, {
      parse_mode: "HTML",
    });
    console.warn(`[Security] Blocked user ${userId}`);
    return;
  }
  await next();
});

// ── Register handlers ─────────────────────────────────────────────

registerCommands(bot);
registerCallbacks(bot);
registerMessageHandler(bot);

// ── Error handling ────────────────────────────────────────────────

bot.catch((err) => console.error("[Bot]", err));
process.on("unhandledRejection", (r, p) =>
  console.error("[Process] unhandled rejection:", p, r),
);
process.on("uncaughtException", (e) =>
  console.error("[Process] uncaught exception:", e),
);

// ── Start ─────────────────────────────────────────────────────────

bot.start({
  onStart: () => {
    console.log("🤖 AI Assistant Pro Bot started");
    console.log(`   Ollama: ${config.ollamaHost}`);
    console.log(`   Whisper: ${config.whisperHost}`);
    console.log(`   Allowed user: ${config.allowedUserId || "any"}`);
  },
});

// ── Cron jobs ──────────────────────────────────────────────────────

// Каждую минуту — проверка напоминаний
new Cron("* * * * *", { timezone: "Europe/Chisinau" }, () =>
  reminderManager.notifyDue(),
);

// Каждый день в 4 утра — бэкап
new Cron("0 6 * * *", { timezone: "Europe/Chisinau" }, () => runBackup());

const shutdown = () => {
  bot.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
