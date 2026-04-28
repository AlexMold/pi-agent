/**
 * LongTermMemory — Hybrid: LanceDB (semantic) + in-memory ring buffer (recent).
 *
 * - Recent messages (last 20 per chat): always injected as conversation history
 * - Semantic search (top 5): LanceDB for long-term recall
 */

import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table } from "@lancedb/lancedb";

const OLLAMA_BASE = process.env.OLLAMA_HOST || "host.docker.internal:11434";

interface Message {
  role: string;
  text: string;
}

// ── Ring buffer for recent messages ──────────────────────────────────
const MAX_RECENT = 20;
const recentByChat = new Map<number, Message[]>();

function pushRecent(chatId: number, msg: Message) {
  const list = recentByChat.get(chatId) || [];
  list.push(msg);
  if (list.length > MAX_RECENT) list.shift();
  recentByChat.set(chatId, list);
}

function getRecent(chatId: number, n = 5): Message[] {
  const list = recentByChat.get(chatId) || [];
  return list.slice(-n);
}

// ── LanceDB for long-term semantic memory ────────────────────────────

export class LongTermMemory {
  private db!: Connection;
  private table!: Table;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    this.db = await lancedb.connect("memory_db/ai_context");
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

    this.initialized = true;
    console.log("[Memory] LanceDB + ring buffer initialized");
  }

  /** Store a message in both ring buffer and LanceDB */
  async remember(
    text: string,
    metadata: { role: string; chatId: number; timestamp?: number },
  ): Promise<void> {
    // Ring buffer (always works, no async dependency)
    pushRecent(metadata.chatId, { role: metadata.role, text });

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
   *  - N recent messages (always, chronological)
   *  - K semantic matches (LanceDB)
   * Deduplicated, recent first.
   */
  async recall(
    query: string,
    chatId: number,
    recentN = 4,
    semanticK = 4,
  ): Promise<Message[]> {
    const results: Message[] = [];

    // 1. Recent messages (always)
    const recent = getRecent(chatId, recentN);
    results.push(...recent);

    // 2. Semantic search
    if (this.initialized) {
      try {
        const vector = await this.embed(query);
        const semantic = await this.table
          .search(vector)
          .where(`"chatId" = ${chatId}`)
          .limit(semanticK)
          .toArray();

        for (const r of semantic as any[]) {
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

  /** Get embedding vector from local Ollama */
  private async embed(text: string): Promise<number[]> {
    const res = await fetch(`http://${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embeddings failed: ${res.statusText}`);
    }

    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }
}

// Singleton
export const memory = new LongTermMemory();
