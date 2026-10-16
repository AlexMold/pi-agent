/**
 * Reminder persistence shared by the bot process (via services/reminder.ts,
 * ts-node ESM) and the pi reminder tool extension (plain node ESM).
 *
 * File format: bare JSON array of { id, chatId, text, dueAt, createdAt }.
 * Two processes can write this file (bot cron + pi child tool); the bot
 * reloads from disk before notifying, so last-write-wins is acceptable.
 */
import fs from "fs/promises";
import path from "path";

export function resolvePath() {
  return (
    process.env.REMINDER_DB ||
    path.join(process.env.WORKSPACE_DIR || process.cwd(), "reminders.json")
  );
}

export async function readAll() {
  try {
    const data = await fs.readFile(resolvePath(), "utf-8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeAll(reminders) {
  await fs.mkdir(path.dirname(resolvePath()), { recursive: true });
  await fs.writeFile(resolvePath(), JSON.stringify(reminders, null, 2));
}
