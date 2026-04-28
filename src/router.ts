/**
 * SmartRouter — LLM-powered model routing via lightweight Ollama classifier.
 *
 * Flow:
 *  1. Token overflow (>100k) → cloud (instant, no LLM call)
 *  2. Lightweight LLM (gemma4:latest, 8B) classifies the query →
 *     picks best model from available pool
 *  3. Fallback: keyword matching if LLM unavailable
 */

import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");
const OLLAMA_BASE = process.env.OLLAMA_HOST || "host.docker.internal:11434";

// ── Model pool ───────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  description: string;
  type: "local" | "cloud";
  baseUrl: string;
  apiKey: string;
}

const MODELS: Record<string, ModelEntry> = {
  "ollama/gemma4:latest": {
    id: "ollama/gemma4:latest",
    description: "легковесная 8B — простые вопросы, приветствия, быстрые ответы",
    type: "local",
    baseUrl: `http://${OLLAMA_BASE}/v1`,
    apiKey: "ollama",
  },
  "ollama/gemma4:31b": {
    id: "ollama/gemma4:31b",
    description: "31B — основная рабочая: код, написание текстов, анализ, поиск",
    type: "local",
    baseUrl: `http://${OLLAMA_BASE}/v1`,
    apiKey: "ollama",
  },
  "ollama/qwen3.6:35b-a3b-q8_0": {
    id: "ollama/qwen3.6:35b-a3b-q8_0",
    description: "35B — сложный код, математика, архитектура, многошаговые задачи",
    type: "local",
    baseUrl: `http://${OLLAMA_BASE}/v1`,
    apiKey: "ollama",
  },
  "ollama/minicpm-v:8b-2.6-q4_K_M": {
    id: "ollama/minicpm-v:8b-2.6-q4_K_M",
    description: "8B vision — работа с изображениями, скриншотами",
    type: "local",
    baseUrl: `http://${OLLAMA_BASE}/v1`,
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
};

// Default model when nothing else matches
const DEFAULT_MODEL = "ollama/gemma4:31b";

// ── Router classifier prompt ─────────────────────────────────────────

const CLASSIFIER_SYSTEM = `Ты — умный роутер AI-ассистента. Твоя задача: проанализировать запрос пользователя и выбрать лучшую модель из списка.

Правила:
1. Для простых приветствий и болтовни — самая лёгкая модель (gemma4:latest)
2. Для кода, написания текстов, обычных вопросов — основная рабочая (gemma4:31b)
3. Для сложного кода, математики, архитектуры, многошаговых задач — мощная локальная (qwen3.6:35b)
4. Для изображений/скриншотов — vision модель (minicpm-v)
5. Для РЕФАКТОРИНГА, АУДИТА безопасности, МИГРАЦИЙ, анализа больших объёмов — облачная (deepseek-v4-pro)
6. Для ПОИСКА В ИНТЕРНЕТЕ, поиска информации, новостей, цен, товаров — облачная быстрая (deepseek-v4-flash)
7. Экономь ресурсы: по умолчанию используй локальные модели
8. Облачные модели — только когда задача явно этого требует

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
   * Otherwise → LLM classifier.
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

    // 2. Try LLM classifier
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

  /** Call lightweight Ollama model to classify the query */
  private static async classify(
    prompt: string,
  ): Promise<{ model: string; reason: string } | null> {
    const modelList = Object.entries(MODELS)
      .map(([id, m]) => `${id} — ${m.description}`)
      .join("\n");

    const res = await fetch(`http://${OLLAMA_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:latest", // 8B — very fast classification
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

    // Heavy → cloud
    if (
      /архитектур|refactor|рефактор|optimiz|оптимиз|security|безопасност|migrate|миграц|аудит|audit/i.test(p)
    ) {
      return this.buildResult("deepseek/deepseek-v4-pro", "complexity (keywords)");
    }

    // Search queries → cloud flash
    if (
      /найди|поиск|search|find|google|цены|price|купить|новости|news|тренды|trends|сколько стоит|where to buy/i.test(p)
    ) {
      return this.buildResult("deepseek/deepseek-v4-flash", "web search (keywords)");
    }
    if (
      /алгоритм|мат(ематик|ем)|вычислен|доказа(ть|тельство)|формула|алгебр|геометри|компиля(тор|цию)/i.test(p)
    ) {
      return this.buildResult("ollama/qwen3.6:35b-a3b-q8_0", "math/code (keywords)");
    }

    // Simple chat/greeting → lightweight
    if (
      /^(привет|hi|hello|здравствуй|как дела|hey|добр(ый|ое)|who are you|кто ты)/i.test(p) &&
      p.length < 40
    ) {
      return this.buildResult("ollama/gemma4:latest", "simple chat (keywords)");
    }

    // Default → workhorse
    return this.buildResult(DEFAULT_MODEL, "default (efficiency)");
  }
}
