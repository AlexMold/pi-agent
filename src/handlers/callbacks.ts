/**
 * handlers/callbacks.ts — Inline callback query handlers (model selection).
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { buildModelKeyboard } from "./commands.js";

// ── Pinned status message tracker ───────────────────────────────
const statusMessageIds = new Map<number, number>();

async function updateStatusMessage(ctx: Context, modelId: string) {
  const chatId = ctx.chat?.id ?? 0;

  if (modelId === "auto") {
    const text = "🔁 <b>Auto</b> — SmartRouter выбирает модель автоматически";
    await upsertPinned(ctx, chatId, text);
  } else {
    const label = config.findModel(modelId)?.label || modelId;
    const text = `🔀 <b>${label}</b> — модель зафиксирована`;
    await upsertPinned(ctx, chatId, text);
  }
}

async function upsertPinned(
  ctx: Context,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    // Try to unpin all bot messages first (cleanup old pins)
    const existingId = statusMessageIds.get(chatId);
    if (existingId) {
      try {
        await ctx.api.unpinChatMessage(chatId, existingId);
      } catch {
        // Old pin might be already removed — ignore
      }
    }

    // Send new status and pin it
    const msg = await ctx.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_notification: true,
    });
    await ctx.api.pinChatMessage(chatId, msg.message_id, {
      disable_notification: true,
    });
    statusMessageIds.set(chatId, msg.message_id);
  } catch {
    // Bot not admin or pin failed — just send without pinning
    const msg = await ctx.api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_notification: true,
    });
    statusMessageIds.set(chatId, msg.message_id);
  }
}

// ── Public API for messages.ts ──────────────────────────────────
export async function ensureModelStatus(
  ctx: Context,
  hasOverride: boolean,
  route: { model: string },
): Promise<void> {
  if (hasOverride) {
    await updateStatusMessage(ctx, route.model);
  } else {
    await updateStatusMessage(ctx, "auto");
  }
}

// ── Callback handler ────────────────────────────────────────────

export function registerCallbacks(bot: Bot): void {
  bot.callbackQuery(/^model:(.+)$/, async (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const modelId = (ctx.match as string[])[1];

    if (modelId === "auto") {
      config.userModelOverride.delete(chatId);
      await ctx.answerCallbackQuery("🔁 Smart Router включён");
    } else {
      config.userModelOverride.set(chatId, modelId);
      const label = config.findModel(modelId)?.label || modelId;
      await ctx.answerCallbackQuery(`✅ ${label}`);
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
