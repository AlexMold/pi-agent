/**
 * handlers/callbacks.ts — Inline callback query handlers (model selection).
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { memory } from "../memory.js";
import { buildModelKeyboard } from "./commands.js";
import { getStats } from "../services/usage-tracker.js";
import { InlineKeyboard } from "grammy";

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

  // Stats range switcher (24h / 7d / 30d / all)
  bot.callbackQuery(/^stats:(.+)$/, async (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const rangeKey = (ctx.match as string[])[1];

    const RANGES: Record<string, { label: string; ms: number | undefined }> = {
      "24h":  { label: "24 часа",   ms: 24 * 60 * 60 * 1000 },
      "7d":   { label: "7 дней",    ms: 7 * 24 * 60 * 60 * 1000 },
      "30d":  { label: "30 дней",   ms: 30 * 24 * 60 * 60 * 1000 },
      "all":  { label: "всё время", ms: undefined },
    };

    const range = RANGES[rangeKey];
    if (!range) {
      await ctx.answerCallbackQuery("Неизвестный диапазон");
      return;
    }

    await ctx.answerCallbackQuery(`📊 ${range.label}`);

    const sinceMs = range.ms !== undefined ? Date.now() - range.ms : undefined;
    const stats = await getStats(chatId, sinceMs);

    const text =
      `<b>📊 Статистика</b> · <i>${range.label}</i>\n\n` +
      `Сообщений: <code>${stats.messages}</code>\n` +
      `Токены: <code>${stats.inputTokens.toLocaleString()}</code> in / ` +
      `<code>${stats.outputTokens.toLocaleString()}</code> out\n` +
      `💰 Примерно: <code>$${stats.cost.toFixed(4)}</code>\n\n` +
      (stats.byModel.length === 0
        ? `<i>Нет данных</i>`
        : `<b>По моделям:</b>\n` +
          stats.byModel
            .map(
              (m) =>
                `• <code>${m.model}</code>: ${m.messages} msg · $${m.cost.toFixed(4)}`,
            )
            .join("\n"));

    const kb = new InlineKeyboard()
      .text("24ч", "stats:24h")
      .text("7д", "stats:7d")
      .text("30д", "stats:30d")
      .text("Всё", "stats:all");

    try {
      await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
    } catch {
      // Message not modified — just answer (already done above)
    }
  });
}
