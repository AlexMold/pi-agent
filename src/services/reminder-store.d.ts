/** Types for reminder-store.js (plain JS module shared with the pi tool). */

export interface StoredReminder {
  id: string;
  chatId: number;
  text: string;
  dueAt: number;
  createdAt: number;
}

export declare function resolvePath(): string;
export declare function readAll(): Promise<StoredReminder[]>;
export declare function writeAll(reminders: StoredReminder[]): Promise<void>;
