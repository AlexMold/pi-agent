/**
 * SmartRouter — LLM-powered model routing via tiny local llama-server.
 *
 * Flow:
 *  1. Token overflow (>100k) → cloud (instant, no LLM call)
 *  2. Tiny local model (Qwen 3.5-1B via llama-server) classifies query →
 *     picks best model from available pool
 *  3. Fallback: keyword matching if LLM unavailable
 */

import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");
const LLAMA_BASE = process.env.LLAMA_HOST || "host.docker.internal:8081";

// ── Model pool ───────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  description: string;
  type: "local" | "cloud";
  baseUrl: string;
  apiKey: string;
}

const MODELS: Record<string, ModelEntry> = {
  // One tiny local model for routing + simple tasks
  "llama/llama3.2-1b": {
    id: "llama/llama3.2-1b",
    description: "лёгкая 1.2B — простые вопросы, приветствия, быстрые ответы",
    type: "local",
    baseUrl: `http://${LLAMA_BASE}/v1`,
    apiKey: "ollama",
  },
  "deepseek/deepseek-v4-pro": {
    id: "deepseek/deepseek-v4-pro",
    description: "облачная — рефакторинг, аудит безопасности, миграции, сверхбольшой контекст",
    type: "cloud",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
  },
  "deepseek/deepseek-v4-flash": {
    id: "deepseek/deepseek-v4-flash",
    description: "облачная быстрая — средние задачи когда локальная занята или недоступна",
    type: "cloud",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
  },
  "google/gemini-2.5-flash": {
    id: "google/gemini-2.5-flash",
    description: "облачная vision — изображения, скриншоты, фото",
    type: "cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: process.env.GEMINI_API_KEY || "",
  },
};

// Default: local model if available, otherwise cloud
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "llama/llama3.2-1b";
const FALLBACK_CLOUD = "deepseek/deepseek-v4-flash";

// ── Router classifier prompt (simplified — fewer options) ────────────

const CLASSIFIER_SYSTEM = `Ты — умный роутер AI-ассистента. Твоя задача: проанализировать запрос пользователя и выбрать лучшую модель из списка.

Правила:
1. Для простых вопросов, приветствий — облачная быстрая (deepseek-v4-flash)
2. Для изображений/скриншотов — vision (gemini-2.5-flash)
3. Для РЕФАКТОРИНГА, АУДИТА безопасности, МИГРАЦИЙ, анализа больших объёмов — облачная (deepseek-v4-pro)
4. Для ПОИСКА В ИНТЕРНЕТЕ, поиска информации, новостей, цен, товаров — облачная быстрая (deepseek-v4-flash)
5. По умолчанию используй облачную быструю модель

Ответь СТРОГО в JSON:
{"model": "ID модели", "reason": "краткое объяснение на русском"}`;

// Local Ollama for classification (fast & free)
const OLLAMA_CLASSIFY_URL = `http://${process.env.OLLAMA_HOST || "localhost:11434"}/v1/chat/completions`;
const OLLAMA_CLASSIFY_MODEL = "qwen2.5:0.5b";

// ── Router class ─────────────────────────────────────────────────────

export interface RouteResult {
  model: string;
  type: "local" | "cloud";
  reason: string;
  baseUrl: string;
  apiKey: string;
}

export class SmartRouter {
  static countTokens(text: string): number {
    return enc.encode(text).length;
  }

  /**
   * Main routing method.
   * Token overflow → cloud instantly.
   * Otherwise → LLM classifier (tiny model via llama-server).
   */
  static async route(
    prompt: string,
    messages: string[],
  ): Promise<RouteResult> {
    const fullText = prompt + " " + messages.join(" ");
    const tokens = this.countTokens(fullText);

    // 1. Token overflow → cloud (instant, no LLM)
    if (tokens > 100_000) {
      return this.buildResult(
        "deepseek/deepseek-v4-pro",
        `overflow (${tokens} токенов > 100K)`,
      );
    }

    // 2. Try tiny LLM classifier via llama-server
    try {
      const classification = await this.classify(prompt);
      if (classification && MODELS[classification.model]) {
        return this.buildResult(classification.model, classification.reason);
      }
    } catch (err) {
      console.warn("[Router] LLM classifier failed, falling back to keywords:", err);
    }

    // 3. Fallback: keyword matching
    return this.keywordRoute(prompt);
  }

  /** Sync version for backward compat — uses keyword routing only */
  static routeSync(prompt: string, messages: string[]): RouteResult {
    const fullText = prompt + " " + messages.join(" ");
    const tokens = this.countTokens(fullText);
    if (tokens > 100_000) {
      return this.buildResult("deepseek/deepseek-v4-pro", `overflow (${tokens} токенов > 100K)`);
    }
    return this.keywordRoute(prompt);
  }

  // ── Private ──────────────────────────────────────────────────────

  private static buildResult(modelId: string, reason: string): RouteResult {
    const entry = MODELS[modelId] || MODELS[DEFAULT_MODEL];
    return {
      model: entry.id,
      type: entry.type,
      reason,
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
    };
  }

  /** Call local Ollama (qwen2.5:0.5b) to classify the query — ultra-fast */
  private static async classify(
    prompt: string,
  ): Promise<{ model: string; reason: string } | null> {
    const modelList = Object.entries(MODELS)
      .map(([id, m]) => `${id} — ${m.description}`)
      .join("\n");

    const body = JSON.stringify({
      model: OLLAMA_CLASSIFY_MODEL,
      messages: [
        { role: "system", content: `${CLASSIFIER_SYSTEM}\n\nДоступные модели:\n${modelList}` },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      max_tokens: 100,
      stream: false,
    });

    try {
      const res = await fetch(OLLAMA_CLASSIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        console.warn(`[Router] classify HTTP ${res.status}`);
        return null;
      }

      const data = (await res.json()) as any;
      const text: string = data.choices?.[0]?.message?.content || "";
      const json = text.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return null;
      const parsed = JSON.parse(json);
      if (!parsed.model || !parsed.reason) return null;
      console.log(`[Router] Ollama classify → ${parsed.model}: ${parsed.reason}`);
      return { model: parsed.model, reason: parsed.reason };
    } catch (err: any) {
      console.warn("[Router] classify failed:", err.message);
      return null;
    }
  }

  /** Keyword-based fallback */
  private static keywordRoute(prompt: string): RouteResult {
    const p = prompt.toLowerCase();

    if (
      /архитектур|refactor|рефактор|optimiz|оптимиз|security|безопасност|migrate|миграц|аудит|audit/i.test(p)
    ) {
      return this.buildResult("deepseek/deepseek-v4-pro", "complexity (keywords)");
    }

    if (
      /найди|поиск|search|find|google|цены|price|купить|новости|news|тренды|trends|сколько стоит|where to buy/i.test(p)
    ) {
      return this.buildResult("deepseek/deepseek-v4-flash", "web search (keywords)");
    }

    // Simple chat → cloud fast
    if (
      /^(привет|hi|hello|здравствуй|как дела|hey|добр(ый|ое)|who are you|кто ты)/i.test(p) &&
      p.length < 40
    ) {
      return this.buildResult(FALLBACK_CLOUD, "simple chat (keywords)");
    }

    // Default → cloud fast
    return this.buildResult(FALLBACK_CLOUD, "default (efficiency)");
  }
}
