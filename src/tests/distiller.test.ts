/**
 * Tests for services/distiller.ts — fact extraction, dedup and the
 * post-distill session rotation. LLM (fetch) and memory are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, readdirSync, readFileSync, mkdirSync } from "fs";

const { mockAddFact, mockListRecentFacts } = vi.hoisted(() => ({
  mockAddFact: vi.fn(),
  mockListRecentFacts: vi.fn(),
}));

vi.mock("../memory.js", () => ({
  memory: {
    addFact: mockAddFact,
    listRecentFacts: mockListRecentFacts,
  },
}));

import { runDistillation, distillChat } from "../services/distiller.js";

const fetchMock = vi.fn();

function llmResponse(facts: any[], digest: string | null) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ facts, digest }) } }],
    }),
  };
}

function seedSession(dir: string, name: string, chatId: number, ageMs: number) {
  const sessionsDir = join(dir, "sessions");
  const path = join(sessionsDir, name);
  const line = (text: string) =>
    JSON.stringify({
      type: "message",
      timestamp: Date.now(),
      message: { role: "user", content: [{ type: "text", text }] },
    }) + "\n";
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(path, line("меня зовут Алекс") + line("как дела?"));
  // make the file look old enough (idle + after checkpoint)
  const old = new Date(Date.now() - ageMs);
  utimesSync(path, old, old);
  return path;
}

beforeEach(() => {
  fetchMock.mockReset();
  mockAddFact.mockReset();
  mockListRecentFacts.mockReset().mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WORKSPACE_DIR;
});

describe("distillChat", () => {
  it("adds new facts, skips exact duplicates", async () => {
    fetchMock.mockResolvedValue(
      llmResponse(
        [
          { text: "Пользователя зовут Алекс", kind: "fact" },
          { text: "пользователя зовут  Алекс", kind: "fact" }, // dup after normalize
          { text: "Отвечай коротко", kind: "behavior" },
        ],
        "Знакомились.",
      ),
    );

    const result = await distillChat(42, [{ role: "user", text: "меня зовут Алекс" }], [
      "Пользователя зовут Алекс",
    ]);

    expect(result.added).toBe(1); // only the behavior rule
    expect(result.skipped).toBe(2); // both name-facts dedup against existing
    expect(result.digest).toBe("Знакомились.");
    expect(mockAddFact).toHaveBeenCalledTimes(1);
    expect(mockAddFact).toHaveBeenCalledWith("Отвечай коротко", "behavior", 42);
  });

  it("throws on LLM failure (caller decides what to do)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(distillChat(1, [{ role: "user", text: "x" }], [])).rejects.toThrow(
      /LLM HTTP 500/,
    );
  });

  it("throws when the LLM answer has no JSON object", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "никакого json" } }] }),
    });
    await expect(distillChat(1, [{ role: "user", text: "x" }], [])).rejects.toThrow(
      /no JSON/,
    );
  });
});

describe("runDistillation", () => {
  it("distills idle sessions, archives them and leaves a digest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-"));
    process.env.WORKSPACE_DIR = dir;
    seedSession(dir, "2026-01-01T00-00-00-000Z_chat_42.jsonl", 42, 60 * 60 * 1000);
    fetchMock.mockResolvedValue(
      llmResponse([{ text: "Пользователя зовут Алекс", kind: "fact" }], "Знакомились."),
    );

    const stats = await runDistillation();

    expect(stats.chats).toBe(1);
    expect(stats.factsAdded).toBe(1);
    expect(stats.rotated).toBe(1);
    expect(mockAddFact).toHaveBeenCalledWith(
      "Пользователя зовут Алекс",
      "fact",
      42,
    );
    // digest file left for the next message to consume
    expect(existsSync(join(dir, "sessions", "chat_42.digest.md"))).toBe(true);
    // original session archived, not deleted
    const archived = readdirSync(join(dir, "sessions", "archive"));
    expect(archived.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips chats active in the last 10 minutes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-active-"));
    process.env.WORKSPACE_DIR = dir;
    seedSession(dir, "2026-01-01T00-00-00-000Z_chat_7.jsonl", 7, 60 * 1000); // fresh mtime
    fetchMock.mockResolvedValue(llmResponse([], null));

    const stats = await runDistillation();

    expect(stats.skippedActive).toBe(1);
    expect(stats.chats).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not re-process sessions already covered by the checkpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "distill-ckpt-"));
    process.env.WORKSPACE_DIR = dir;
    seedSession(dir, "2026-01-01T00-00-00-000Z_chat_5.jsonl", 5, 60 * 60 * 1000);
    fetchMock.mockResolvedValue(llmResponse([], null));

    await runDistillation();
    // second run right after: checkpoint says everything is covered.
    // (the first run rotated the session, so a fresh empty run is expected)
    const stats = await runDistillation();

    expect(stats.chats).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
