/**
 * handlers/commands.ts — Bot command handlers (/start, /model, /status).
 */

import type { Bot, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { config } from "../services/config.js";
import { getStats } from "../services/usage-tracker.js";
import { runDistillation } from "../services/distiller.js";

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

// ── Helpers ────────────────────────────────────────────────────────

const RANGES: Record<string, { label: string; ms: number | undefined }> = {
  "24h":  { label: "24 часа",  ms: 24 * 60 * 60 * 1000 },
  "7d":   { label: "7 дней",   ms: 7 * 24 * 60 * 60 * 1000 },
  "30d":  { label: "30 дней",  ms: 30 * 24 * 60 * 60 * 1000 },
  "all":  { label: "всё время", ms: undefined },
};

async function renderStats(chatId: number, rangeKey: keyof typeof RANGES): Promise<string> {
  const range = RANGES[rangeKey];
  const sinceMs = range.ms !== undefined ? Date.now() - range.ms : undefined;
  const stats = await getStats(chatId, sinceMs);

  const head =
    `<b>📊 Статистика</b> · <i>${range.label}</i>\n\n` +
    `Сообщений: <code>${stats.messages}</code>\n` +
    `Токены: <code>${stats.inputTokens.toLocaleString()}</code> in / ` +
    `<code>${stats.outputTokens.toLocaleString()}</code> out\n` +
    `💰 Примерно: <code>$${stats.cost.toFixed(4)}</code>\n\n`;

  const byModel =
    stats.byModel.length === 0
      ? `<i>Нет данных</i>`
      : `<b>По моделям:</b>\n` +
        stats.byModel
          .map(
            (m) =>
              `• <code>${m.model}</code>: ${m.messages} msg · $${m.cost.toFixed(4)}`,
          )
          .join("\n");

  return head + byModel;
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
      `• 🔀 Выбором модели (/model)\n` +
      `• 💰 Статистикой расходов (/stats)`,
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

  // /distill — run memory distillation + session compaction now
  bot.command("distill", async (ctx: Context) => {
    await ctx.reply("⏳ Дистилляция запущена...");
    try {
      const stats = await runDistillation();
      await ctx.reply(
        `<b>🧠 Дистилляция готова</b>\n` +
        `Чатов: <code>${stats.chats}</code> (активных пропущено: ${stats.skippedActive})\n` +
        `Факты: +<code>${stats.factsAdded}</code> (дублей скипнуто: ${stats.factsSkipped})\n` +
        `Сессий сжато: <code>${stats.rotated}</code>` +
        (stats.errors ? `\n⚠️ Ошибок: ${stats.errors}` : ""),
        { parse_mode: "HTML" },
      );
    } catch (err: any) {
      await ctx.reply(`❌ Дистилляция упала: ${err.message}`);
    }
  });

  // /stats [range] — range ∈ {24h, 7d, 30d, all} (default: 7d)
  bot.command("stats", async (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const raw = ctx.match;
    const arg =
      typeof raw === "string"
        ? raw.trim()
        : Array.isArray(raw)
          ? (raw[0] ?? "").toString().trim()
          : "";
    const rangeKey: keyof typeof RANGES = (arg in RANGES ? arg : "7d") as keyof typeof RANGES;

    const text = await renderStats(chatId, rangeKey);
    const kb = new InlineKeyboard()
      .text("24ч", "stats:24h")
      .text("7д", "stats:7d")
      .text("30д", "stats:30d")
      .text("Всё", "stats:all");

    await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
  });
}
