/**
 * LongTermMemory — Hybrid: LanceDB (semantic) + in-memory ring buffer (recent).
 *
 * - Ring buffer (last 100 per chat): in-RAM store and fallback; the pi session
 *   now carries recent turns into the prompt, so recall() is called with a
 *   zero time window and injects semantic matches only
 * - Semantic search (top 5): LanceDB for long-term recall
 */

import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";

const OLLAMA_BASE = process.env.OLLAMA_HOST || "host.docker.internal:11434";

interface Message {
  role: string;
  text: string;
}

interface TimedMessage extends Message {
  timestamp: number;
}

// ── Ring buffer for recent messages ──────────────────────────────────
const MAX_RECENT = 100;
const recentByChat = new Map<number, TimedMessage[]>();

function pushRecent(chatId: number, msg: TimedMessage) {
  const list = recentByChat.get(chatId) || [];
  list.push(msg);
  if (list.length > MAX_RECENT) list.shift();
  recentByChat.set(chatId, list);
}

/** Return messages within the last `rangeMs` milliseconds. */
function getRecentInRange(chatId: number, rangeMs: number): TimedMessage[] {
  const list = recentByChat.get(chatId) || [];
  if (list.length === 0) return [];
  const cutoff = Date.now() - rangeMs;
  // Filter and return chronological order (oldest first)
  return list.filter((m) => m.timestamp >= cutoff);
}

// ── LanceDB for long-term semantic memory ────────────────────────────

export class LongTermMemory {
  private db!: Connection;
  private table!: Table;
  private usageTable!: Table;
  private factsTable!: Table;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    // MEMORY_DB overrides for tests; /app/memory_db exists only in the container
    const dbPath =
      process.env.MEMORY_DB ||
      (existsSync("/app/memory_db") ? "/app/memory_db/ai_context" : "memory_db/ai_context");
    console.log(`[Memory] Connecting to LanceDB at ${dbPath}`);
    this.db = await lancedb.connect(dbPath);
    const tables = await this.db.tableNames();

    if (!tables.includes("history")) {
      this.table = await this.db.createTable("history", [
        {
          vector: new Array(768).fill(0),
          text: "init",
          role: "system",
          chatId: 0,
          timestamp: Date.now(),
        },
      ]);
    } else {
      this.table = await this.db.openTable("history");
    }

    // Usage tracking table (per-message LLM cost records)
    if (!tables.includes("usage")) {
      this.usageTable = await this.db.createTable("usage", [
        {
          chatId: 0,
          model: "__init__",
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
          timestamp: Date.now(),
          queryLen: 0,
        },
      ]);
    } else {
      this.usageTable = await this.db.openTable("usage");
    }

    // Distilled durable facts (user facts + behavior rules)
    if (!tables.includes("facts")) {
      this.factsTable = await this.db.createTable("facts", [
        {
          vector: new Array(768).fill(0),
          id: "__init__",
          text: "init",
          kind: "fact",
          chatId: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]);
    } else {
      this.factsTable = await this.db.openTable("facts");
    }

    this.initialized = true;
    console.log("[Memory] LanceDB + ring buffer initialized");
  }

  /** Store a usage record (cost + tokens) in the usage table. */
  async recordUsage(rec: {
    chatId: number;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    timestamp: number;
    queryLen: number;
  }): Promise<void> {
    if (!this.initialized) await this.init();
    try {
      await this.usageTable.add([rec]);
    } catch (err: any) {
      console.error("[Memory] recordUsage failed:", err.message);
    }
  }

  /** Get usage rows for a chat, optionally since a timestamp. */
  async getUsage(
    chatId: number,
    sinceMs?: number,
  ): Promise<
    Array<{
      chatId: number;
      model: string;
      inputTokens: number;
      outputTokens: number;
      cost: number;
      timestamp: number;
      queryLen: number;
    }>
  > {
    if (!this.initialized) await this.init();
    try {
      // lancedb 0.17 where() silently mismatches camelCase columns - filter in JS
      const rows = (await this.usageTable.query().toArray()) as any[];
      return rows.filter(
        (r) =>
          r.chatId === chatId &&
          (sinceMs === undefined || r.timestamp >= sinceMs),
      );
    } catch (err: any) {
      console.error("[Memory] getUsage failed:", err.message);
      return [];
    }
  }

  /** Store a message in both ring buffer and LanceDB */
  async remember(
    text: string,
    metadata: { role: string; chatId: number; timestamp?: number },
  ): Promise<void> {
    // Ring buffer (always works, no async dependency)
    pushRecent(metadata.chatId, {
      role: metadata.role,
      text,
      timestamp: metadata.timestamp || Date.now(),
    });

    // LanceDB (semantic long-term)
    if (!this.initialized) await this.init();
    try {
      const vector = await this.embed(text);
      await this.table.add([
        {
          vector,
          text,
          role: metadata.role,
          chatId: metadata.chatId,
          timestamp: metadata.timestamp || Date.now(),
        },
      ]);
    } catch (err) {
      console.error("[Memory] LanceDB store failed (non-fatal):", err);
    }
  }

  /**
   * Hybrid recall:
   *  - Recent messages within time window (always, chronological)
   *  - K semantic matches (LanceDB)
   * Deduplicated, recent first.
   *
   * Messages.ts passes timeRangeMs=0: the persistent pi session carries
   * recent turns, so only semantic matches get injected.
   */
  async recall(
    query: string,
    chatId: number,
    timeRangeMs = 30 * 60 * 1000,
    semanticK = 4,
  ): Promise<Message[]> {
    const results: Message[] = [];

    // 1. Recent messages within time window
    const recent = getRecentInRange(chatId, timeRangeMs);
    results.push(...recent);

    // 2. Semantic search
    if (this.initialized) {
      try {
        const vector = await this.embed(query);
        // lancedb 0.17 where() silently mismatches camelCase columns — fetch a
        // window and filter by chatId in JS (fine for a personal bot's volume)
        const semantic = (await this.table.search(vector).limit(100).toArray()) as any[];

        const matches = semantic
          .filter((r) => r.chatId === chatId)
          .slice(0, semanticK);
        for (const r of matches) {
          // Deduplicate: skip if already in recent
          const isDup = recent.some((m) => m.text === r.text && m.role === r.role);
          if (!isDup) {
            results.push({ role: r.role, text: r.text });
          }
        }
      } catch (err) {
        console.error("[Memory] Semantic recall failed (non-fatal):", err);
      }
    }

    return results;
  }

  // ── Model overrides (persisted in LanceDB) ────────────────────

  // ── Model overrides (JSON file — lancedb where/delete silently fails on camelCase) ──

  private overridesPath(): string {
    return join(process.env.WORKSPACE_DIR || process.cwd(), "model-overrides.json");
  }

  private readOverrides(): Record<string, string> {
    try {
      return JSON.parse(readFileSync(this.overridesPath(), "utf-8"));
    } catch {
      return {};
    }
  }

  private writeOverrides(map: Record<string, string>): void {
    mkdirSync(dirname(this.overridesPath()), { recursive: true });
    writeFileSync(this.overridesPath(), JSON.stringify(map, null, 2));
  }

  setModelOverride(chatId: number, modelId: string): void {
    const map = this.readOverrides();
    map[String(chatId)] = modelId;
    this.writeOverrides(map);
  }

  getModelOverride(chatId: number): string | null {
    return this.readOverrides()[String(chatId)] || null;
  }

  clearModelOverride(chatId: number): void {
    const map = this.readOverrides();
    delete map[String(chatId)];
    this.writeOverrides(map);
  }

  // ── Distilled facts (long-term user knowledge) ────────────────

  /** Store a distilled fact. Fresh rows win at recall time (sorted by updatedAt). */
  async addFact(
    text: string,
    kind: "fact" | "behavior",
    chatId: number,
  ): Promise<void> {
    if (!this.initialized) await this.init();
    try {
      const vector = await this.embed(text);
      const now = Date.now();
      await this.factsTable.add([
        {
          id: randomUUID(),
          text,
          kind,
          chatId,
          createdAt: now,
          updatedAt: now,
          vector,
        },
      ]);
    } catch (err: any) {
      console.error("[Memory] addFact failed:", err.message);
    }
  }

  /** Semantic search over distilled facts, newest first. */
  async searchFacts(
    query: string,
    chatId: number,
    k = 4,
  ): Promise<Array<{ text: string; kind: string; updatedAt: number }>> {
    if (!this.initialized) await this.init();
    try {
      const vector = await this.embed(query);
      // lancedb 0.17 where() silently mismatches camelCase columns - filter in JS
      const rows = (await this.factsTable.search(vector).limit(200).toArray()) as any[];
      return rows
        .filter((r) => r.chatId === chatId && r.id !== "__init__")
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, k)
        .map((r) => ({ text: r.text, kind: r.kind, updatedAt: r.updatedAt }));
    } catch (err: any) {
      console.error("[Memory] searchFacts failed:", err.message);
      return [];
    }
  }

  /** Recent distilled fact texts for a chat (distiller dedup prompt). */
  async listRecentFacts(chatId: number, limit = 30): Promise<string[]> {
    if (!this.initialized) await this.init();
    try {
      const rows = (await this.factsTable.query().toArray()) as any[];
      return rows
        .filter((r) => r.chatId === chatId && r.id !== "__init__")
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, limit)
        .map((r) => r.text);
    } catch {
      return [];
    }
  }

  /** Get embedding vector from local Ollama, fallback to zero vector */
  private async embed(text: string): Promise<number[]> {
    try {
      const res = await fetch(`http://${OLLAMA_BASE}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
      });

      if (!res.ok) {
        throw new Error(`Ollama embeddings HTTP ${res.status}`);
      }

      const data = (await res.json()) as { embedding: number[] };
      return data.embedding;
    } catch (err: any) {
      console.error("[Memory] Embedding failed, using zero vector:", err.message);
      return new Array(768).fill(0);
    }
  }
}

// Singleton
export const memory = new LongTermMemory();
