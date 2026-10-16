/**
 * Tests for reminder-store.js — the shared JSON persistence used by the
 * bot process and the pi reminder tool.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";

import { resolvePath, readAll, writeAll } from "../services/reminder-store.js";

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "reminder-store-"));
  file = join(dir, "reminders.json");
  process.env.REMINDER_DB = file;
});

afterEach(() => {
  delete process.env.REMINDER_DB;
  rmSync(dir, { recursive: true, force: true });
});

describe("reminder-store", () => {
  it("resolvePath honors REMINDER_DB", () => {
    expect(resolvePath()).toBe(file);
  });

  it("readAll returns [] when the file is missing", async () => {
    expect(await readAll()).toEqual([]);
  });

  it("readAll returns [] when the file is not a JSON array", async () => {
    writeFileSync(file, "not json");
    expect(await readAll()).toEqual([]);
  });

  it("round-trips reminders: write, read, update, delete", async () => {
    const first = {
      id: "1",
      chatId: 42,
      text: "напомнить",
      dueAt: 1,
      createdAt: 0,
    };
    await writeAll([first]);
    expect(await readAll()).toEqual([first]);

    const second = {
      id: "2",
      chatId: -100123, // group chats have negative ids
      text: "ещё",
      dueAt: 2,
      createdAt: 0,
    };
    await writeAll([first, second]);
    expect(await readAll()).toHaveLength(2);

    // mimic the tool's remove: filter and write back
    const afterRemove = (await readAll()).filter((r) => r.id !== "1");
    await writeAll(afterRemove);
    expect(await readAll()).toEqual([second]);
  });
});
