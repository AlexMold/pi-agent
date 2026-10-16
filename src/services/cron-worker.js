/**
 * cron-worker.js — Lightweight reminder checker.
 *
 * Runs standalone in a minimal container (node:24-alpine).
 * Reads reminders from shared workspace volume, sends Telegram notifications
 * every 60 seconds. No Pi, no LanceDB, no ffmpeg — just grammy + fs.
 */

import { Bot } from "grammy";
import fs from "node:fs/promises";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN not set");
  process.exit(1);
}

const DB_PATH = process.env.REMINDER_DB || "/app/workspace/reminders.json";

const bot = new Bot(TELEGRAM_TOKEN);

async function tick() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    const reminders = JSON.parse(raw);

    if (!Array.isArray(reminders) || reminders.length === 0) return;

    const now = Date.now();
    const due = reminders.filter((r) => r.dueAt <= now);

    if (due.length === 0) {
      const next = reminders.reduce((a, r) => (r.dueAt < a ? r.dueAt : a), Infinity);
      const secLeft = Math.round((next - now) / 1000);
      console.log(`[Cron] ${reminders.length} pending, next in ${secLeft}s`);
      return;
    }

    console.log(`[Cron] ${due.length} due — sending notifications`);

    const failed = new Set();
    for (const r of due) {
      try {
        await bot.api.sendMessage(r.chatId, `⏰ Напоминание!\n\n${r.text}`);
        console.log(`[Cron] ✅ sent to chat ${r.chatId}: ${r.text.slice(0, 50)}`);
      } catch (err) {
        failed.add(r.id);
        console.error(`[Cron] ❌ failed to send to chat ${r.chatId}: ${err.message}`);
      }
    }

    // Re-read before writing: the pi tool may have added reminders while we
    // were sending. Use the fresh array so nothing gets clobbered.
    const fresh = JSON.parse(await fs.readFile(DB_PATH, "utf-8"));
    const sentIds = new Set(due.filter((r) => !failed.has(r.id)).map((r) => r.id));
    // Sent ones are removed; failed ones stay and retry on the next tick
    const remaining = fresh.filter((r) => !sentIds.has(r.id));
    await fs.writeFile(DB_PATH, JSON.stringify(remaining, null, 2));
    console.log(`[Cron] ${remaining.length} remaining`);
  } catch (err) {
    console.error("[Cron] Error:", err.message);
  }
}

// ── Start ────────────────────────────────────────────────────────

console.log("⏰ Cron Worker started");
console.log(`   DB: ${DB_PATH}`);

// Fire immediately, then every 60s
// No bot.start() — we only SEND messages, not receive
tick();
setInterval(tick, 60_000);

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
