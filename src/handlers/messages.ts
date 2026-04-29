/**
 * handlers/messages.ts — Core message handler with preemptive queue.
 *
 * Flow per incoming message:
 *  1. Extract query (text / voice / photo)
 *  2. Determine route (model selection)
 *  3. Notify user which model was selected
 *  4. Store user message in memory
 *  5. Recall conversation history
 *  6. Enqueue in chatQueue:
 *       - If the LLM is still answering the previous message → abort it,
 *         send "⏩ Skipping…" to the user, run with the new query.
 *       - If nothing is running → start immediately.
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { extractMessage } from "../services/message-handler.js";
import { sendChunkedResponse } from "../helpers/response.js";
import { cleanResponse } from "../helpers/markdown.js";
import { SmartRouter } from "../router.js";
import type { RouteResult } from "../router.js";
import { executeAgentTask } from "../agent.js";
import { memory } from "../memory.js";
import { chatQueue } from "../services/chat-queue.js";
import type { ChatTask } from "../services/chat-queue.js";

export function registerMessageHandler(bot: Bot): void {
  bot.on(["message:text", "message:voice", "message:photo"], async (ctx: Context) => {
    // 1. Extract query from message
    const extracted = await extractMessage(ctx);
    if (!extracted || !extracted.query.trim()) return;
    const { query, imagePath } = extracted;

    const chatId = ctx.chat?.id ?? 0;
    console.log(`[In] chat=${chatId}: ${query.slice(0, 100)}`);

    // 2. Determine route (image → vision, else → router or manual override)
    const route = imagePath
      ? buildVisionRoute()
      : await getEffectiveRoute(query, chatId);

    // 3. Notify user about model
    const hasOverride = config.userModelOverride.has(chatId);
    const icon = hasOverride ? "🔀" : "🤖";
    await ctx.reply(
      `${icon} <code>${route.model}</code> | ${route.reason} | ${route.type}`,
      { parse_mode: "HTML" },
    );

    // 4. Store user message in memory (fire-and-forget)
    try { await memory.remember(query, { role: "user", chatId }); } catch (_) {}

    // 5. Recall conversation history
    let ctxPrefix = "";
    try {
      const past = await memory.recall(query, chatId, 4, 4);
      if (past.length > 0) {
        ctxPrefix =
          `<conversation_history>\n` +
          past.map((m, i) => `${i + 1}. [${m.role}]: ${m.text}`).join("\n") +
          `\n</conversation_history>\n\n`;
      }
    } catch (_) {}

    ctx.replyWithChatAction("typing").catch(() => {});

    // 6. Enqueue — may abort a running LLM task for this chat
    chatQueue.enqueue(
      chatId,
      { query, ctxPrefix, imagePath },
      (task: ChatTask) => runAgentTask(ctx, task, route),
      () => {
        // Called when a previous task is being aborted
        ctx.reply("⏩ Отменяю предыдущий запрос, обрабатываю новый…").catch(() => {});
      },
    );
  });
}

// ── Task runner (called by the queue) ──────────────────────────────

async function runAgentTask(
  ctx: Context,
  task: ChatTask,
  route: RouteResult,
): Promise<void> {
  // Keep the typing indicator alive while processing
  const typingInterval = setInterval(() => {
    ctx.replyWithChatAction("typing").catch(() => {});
  }, 4000);

  try {
    const raw = await executeAgentTask(
      task.ctxPrefix + task.query,
      route,
      task.imagePath,
      task.signal,          // ← pass the abort signal
    );

    // If we got aborted between the LLM finishing and here, skip reply
    if (task.signal.aborted) return;

    // Store assistant response (cleaned, for memory/history)
    const chatId = ctx.chat?.id ?? 0;
    try { await memory.remember(cleanResponse(raw), { role: "assistant", chatId }); } catch (_) {}

    // sendChunkedResponse handles its own cleaning + chunking
    await sendChunkedResponse(ctx, raw);
  } catch (err: any) {
    // Suppress expected AbortError (user sent a newer message)
    if (err?.name === "AbortError") {
      console.log("[Agent] Task preempted — suppressing error");
      return;
    }

    console.error("[Agent]", err.message);
    const chatId = ctx.chat?.id ?? 0;
    await handleAgentError(ctx, err, route, task.ctxPrefix, task.query, task.imagePath, task.signal);
  } finally {
    clearInterval(typingInterval);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function buildVisionRoute(): RouteResult {
  return {
    model: "ollama/minicpm-v:8b-2.6-q4_K_M",
    type: "local" as const,
    reason: "image",
    baseUrl: `http://${config.ollamaHost}/v1`,
    apiKey: "ollama",
  };
}

async function getEffectiveRoute(
  query: string,
  chatId: number,
): Promise<RouteResult> {
  const manual = config.userModelOverride.get(chatId);
  if (manual) {
    return {
      model: manual,
      type: config.isLocalModel(manual) ? "local" : "cloud",
      reason: "manual",
      baseUrl: config.isLocalModel(manual)
        ? `http://${config.ollamaHost}/v1`
        : "https://api.deepseek.com/v1",
      apiKey: config.isLocalModel(manual)
        ? "ollama"
        : config.deepseekApiKey,
    };
  }
  return SmartRouter.route(query, []);
}

async function handleAgentError(
  ctx: Context,
  err: Error,
  route: RouteResult,
  ctxPrefix: string,
  query: string,
  imagePath?: string,
  signal?: AbortSignal,
): Promise<void> {
  // Local failure → try cloud fallback (but NOT for images — cloud doesn't support them)
  if (route.type === "local" && config.hasCloudAccess) {
    if (imagePath) {
      await ctx.reply("⚠️ Локальная vision-модель недоступна. Облачные модели не поддерживают изображения.");
      return;
    }
    await ctx.reply("⚠️ Локальная модель недоступна, пробую облако...");
    try {
      const cr: RouteResult = {
        model: config.cloudModels[1].id, // flash
        type: "cloud",
        reason: "fallback",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: config.deepseekApiKey,
      };
      const raw = await executeAgentTask(ctxPrefix + query, cr, undefined, signal);
      if (signal?.aborted) return;
      await sendChunkedResponse(ctx, raw);
    } catch (fbErr: any) {
      if (fbErr?.name === "AbortError") return;
      await ctx.reply(`❌ Облако тоже не ответило: ${fbErr.message}`);
    }
  } else if (route.type === "local") {
    await ctx.reply(`❌ Ошибка (нет облачного ключа): ${err.message}`);
  } else {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
}