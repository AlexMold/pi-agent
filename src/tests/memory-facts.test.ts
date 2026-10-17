/**
 * Regression tests for LongTermMemory facts (real LanceDB in a temp dir).
 *
 * Guards against the lancedb 0.17 bug where SQL where() silently mismatches
 * camelCase columns ("chatId"), which made searchFacts/recall return nothing.
 * Embeddings use the real Ollama when available, zero vectors otherwise —
 * the tests are correct in both cases.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, rmSync } from "fs";

process.env.MEMORY_DB = join(mkdtempSync(join(tmpdir(), "memory-facts-")), "ai_context");
process.env.OLLAMA_HOST = process.env.OLLAMA_HOST || "localhost:11434";

import { memory } from "../memory.js";

const CHAT = 777;

beforeAll(async () => {
  await memory.addFact("Пользователь живёт в Лиссабоне", "fact", CHAT);
  await memory.addFact("Отвечай коротко", "behavior", CHAT);
  // noise in a different chat — must never leak
  await memory.addFact("Чужой факт для другого чата", "fact", 999);
});

afterAll(() => {
  rmSync(process.env.MEMORY_DB!, { recursive: true, force: true });
});

describe("LongTermMemory facts (real lancedb)", () => {
  it("searchFacts finds a fact by meaning, scoped to the chat", async () => {
    const hits = await memory.searchFacts("где живёт пользователь?", CHAT, 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((f) => f.text.includes("Лиссабоне"))).toBe(true);
    expect(hits.every((f) => f.text !== "Чужой факт для другого чата")).toBe(true);
  });

  it("listRecentFacts returns the chat's facts only", async () => {
    const texts = await memory.listRecentFacts(CHAT, 10);
    expect(texts).toHaveLength(2);
    expect(texts.some((t) => t.includes("Лиссабоне"))).toBe(true);
    expect(await memory.listRecentFacts(999, 10)).toHaveLength(1);
  });
});
