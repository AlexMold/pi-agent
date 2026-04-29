/**
 * handlers/callbacks.ts — Inline callback query handlers (model selection).
 */

import type { Bot, Context } from "grammy";
import { config } from "../services/config.js";
import { buildModelKeyboard } from "./commands.js";

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

    const current = config.userModelOverride.get(chatId) || "auto";
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