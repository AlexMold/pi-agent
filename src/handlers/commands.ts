/**
 * handlers/commands.ts — Bot command handlers (/start, /model, /status).
 */

import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../services/config.js";

// ── Model keyboard ─────────────────────────────────────────────────

export function buildModelKeyboard(current: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of config.allModels) {
    kb.text(
      `${m.label}${m.id === current ? " ✅" : ""}`,
      `model:${m.id}`,
    ).row();
  }
  kb.text(`🔁 Auto${current === "auto" ? " ✅" : ""}`, "model:auto");
  return kb;
}

// ── Command registrations ──────────────────────────────────────────

export function registerCommands(bot: Bot): void {
  bot.command("start", async (ctx: Context) => {
    await ctx.reply(
      `<b>🤖 AI Assistant Pro</b>\n\n` +
      `Привет! Я AI-ассистент с:\n` +
      `• 🧠 Умным роутингом (локально / облако)\n` +
      `• 📚 Векторной памятью (LanceDB)\n` +
      `• 🎤 Голосовым вводом (Whisper)\n` +
      `• 🌐 Веб-поиском (Tavily + Serper)\n` +
      `• 🔀 Выбором модели (/model)`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("model", async (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const current = config.userModelOverride.get(chatId) || "auto";
    const name =
      current === "auto"
        ? "🔁 Auto"
        : config.findModel(current)?.label || current;
    await ctx.reply(
      `<b>Выбор модели</b>\n\nТекущая: <code>${name}</code>`,
      {
        parse_mode: "HTML",
        reply_markup: buildModelKeyboard(current),
      },
    );
  });

  bot.command("status", async (ctx: Context) => {
    await ctx.reply(
      `<b>⚙️ Статус</b>\n` +
      `• Ollama: <code>${config.ollamaHost}</code>\n` +
      `• Whisper: <code>${config.whisperHost}</code>\n` +
      `• Cloud: ${config.hasCloudAccess ? "✅" : "❌"}\n` +
      `• Workspace: <code>/app/workspace</code>`,
      { parse_mode: "HTML" },
    );
  });
}