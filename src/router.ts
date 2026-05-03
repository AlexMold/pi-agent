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
  "ollama/gemma4:latest": {
    id: "ollama/gemma4:latest",
    description: "лёгкая — простые вопросы, приветствия, быстрые ответы",
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

// Default: the tiny local model
const DEFAULT_MODEL = "ollama/gemma4:latest";

// ── Router classifier prompt (simplified — fewer options) ────────────

const CLASSIFIER_SYSTEM = `Ты — умный роутер AI-ассистента. Твоя задача: проанализировать запрос пользователя и выбрать лучшую модель из списка.

Правила:
1. Для односложных вопросов, приветствий — лёгкая локальная (gemma4:latest)
2. Для изображений/скриншотов — vision (gemini-2.5-flash)
3. Для РЕФАКТОРИНГА, АУДИТА безопасности, МИГРАЦИЙ, анализа больших объёмов — облачная (deepseek-v4-pro)
4. Для ПОИСКА В ИНТЕРНЕТЕ, поиска информации, новостей, цен, товаров — облачная быстрая (deepseek-v4-flash)
5. Экономь ресурсы: по умолчанию используй локальную модель

Ответь СТРОГО в JSON:
{"model": "ID модели", "reason": "краткое объяснение на русском"}`;

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

  /** Call tiny model via llama-server to classify the query */
  private static async classify(
    prompt: string,
  ): Promise<{ model: string; reason: string } | null> {
    const modelList = Object.entries(MODELS)
      .map(([id, m]) => `${id} — ${m.description}`)
      .join("\n");

    const res = await fetch(`http://${LLAMA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: `${CLASSIFIER_SYSTEM}\n\nДоступные модели:\n${modelList}` },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 100,
        stream: false,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as any;
    const text: string = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response (robust against markdown fences)
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;

    const parsed = JSON.parse(json);
    if (!parsed.model || !parsed.reason) return null;

    return { model: parsed.model, reason: parsed.reason };
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

    // Simple chat → local
    if (
      /^(привет|hi|hello|здравствуй|как дела|hey|добр(ый|ое)|who are you|кто ты)/i.test(p) &&
      p.length < 40
    ) {
      return this.buildResult(DEFAULT_MODEL, "simple chat (keywords)");
    }

    // Default → local
    return this.buildResult(DEFAULT_MODEL, "default (efficiency)");
  }
}
