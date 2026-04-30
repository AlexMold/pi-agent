/**
 * services/reminder.ts — Per-user reminders with persistent storage.
 *
 * Stores reminders in a JSON file (survives container restarts).
 * Cron job in bot.ts checks every minute and sends Telegram notifications.
 */

import fs from "fs/promises";
import type { Bot } from "grammy";

export interface Reminder {
  id: string;
  chatId: number;
  text: string;
  /** Unix ms — when to fire */
  dueAt: number;
  createdAt: number;
}

class ReminderManager {
  private reminders: Reminder[] = [];
  private dbPath = "/app/workspace/reminders.json";
  private loaded = false;
  private bot?: Bot;

  async init(bot: Bot): Promise<void> {
    this.bot = bot;
    try {
      const data = await fs.readFile(this.dbPath, "utf-8");
      this.reminders = JSON.parse(data);
      console.log(`[Reminder] Loaded ${this.reminders.length} reminders`);
    } catch {
      this.reminders = [];
      await this.save();
      console.log("[Reminder] Initialized empty storage");
    }
    this.loaded = true;
  }

  /** Add a new reminder. Returns the created reminder. */
  async add(chatId: number, text: string, dueAt: number): Promise<Reminder> {
    const reminder: Reminder = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      text,
      dueAt,
      createdAt: Date.now(),
    };
    this.reminders.push(reminder);
    await this.save();
    return reminder;
  }

  /** Remove a reminder by ID. Returns true if found and removed. */
  async remove(id: string): Promise<boolean> {
    const idx = this.reminders.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.reminders.splice(idx, 1);
    await this.save();
    return true;
  }

  /** Return all reminders whose due time has passed. */
  getDue(): Reminder[] {
    const now = Date.now();
    return this.reminders.filter((r) => r.dueAt <= now);
  }

  /** Send notifications for all due reminders and remove them. */
  async notifyDue(): Promise<void> {
    if (!this.bot) return;
    const due = this.getDue();
    if (due.length === 0) return;

    console.log(`[Reminder] Notifying ${due.length} due reminder(s)`);

    for (const r of due) {
      try {
        await this.bot.api.sendMessage(
          r.chatId,
          `⏰ Напоминание!\n\n${r.text}`,
        );
        console.log(`[Reminder] Sent to chat ${r.chatId}: ${r.text.slice(0, 60)}`);
      } catch (err) {
        console.error(`[Reminder] Failed to send to chat ${r.chatId}:`, err);
      }
      await this.remove(r.id);
    }
  }

  /** List all pending reminders for a given chat. */
  list(chatId: number): Reminder[] {
    return this.reminders
      .filter((r) => r.chatId === chatId)
      .sort((a, b) => a.dueAt - b.dueAt);
  }

  /** List all reminders across all chats (for admin/debug). */
  all(): Reminder[] {
    return [...this.reminders];
  }

  /** Count pending reminders for a given chat. */
  count(chatId: number): number {
    return this.reminders.filter((r) => r.chatId === chatId).length;
  }

  private async save(): Promise<void> {
    if (!this.loaded) return;
    try {
      await fs.writeFile(this.dbPath, JSON.stringify(this.reminders, null, 2));
    } catch (err) {
      console.error("[Reminder] Save failed:", err);
    }
  }
}

export const reminderManager = new ReminderManager();
