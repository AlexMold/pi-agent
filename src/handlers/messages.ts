/**
 * handlers/messages.ts — Core message handler with preemptive queue.
 *
 * Flow per incoming message:
 *  1. Extract query (text / voice / photo)
 *  2. Determine route (model selection)
 *  3. Notify user which model was selected
 *  4. Store user message in memory
 *  5. Capture replied-to message from Telegram
 *  6. Recall conversation history
 *  7. Enqueue in chatQueue:
 *       - If the LLM is still answering the previous message → abort it,
 *         send "⏩ Skipping…" to the user, run with the new query.
 *       - If nothing is running → start immediately.
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { extractMessage, extractReplyContext } from "../services/message-handler.js";
import { sendChunkedResponse } from "../helpers/response.js";
import { cleanResponse } from "../helpers/markdown.js";
import { SmartRouter } from "../router.js";
import type { RouteResult } from "../router.js";
import { executeAgentTaskWithUsage } from "../agent.js";
import { memory } from "../memory.js";
import { chatQueue } from "../services/chat-queue.js";
import type { ChatTask } from "../services/chat-queue.js";
import { ensureModelStatus } from "./callbacks.js";
import { recordUsage, calcCost } from "../services/usage-tracker.js";

export function registerMessageHandler(bot: Bot): void {
  bot.on(["message:text", "message:voice", "message:photo"], async (ctx: Context) => {
    // 1. Extract query and (in parallel) the reply context, if any
    const [extracted, replyCtx] = await Promise.all([
      extractMessage(ctx),
      extractReplyContext(ctx),
    ]);
    if (!extracted || !extracted.query.trim()) return;
    const { query, imagePath: userImagePath } = extracted;
    // If the user is replying to a photo, the bot re-attached that photo to
    // give the LLM visual context. That overrides any image the user just sent.
    const imagePath = replyCtx?.imagePath ?? userImagePath;

    const chatId = ctx.chat?.id ?? 0;
    console.log(`[In] chat=${chatId}: ${query.slice(0, 100)}`);

    // 2. Determine route (image → vision, else → router or manual override)
    // But respect manual model override even for images
    const route = imagePath && !config.userModelOverride.has(chatId)
      ? buildVisionRoute()
      : await getEffectiveRoute(query, chatId);

    // 3. Notify user about model
    const hasOverride = config.userModelOverride.has(chatId);
    const icon = hasOverride ? "🔀" : "🤖";
    await ctx.reply(
      `${icon} <code>${route.model}</code> | ${route.reason} | ${route.type}`,
      { parse_mode: "HTML" },
    );

    // 3b. Sync pinned status (only updates if model actually changed)
    ensureModelStatus(ctx, hasOverride, route).catch(() => {});

    // 4. Store user message in memory (fire-and-forget)
    try { await memory.remember(query, { role: "user", chatId }); } catch (err: any) { console.error("[Memory] remember failed:", err.message); }

    // 5. Build reply context prefix from the new extractReplyContext helper.
    //    Handles text/caption + media placeholders, bot-message tagging, and
    //    a 1-hop chain walk.
    let replyContext = "";
    if (replyCtx) {
      const chain = replyCtx.parentText
        ? `${replyCtx.parentText}\n↳ ${replyCtx.text}`
        : replyCtx.text;
      replyContext =
        `<replied_to kind="${replyCtx.kind}" author="${replyCtx.authorRole}">\n` +
        `${chain}\n</replied_to>\n\n`;
      console.log(
        `[Reply] user replied to ${replyCtx.kind}/${replyCtx.authorRole} ` +
        `(chain=${replyCtx.hasParent}): ${replyCtx.text.slice(0, 80)}`,
      );
      // Persist the immediate reply target in memory (semantic recall)
      try {
        await memory.remember(
          `[Reply to]: ${replyCtx.text}`,
          { role: replyCtx.authorRole, chatId },
        );
      } catch (_) {}
    }

    // 6. Recall conversation history
    let ctxPrefix = `<chat_id>${chatId}</chat_id>\n\n${replyContext}`;
    try {
      // The pi session carries recent turns; inject only semantic matches
      const past = await memory.recall(query, chatId, 0, 4);
      if (past.length > 0) {
        ctxPrefix +=
          `<conversation_history>\n` +
          past.map((m, i) => `${i + 1}. [${m.role}]: ${m.text}`).join("\n") +
          `\n</conversation_history>\n\n`;
      }
    } catch (_) {}

    ctx.replyWithChatAction("typing").catch(() => {});

    // 7. Enqueue — may abort a running LLM task for this chat
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
    const chatId = ctx.chat?.id ?? 0;
    const result = await executeAgentTaskWithUsage(
      task.ctxPrefix + task.query,
      route,
      task.imagePath,
      task.signal,          // ← pass the abort signal
      chatId ? String(chatId) : undefined,  // persistent per-chat session
    );
    const raw = result.text;
    const usage = result.usage;

    // If we got aborted between the LLM finishing and here, skip reply
    if (task.signal.aborted) return;

    // Store assistant response (cleaned, for memory/history)
    try { await memory.remember(cleanResponse(raw), { role: "assistant", chatId }); } catch (err: any) { console.error("[Memory] remember failed:", err.message); }

    // Record token usage + cost (fire-and-forget)
    recordUsage({
      chatId,
      model: route.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cost: calcCost(route.model, usage.inputTokens, usage.outputTokens),
      timestamp: Date.now(),
      queryLen: task.query.length,
    });

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
    model: "google/gemini-2.5-flash",
    type: "cloud" as const,
    reason: "image",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: config.geminiApiKey,
  };
}

async function getEffectiveRoute(
  query: string,
  chatId: number,
): Promise<RouteResult> {
  // Check LanceDB for persisted model override (survives restarts)
  if (!config.userModelOverride.has(chatId)) {
    const persisted = await memory.getModelOverride(chatId);
    if (persisted) {
      config.userModelOverride.set(chatId, persisted);
      console.log(`[Model] Restored override for chat ${chatId}: ${persisted}`);
    }
  }

  const manual = config.userModelOverride.get(chatId);
  if (manual) {
    const isLocal = config.isLocalModel(manual);
    const isGemini = manual.includes("gemini");
    return {
      model: manual,
      type: isLocal ? "local" : "cloud",
      reason: "manual",
      baseUrl: isLocal
        ? `http://${config.llamaHost}/v1`
        : isGemini
          ? "https://generativelanguage.googleapis.com/v1beta"
          : "https://api.deepseek.com/v1",
      apiKey: isLocal
        ? "ollama"
        : isGemini
          ? config.geminiApiKey
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
      const fbResult = await executeAgentTaskWithUsage(
        ctxPrefix + query,
        cr,
        undefined,
        signal,
        ctx.chat?.id != null ? String(ctx.chat.id) : undefined,
      );
      if (signal?.aborted) return;
      recordUsage({
        chatId: ctx.chat?.id ?? 0,
        model: cr.model,
        inputTokens: fbResult.usage.inputTokens,
        outputTokens: fbResult.usage.outputTokens,
        cost: calcCost(cr.model, fbResult.usage.inputTokens, fbResult.usage.outputTokens),
        timestamp: Date.now(),
        queryLen: query.length,
      });
      await sendChunkedResponse(ctx, fbResult.text);
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