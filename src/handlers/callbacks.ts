/**
 * handlers/callbacks.ts — Inline callback query handlers (model selection).
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { memory } from "../memory.js";
import { buildModelKeyboard } from "./commands.js";

// ── Track last known model per chat (not message IDs) ───────────
const lastModelStatus = new Map<number, string>(); // chatId → "auto" | "modelId"

async function updateStatusMessage(ctx: Context, modelId: string) {
  const chatId = ctx.chat?.id ?? 0;

  // Skip if same as last status
  if (lastModelStatus.get(chatId) === modelId) return;

  const text =
    modelId === "auto"
      ? "🔁 <b>Auto</b> — SmartRouter выбирает модель автоматически"
      : `🔀 <b>${config.findModel(modelId)?.label || modelId}</b> — модель зафиксирована`;

  try {
    // Clear all previous pins first (no need to track message IDs)
    await ctx.api.unpinAllChatMessages(chatId);
    // Send and pin new status
    const msg = await ctx.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_notification: true,
    });
    await ctx.api.pinChatMessage(chatId, msg.message_id, {
      disable_notification: true,
    });
    lastModelStatus.set(chatId, modelId);
  } catch {
    // Pin not available — just send
    try {
      await ctx.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_notification: true,
      });
    } catch {
      // ignore
    }
    lastModelStatus.set(chatId, modelId);
  }
}

// ── Public API for messages.ts ──────────────────────────────────
export async function ensureModelStatus(
  ctx: Context,
  hasOverride: boolean,
  route: { model: string },
): Promise<void> {
  const modelId = hasOverride ? route.model : "auto";
  await updateStatusMessage(ctx, modelId);
}

// ── Callback handler ────────────────────────────────────────────

export function registerCallbacks(bot: Bot): void {
  bot.callbackQuery(/^model:(.+)$/, async (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const modelId = (ctx.match as string[])[1];

    if (modelId === "auto") {
      config.userModelOverride.delete(chatId);
      await ctx.answerCallbackQuery("🔁 Smart Router включён");
      // Remove from LanceDB
      try { await memory.clearModelOverride(chatId); } catch {}
    } else {
      config.userModelOverride.set(chatId, modelId);
      const label = config.findModel(modelId)?.label || modelId;
      await ctx.answerCallbackQuery(`✅ ${label}`);
      // Persist in LanceDB
      try { await memory.setModelOverride(chatId, modelId); } catch {}
    }

    // Update the pinned status message
    const current = config.userModelOverride.get(chatId) || "auto";
    await updateStatusMessage(ctx, current);

    // Update the model selection keyboard
    const name =
      current === "auto"
        ? "🔁 Auto"
        : config.findModel(current)?.label || current;
    await ctx.editMessageText(
      `<b>Выбор модели</b>\n\nТекущая: <code>${name}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: buildModelKeyboard(current),
      },
    );
  });
}
