/**
 * services/usage-tracker.ts — Token usage & cost tracking.
 *
 * Records per-message LLM usage in LanceDB (table: `usage`).
 * Pricing table is hardcoded (USD per 1M tokens) for known cloud models.
 * Local models cost 0.
 *
 * Best-effort, fire-and-forget: failures are logged, never throw.
 */

import { memory } from "../memory.js";

// ── Pricing (USD per 1M tokens) ──────────────────────────────────────
// Source: provider pricing pages, June 2026
const PRICING: Record<string, { in: number; out: number }> = {
  "deepseek/deepseek-v4-pro":   { in: 0.27,  out: 1.10 },
  "deepseek/deepseek-v4-flash": { in: 0.02,  out: 0.06 },
  "google/gemini-2.5-flash":    { in: 0.075, out: 0.30 },
  "llama/llama3.2-1b":          { in: 0,     out: 0    }, // local
};

export interface UsageRecord {
  chatId: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;       // USD
  timestamp: number;
  queryLen: number;   // for debugging / context sizing
}

/** Calculate USD cost for a model + token counts. */
export function calcCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

/** Record a usage entry. Fire-and-forget; never throws. */
export function recordUsage(rec: UsageRecord): void {
  memory
    .recordUsage(rec)
    .catch((err: any) =>
      console.error("[Usage] recordUsage failed (non-fatal):", err.message),
    );
}

export interface UsageStats {
  messages: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  byModel: Array<{ model: string; messages: number; cost: number }>;
  rangeStart?: number;
  rangeEnd?: number;
}

/** Get aggregated stats for a user. Optional time range in ms. */
export async function getStats(
  chatId: number,
  sinceMs?: number,
): Promise<UsageStats> {
  const rows = await memory.getUsage(chatId, sinceMs);

  const byModelMap = new Map<
    string,
    { messages: number; cost: number }
  >();

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let rangeStart: number | undefined;
  let rangeEnd: number | undefined;

  for (const r of rows) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    cost += r.cost;
    if (rangeStart === undefined || r.timestamp < rangeStart)
      rangeStart = r.timestamp;
    if (rangeEnd === undefined || r.timestamp > rangeEnd)
      rangeEnd = r.timestamp;

    const entry = byModelMap.get(r.model) ?? { messages: 0, cost: 0 };
    entry.messages += 1;
    entry.cost += r.cost;
    byModelMap.set(r.model, entry);
  }

  return {
    messages: rows.length,
    inputTokens,
    outputTokens,
    cost,
    byModel: Array.from(byModelMap.entries())
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.cost - a.cost),
    rangeStart,
    rangeEnd,
  };
}
