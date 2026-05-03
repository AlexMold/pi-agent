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
import { Cron } from "croner";
import { runBackup } from "./tools/backup.js";

// ── Helpers ─────────────────────────────────────────────────────────

async function waitForService(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        console.log(`[Init] Service ready: ${url}`);
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`[Init] Service not ready after ${timeoutMs}ms: ${url}`);
}

// ── Init ──────────────────────────────────────────────────────────

// Wait for llama-service to be ready (may be downloading model)
await waitForService(`http://${config.llamaHost}/health`, 120_000);

const bot = new Bot(config.telegramToken);

await memory.init().catch((err) => console.error("[Memory] Init failed:", err));
console.log("[Model] LanceDB ready — overrides load lazily on first message");

// ── Auth middleware ────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  // Skip auth for the bot's own messages and other bots
  if (ctx.from?.is_bot) return next();

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
    console.log(`   Llama: ${config.llamaHost}`);
    console.log(`   Whisper: ${config.whisperHost}`);
    console.log(`   Allowed user: ${config.allowedUserId || "any"}`);
  },
});

// ── Cron jobs ──────────────────────────────────────────────────────

// Каждый понедельник в 6 утра — бэкап (cron-worker контейнер обрабатывает напоминания)
new Cron("0 6 * * 1", { timezone: "Europe/Chisinau" }, () => runBackup());

const shutdown = () => {
  bot.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
