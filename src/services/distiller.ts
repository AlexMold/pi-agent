/**
 * services/distiller.ts — weekly memory distillation + session compaction.
 *
 * For every chat session file modified since the last run:
 *   1. Read user/assistant messages from the session jsonl
 *   2. One DeepSeek flash call extracts durable facts + a conversation digest
 *   3. Facts are deduped against known ones and stored in the facts table
 *   4. Session compaction: the file is archived and a digest file is left
 *      behind; the next message starts a fresh session seeded with it
 *
 * Facts survive forever; the conversational context stays small.
 */

import fs from "fs";
import { join } from "path";
import { memory } from "../memory.js";

const IDLE_MS = 10 * 60 * 1000; // don't rotate chats active in the last 10 min
const MAX_MESSAGES = 400; // per-chat cap per run
const TRANSCRIPT_CHAR_CAP = 60_000; // hard cap on the LLM prompt size
const LLM_URL = "https://api.deepseek.com/v1/chat/completions";
const LLM_MODEL = "deepseek-v4-flash";

export interface DistillStats {
  chats: number;
  factsAdded: number;
  factsSkipped: number;
  rotated: number;
  skippedActive: number;
  errors: number;
}

function sessionsDir(): string {
  return join(process.env.WORKSPACE_DIR || process.cwd(), "sessions");
}

function statePath(): string {
  return join(process.env.WORKSPACE_DIR || process.cwd(), "distill-state.json");
}

function readState(): { lastRun: number } {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf-8"));
  } catch {
    return { lastRun: 0 };
  }
}

function writeState(state: { lastRun: number }): void {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/** chat id from a session file name: "2026-..._chat_123.jsonl" → 123 */
function parseChatId(file: string): number | null {
  const m = file.match(/chat_(-?\d+)\.jsonl$/);
  return m ? parseInt(m[1], 10) : null;
}

/** Pull user/assistant texts out of a session jsonl. */
function readMessages(path: string): Array<{ role: string; text: string }> {
  const lines = fs.readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const messages: Array<{ role: string; text: string }> = [];
  for (const line of lines) {
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = entry.message?.content;
    const text = Array.isArray(content)
      ? content
          .filter((c: any) => c.type === "text" && c.text)
          .map((c: any) => c.text)
          .join(" ")
      : typeof content === "string"
        ? content
        : "";
    if (text.trim()) messages.push({ role, text });
  }
  return messages;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Distill one chat: one LLM call → facts (deduped against `existing`)
 * + a conversation digest. Throws on LLM failure — caller decides.
 */
export async function distillChat(
  chatId: number,
  messages: Array<{ role: string; text: string }>,
  existing: string[],
): Promise<{ added: number; skipped: number; digest: string | null }> {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "Пользователь" : "Бот"}: ${m.text}`)
    .join("\n")
    .slice(0, TRANSCRIPT_CHAR_CAP);

  const known =
    existing.length > 0
      ? `Уже известные факты (не дублируй их):\n${existing.map((f) => `- ${f}`).join("\n")}`
      : "Известных фактов пока нет.";

  const system = `Ты извлекаешь устойчивые знания из переписки пользователя с ИИ-ассистентом.
Верни СТРОГО JSON без markdown: {"facts": [{"text": "...", "kind": "fact" | "behavior"}], "digest": "..."}
- kind "fact" — устойчивые факты о пользователе: имена, проекты, работа, планы, окружение, важные решения.
- kind "behavior" — предпочтения по поведению ассистента: стиль, формат, длина ответов ("отвечай короче").
- Только долговечное: разговорный мусор, одноразовые вопросы и переходные детали игнорируй.
- Не дублируй уже известные факты. Если факт изменился — верни новую версию формулировки.
- digest — 2-4 предложения о чём была последняя часть диалога, чтобы продолжить разговор в новой сессии.`;

  const res = await fetch(LLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `${known}\n\nСообщения сессии:\n${transcript}` },
      ],
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);

  const data: any = await res.json();
  const text: string = data.choices?.[0]?.message?.content || "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("LLM returned no JSON object");
  const parsed = JSON.parse(json);

  const facts = Array.isArray(parsed.facts) ? parsed.facts.slice(0, 50) : [];
  const digest =
    typeof parsed.digest === "string" && parsed.digest.trim()
      ? parsed.digest.trim()
      : null;

  const knownNorm = new Set(existing.map((f) => normalize(f)));
  let added = 0;
  let skipped = 0;
  for (const f of facts) {
    if (!f || typeof f.text !== "string" || !f.text.trim()) continue;
    if (knownNorm.has(normalize(f.text))) {
      skipped++;
      continue;
    }
    const kind = f.kind === "behavior" ? "behavior" : "fact";
    await memory.addFact(f.text.trim(), kind, chatId);
    knownNorm.add(normalize(f.text));
    added++;
  }
  return { added, skipped, digest };
}

/** Weekly entry point: distill all chats modified since the last run. */
export async function runDistillation(): Promise<DistillStats> {
  const stats: DistillStats = {
    chats: 0,
    factsAdded: 0,
    factsSkipped: 0,
    rotated: 0,
    skippedActive: 0,
    errors: 0,
  };

  const dir = sessionsDir();
  if (!fs.existsSync(dir)) return stats;

  const { lastRun } = readState();

  const files = fs
    .readdirSync(dir)
    .filter((f) => /chat_-?\d+\.jsonl$/.test(f));

  for (const file of files) {
    const path = join(dir, file);
    const chatId = parseChatId(file);
    if (chatId === null) continue;

    const mtime = fs.statSync(path).mtimeMs;
    if (mtime <= lastRun) continue;
    // Active chat: rotating it could lose messages appended mid-distill
    if (Date.now() - mtime < IDLE_MS) {
      stats.skippedActive++;
      continue;
    }

    try {
      const messages = readMessages(path).slice(-MAX_MESSAGES);
      if (messages.length === 0) continue;

      const existing = await memory.listRecentFacts(chatId, 30);
      const result = await distillChat(chatId, messages, existing);
      stats.factsAdded += result.added;
      stats.factsSkipped += result.skipped;
      stats.chats++;

      // Post-distill compaction: archive the session, leave the digest.
      // The next message starts a fresh session seeded with the digest.
      if (result.digest) {
        fs.writeFileSync(join(dir, `chat_${chatId}.digest.md`), result.digest);
        const archiveDir = join(dir, "archive");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(path, join(archiveDir, `${Date.now()}_${file}`));
        stats.rotated++;
      }

      console.log(
        `[Distill] chat=${chatId}: facts +${result.added}/-${result.skipped}, rotated=${result.digest ? "yes" : "no"}`,
      );
    } catch (err: any) {
      stats.errors++;
      console.error(`[Distill] chat ${chatId} failed:`, err.message);
    }
  }

  writeState({ lastRun: Date.now() });
  console.log(
    `[Distill] done: chats=${stats.chats}, facts +${stats.factsAdded}, rotated=${stats.rotated}, errors=${stats.errors}`,
  );
  return stats;
}
