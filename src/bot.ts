/**
 * bot.ts — Telegram Bot orchestrator (grammY).
 *
 * Flow:
 *  1. Voice message  → Whisper.cpp (host) → text
 *  2. SmartRouter    → pick local/cloud model (LLM classifier)
 *  3. LongTermMemory → store & retrieve context (hybrid)
 *  4. Pi-Agent       → execute task in Docker sandbox
 *  5. Response       → Markdown → HTML → Telegram
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import "dotenv/config";
import MarkdownIt from "markdown-it";
import { writeFile } from "fs/promises";
import { join } from "path";

import { SmartRouter } from "./router.js";
import type { RouteResult } from "./router.js";
import { executeAgentTask } from "./agent.js";
import { transcribeAudio } from "./stt.js";
import { memory } from "./memory.js";

// ── Config ──────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID || "0", 10);

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN not set in .env");
  process.exit(1);
}

// ── Available models ─────────────────────────────────────────────────
const LOCAL_MODELS = [
  { id: "ollama/gemma4:31b",             label: "🟢 Gemma 4 31B" },
  { id: "ollama/gemma4:latest",          label: "🟢 Gemma 4 8B" },
  { id: "ollama/qwen3.6:35b-a3b-q8_0", label: "🟢 Qwen 3.6 35B" },
  { id: "ollama/minicpm-v:8b-2.6-q4_K_M", label: "🟢 MiniCPM-V 8B (img)" },
];

const CLOUD_MODELS = [
  { id: "deepseek/deepseek-v4-pro",   label: "☁️ DeepSeek V4 Pro" },
  { id: "deepseek/deepseek-v4-flash", label: "☁️ DeepSeek V4 Flash" },
];

const ALL_MODELS = [...LOCAL_MODELS, ...CLOUD_MODELS];

// Per-chat manual model override
const userModelOverride = new Map<number, string>();

// ── Helpers ──────────────────────────────────────────────────────────

const md = new MarkdownIt({ breaks: true, linkify: true });

/** Markdown → Telegram-safe HTML */
function mdToHtml(text: string): string {
  return md.render(text)
    .replace(/<(?!\/?(?:b|i|u|s|code|pre|a|tg-emoji|br)\b)[^>]*>/gi, "");
}

/** Send text as Markdown→HTML, fallback to plain text */
async function replyHtml(ctx: Context, text: string) {
  try {
    await ctx.reply(mdToHtml(text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(text);
  }
}

/** Clean raw filesystem paths */
function cleanResponse(text: string): string {
  return text
    .replace(/\/var\/folders\/[\w/.\- ]+\.(png|jpg|jpeg|gif|webp|pdf|txt|md|js|ts|json|html|css)/gi, "[file]")
    .replace(/\/var\/folders\/[^\s,.!?]+/g, "[path]")
    .replace(/\/tmp\/[^\s,.!?]+/g, "[tmp]");
}

/** Build inline keyboard for model selection */
function buildModelKeyboard(current: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of ALL_MODELS) {
    kb.text(`${m.label}${m.id === current ? " ✅" : ""}`, `model:${m.id}`).row();
  }
  kb.text(`🔁 Auto${current === "auto" ? " ✅" : ""}`, "model:auto");
  return kb;
}

/** Get effective route */
async function getRoute(query: string, chatId: number): Promise<RouteResult> {
  const manual = userModelOverride.get(chatId);
  if (manual) {
    const isCloud = CLOUD_MODELS.some((m) => m.id === manual);
    return {
      model: manual,
      type: isCloud ? "cloud" : "local",
      reason: "manual",
      baseUrl: isCloud ? "https://api.deepseek.com/v1"
        : `http://${process.env.OLLAMA_HOST || "host.docker.internal:11434"}/v1`,
      apiKey: isCloud ? (process.env.DEEPSEEK_API_KEY || "") : "ollama",
    };
  }
  return SmartRouter.route(query, []);
}

// ── Bot instance ─────────────────────────────────────────────────────
const bot = new Bot(TELEGRAM_TOKEN);

await memory.init().catch((err) => console.error("[Memory] Init failed:", err));

// ── Auth middleware ──────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId && userId !== ALLOWED_USER_ID && ALLOWED_USER_ID !== 0) {
    await ctx.reply(`⛔ Доступ запрещён. ID: <code>${userId}</code>`, { parse_mode: "HTML" });
    console.warn(`[Security] Blocked user ${userId}`);
    return;
  }
  await next();
});

// ── Commands ─────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    `<b>🤖 AI Assistant Pro</b>\n\n` +
    `Привет! Я AI-ассистент с:\n` +
    `• 🧠 Умным роутингом (локально / облако)\n` +
    `• 📚 Векторной памятью (LanceDB)\n` +
    `• 🎤 Голосовым вводом (Whisper)\n` +
    `• 🌐 Веб-поиском\n` +
    `• 🔀 Выбором модели (/model)`,
    { parse_mode: "HTML" },
  );
});

bot.command("model", async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const current = userModelOverride.get(chatId) || "auto";
  const name = current === "auto" ? "🔁 Auto" : ALL_MODELS.find(m => m.id === current)?.label || current;
  await ctx.reply(`<b>Выбор модели</b>\n\nТекущая: <code>${name}</code>`, {
    parse_mode: "HTML",
    reply_markup: buildModelKeyboard(current),
  });
});

bot.command("status", async (ctx) => {
  await ctx.reply(
    `<b>⚙️ Статус</b>\n` +
    `• Ollama: <code>${process.env.OLLAMA_HOST || "host.docker.internal:11434"}</code>\n` +
    `• Whisper: <code>${process.env.WHISPER_HOST || "host.docker.internal:8080"}</code>\n` +
    `• Cloud: ${process.env.DEEPSEEK_API_KEY ? "✅" : "❌"}\n` +
    `• Workspace: <code>/app/workspace</code>`,
    { parse_mode: "HTML" },
  );
});

// ── Callback: model buttons ──────────────────────────────────────────

bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const modelId = ctx.match[1];

  if (modelId === "auto") {
    userModelOverride.delete(chatId);
    await ctx.answerCallbackQuery("🔁 Smart Router включён");
  } else {
    userModelOverride.set(chatId, modelId);
    const label = ALL_MODELS.find((m) => m.id === modelId)?.label || modelId;
    await ctx.answerCallbackQuery(`✅ ${label}`);
  }

  const current = userModelOverride.get(chatId) || "auto";
  const name = current === "auto" ? "🔁 Auto" : ALL_MODELS.find(m => m.id === current)?.label || current;
  await ctx.editMessageText(`<b>Выбор модели</b>\n\nТекущая: <code>${name}</code>`, {
    parse_mode: "HTML",
    reply_markup: buildModelKeyboard(current),
  });
});

// ── Messages ─────────────────────────────────────────────────────────

bot.on(["message:text", "message:voice", "message:photo"], async (ctx) => {
  let query: string;
  let imagePath: string | undefined;

  if (ctx.message.voice) {
    try {
      await ctx.reply("🎤 Распознаю речь...");
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      query = await transcribeAudio(buf);
      await ctx.reply(`📝 ${query}`);
    } catch (err: any) {
      console.error("[STT]", err);
      await ctx.reply("⚠️ Ошибка распознавания голоса");
      return;
    }
  } else if (ctx.message.photo) {
    try {
      await ctx.reply("🖼 Обрабатываю фото...");
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = `photo_${Date.now()}.jpg`;
      const fullPath = join("/app/workspace", filename);
      await writeFile(fullPath, buf);
      query = ctx.message.caption || "Опиши это изображение";
      imagePath = filename;
    } catch (err: any) {
      console.error("[Photo]", err);
      await ctx.reply("⚠️ Ошибка загрузки фото");
      return;
    }
  } else {
    query = ctx.message.text || "";
  }

  if (!query.trim()) return;

  const chatId = ctx.chat?.id ?? 0;
  console.log(`[In] chat=${chatId}: ${query.slice(0, 100)}`);

  const route = imagePath
    ? ({
        model: "ollama/minicpm-v:8b-2.6-q4_K_M",
        type: "local" as const,
        reason: "image",
        baseUrl: `http://${process.env.OLLAMA_HOST || "host.docker.internal:11434"}/v1`,
        apiKey: "ollama",
      } as RouteResult)
    : await getRoute(query, chatId);
  const icon = userModelOverride.has(chatId) ? "🔀" : "🤖";
  await ctx.reply(`${icon} <code>${route.model}</code> | ${route.reason} | ${route.type}`, { parse_mode: "HTML" });

  try { await memory.remember(query, { role: "user", chatId }); } catch (_) {}

  let ctxPrefix = "";
  try {
    const past = await memory.recall(query, chatId, 4, 4);
    if (past.length > 0) {
      ctxPrefix = `<conversation_history>\n${past.map((m, i) => `${i + 1}. [${m.role}]: ${m.text}`).join("\n")}\n</conversation_history>\n\n`;
    }
  } catch (_) {}

  ctx.replyWithChatAction("typing").catch(() => {});

  try {
    const raw = await executeAgentTask(ctxPrefix + query, route, imagePath);
    const result = cleanResponse(raw);
    try { await memory.remember(result, { role: "assistant", chatId }); } catch (_) {}

    const chunks = result.match(/[^]{1,4000}/g) || [result];
    for (const chunk of chunks) await replyHtml(ctx, chunk);
  } catch (err: any) {
    console.error("[Agent]", err.message);

    if (route.type === "local" && process.env.DEEPSEEK_API_KEY) {
      if (imagePath) {
        await ctx.reply("⚠️ Локальная vision-модель недоступна. Облачные модели не поддерживают изображения.");
      } else {
        await ctx.reply("⚠️ Локальная модель недоступна, пробую облако...");
        try {
          const cr: RouteResult = {
            model: CLOUD_MODELS[1].id, type: "cloud", reason: "fallback",
            baseUrl: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY,
          };
          const raw = await executeAgentTask(ctxPrefix + query, cr);
          const result = cleanResponse(raw);
          const chunks = result.match(/[^]{1,4000}/g) || [result];
          for (const chunk of chunks) await replyHtml(ctx, chunk);
        } catch (fbErr: any) {
          await ctx.reply(`❌ Облако тоже не ответило: ${fbErr.message}`);
        }
      }
    } else if (route.type === "local") {
      await ctx.reply(`❌ Ошибка (нет облачного ключа): ${err.message}`);
    } else {
      await ctx.reply(`❌ Ошибка: ${err.message}`);
    }
  }
});

// ── Error handling ───────────────────────────────────────────────────
bot.catch((err) => console.error("[Bot]", err));
process.on("unhandledRejection", (r, p) => console.error("[Process] unhandled rejection:", p, r));
process.on("uncaughtException", (e) => console.error("[Process] uncaught exception:", e));

// ── Start ────────────────────────────────────────────────────────────
bot.start({
  onStart: () => {
    console.log("🤖 AI Assistant Pro Bot started");
    console.log(`   Ollama: ${process.env.OLLAMA_HOST || "host.docker.internal:11434"}`);
    console.log(`   Whisper: ${process.env.WHISPER_HOST || "host.docker.internal:8080"}`);
    console.log(`   Allowed user: ${ALLOWED_USER_ID || "any"}`);
  },
});

const shutdown = () => { bot.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
