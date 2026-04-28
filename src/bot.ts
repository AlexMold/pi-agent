/**
 * bot.ts — Telegram Bot orchestrator (grammY).
 *
 * Flow:
 *  1. Voice message  → Whisper.cpp (host) → text
 *  2. SmartRouter    → pick local/cloud model
 *  3. LongTermMemory → store & retrieve context
 *  4. Pi-Agent       → execute task in Docker sandbox
 *  5. Response       → send back to Telegram
 */

import { Bot, Context, InlineKeyboard } from "grammy";
import "dotenv/config";

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

/** Clean raw filesystem paths from pi's output */
function cleanResponse(text: string): string {
  return (
    text
      // macOS temp dirs (handle spaces, parens, dots)
      .replace(/\/var\/folders\/[\w/.\- ]+\.(png|jpg|jpeg|gif|webp|pdf|txt|md|js|ts|json|html|css)/gi, "[file]")
      .replace(/\/var\/folders\/[^\s,.!?]+/g, "[path]")
      // Unix temp dirs
      .replace(/\/tmp\/[^\s,.!?]+/g, "[tmp]")
  );
}

/** Build inline keyboard for model selection */
function buildModelKeyboard(currentModel: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const m of ALL_MODELS) {
    const marker = m.id === currentModel ? " ✅" : "";
    kb.text(`${m.label}${marker}`, `model:${m.id}`).row();
  }
  kb.text("🔁 Auto (Smart Router)", "model:auto");
  return kb;
}

/** Get effective route: user override or SmartRouter */
async function getRoute(query: string, chatId: number): Promise<RouteResult> {
  const manualModel = userModelOverride.get(chatId);
  if (manualModel) {
    const isCloud = CLOUD_MODELS.some((m) => m.id === manualModel);
    return {
      model: manualModel,
      type: isCloud ? "cloud" : "local",
      reason: "manual",
      baseUrl: isCloud
        ? "https://api.deepseek.com/v1"
        : `http://${process.env.OLLAMA_HOST || "host.docker.internal:11434"}/v1`,
      apiKey: isCloud ? (process.env.DEEPSEEK_API_KEY || "") : "ollama",
    };
  }
  return SmartRouter.route(query, []);
}

// ── Bot instance ─────────────────────────────────────────────────────
const bot = new Bot(TELEGRAM_TOKEN);

// ── Init memory on startup ───────────────────────────────────────────
await memory.init().catch((err) => {
  console.error("[Memory] Init failed:", err);
});

// ── Auth middleware ──────────────────────────────────────────────────
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (userId && userId !== ALLOWED_USER_ID && ALLOWED_USER_ID !== 0) {
    await ctx.reply(
      `⛔ Access denied. Your ID: \`${userId}\`. Authorized: \`${ALLOWED_USER_ID}\``,
      { parse_mode: "MarkdownV2" },
    );
    console.warn(`[Security] Blocked user ${userId}`);
    return;
  }
  await next();
});

// ── Command handlers ─────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🤖 *AI Assistant Pro*\n\n" +
      "Привет\\! Я AI-ассистент с:\n" +
      "• 🧠 Умным роутингом \\(локально / облако\\)\n" +
      "• 📚 Векторной памятью \\(LanceDB\\)\n" +
      "• 🎤 Голосовым вводом \\(Whisper\\)\n" +
      "• 🌐 Веб-поиском\n" +
      "• 🔀 Ручным выбором модели \\(/model\\)\n\n" +
      "Просто отправь текст или голосовое\\!",
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("model", async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const current = userModelOverride.get(chatId) || "auto";
  const displayName = current === "auto"
    ? "🔁 Auto (Smart Router)"
    : ALL_MODELS.find(m => m.id === current)?.label || current;

  await ctx.reply(
    `*Выбор модели*\n\nТекущая: \`${displayName}\`\n\nНажми на кнопку для переключения:`,
    {
      parse_mode: "MarkdownV2",
      reply_markup: buildModelKeyboard(current),
    },
  );
});

bot.command("status", async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const current = userModelOverride.get(chatId) || "auto";
  await ctx.reply(
    `⚙️ *Статус системы:*\n` +
      `• Ollama: \`${process.env.OLLAMA_HOST || "host.docker.internal:11434"}\`\n` +
      `• Whisper: \`${process.env.WHISPER_HOST || "host.docker.internal:8080"}\`\n` +
      `• Cloud: \`DeepSeek V4 Pro\` ${process.env.DEEPSEEK_API_KEY ? "✅" : "❌ \\(no key\\)"}\n` +
      `• Модель: \`${current}\`\n` +
      `• Workspace: \`/app/workspace\``,
    { parse_mode: "MarkdownV2" },
  );
});

// ── Callback handler: model selection buttons ────────────────────────

bot.callbackQuery(/^model:(.+)$/, async (ctx) => {
  const chatId = ctx.chat?.id ?? 0;
  const modelId = ctx.match[1];

  if (modelId === "auto") {
    userModelOverride.delete(chatId);
    await ctx.answerCallbackQuery("🔁 Smart Router включён");
    await ctx.editMessageText(
      "*Выбор модели*\n\nТекущая: 🔁 Auto \\(Smart Router\\)",
      { parse_mode: "MarkdownV2", reply_markup: buildModelKeyboard("auto") },
    );
  } else {
    userModelOverride.set(chatId, modelId);
    const label = ALL_MODELS.find((m) => m.id === modelId)?.label || modelId;
    await ctx.answerCallbackQuery(`✅ Выбрана: ${label}`);
    await ctx.editMessageText(
      `*Выбор модели*\n\nТекущая: \`${label}\`\n\nНажми на кнопку для переключения:`,
      { parse_mode: "MarkdownV2", reply_markup: buildModelKeyboard(modelId) },
    );
  }

  await ctx.answerCallbackQuery();
});

// ── Message handler (text + voice) ───────────────────────────────────

bot.on(["message:text", "message:voice"], async (ctx) => {
  let query: string;

  // 1. Voice → Whisper STT
  if (ctx.message.voice) {
    try {
      await ctx.reply("🎤 Распознаю речь...");

      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`;

      const audioRes = await fetch(fileUrl);
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

      query = await transcribeAudio(audioBuffer);
      await ctx.reply(`📝 Распознано: ${query}`);
    } catch (err: any) {
      console.error("[STT]", err);
      await ctx.reply("⚠️ Ошибка распознавания голоса");
      return;
    }
  } else {
    query = ctx.message.text || "";
  }

  if (!query.trim()) return;

  const chatId = ctx.chat?.id ?? 0;
  const userId = ctx.from?.id || 0;
  console.log(`[In] chat=${chatId} user=${userId}: ${query.slice(0, 100)}`);

  // 2. Get route (user override or smart router with LLM classifier)
  const route = await getRoute(query, chatId);

  const autoIcon = userModelOverride.has(chatId) ? "🔀" : "🤖";
  await ctx.reply(`${autoIcon} ${route.model} | ${route.reason} | ${route.type}`);

  // 3. Remember user query
  try {
    await memory.remember(query, { role: "user", chatId });
  } catch (err) {
    console.error("[Memory] remember failed:", err);
  }

  // 4. Build context from memory (hybrid: recent + semantic)
  let contextPrefix = "";
  try {
    const past = await memory.recall(query, chatId, 4, 4);
    if (past.length > 0) {
      contextPrefix = `<conversation_history>
${past.map((m, i) => `${i + 1}. [${m.role}]: ${m.text}`).join("\n")}
</conversation_history>

`;
    }
  } catch (err) {
    console.error("[Memory] recall failed:", err);
  }

  const fullTask = contextPrefix + query;

  // 5. Typing indicator
  ctx.replyWithChatAction("typing").catch(() => {});

  try {
    const rawResult = await executeAgentTask(fullTask, route);
    const result = cleanResponse(rawResult);

    // 6. Remember assistant reply
    try {
      await memory.remember(result, { role: "assistant", chatId });
    } catch (_) {}

    // 7. Send response with MarkdownV2, fallback to plain text on parse errors
    const chunks = result.match(/[^]{1,4000}/g) || [result];
    for (const chunk of chunks) {
      try {
        await ctx.reply(chunk, { parse_mode: "MarkdownV2" });
      } catch {
        // MarkdownV2 parse failed — send as plain text
        await ctx.reply(chunk);
      }
    }
  } catch (err: any) {
    console.error("[Agent] error:", err.message);

    if (route.type === "local" && process.env.DEEPSEEK_API_KEY) {
      await ctx.reply("⚠️ Local failed, falling back to cloud DeepSeek V4 Pro...");
      try {
        const cloudRoute: RouteResult = {
          model: "deepseek/deepseek-v4-pro",
          type: "cloud",
          reason: "fallback",
          baseUrl: "https://api.deepseek.com/v1",
          apiKey: process.env.DEEPSEEK_API_KEY,
        };
        const rawResult = await executeAgentTask(fullTask, cloudRoute);
        const result = cleanResponse(rawResult);
        const chunks = result.match(/[^]{1,4000}/g) || [result];
        for (const chunk of chunks) {
          try {
            await ctx.reply(chunk, { parse_mode: "MarkdownV2" });
          } catch {
            await ctx.reply(chunk);
          }
        }
      } catch (fbErr: any) {
        await ctx.reply(`❌ Cloud fallback also failed: ${fbErr.message}`);
      }
    } else if (route.type === "local") {
      await ctx.reply(`❌ Agent error (no cloud key configured): ${err.message}`);
    } else {
      await ctx.reply(`❌ Agent error: ${err.message}`);
    }
  }
});

// ── Error handling ───────────────────────────────────────────────────

bot.catch((err) => {
  console.error("[Bot] Unhandled error:", err);
});

// ── Global error handlers ────────────────────────────────────────────

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Process] Unhandled rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[Process] Uncaught exception:", err);
});

// ── Start ────────────────────────────────────────────────────────────

bot.start({
  onStart: () => {
    console.log("🤖 AI Assistant Pro Bot started");
    console.log(`   Ollama: ${process.env.OLLAMA_HOST || "host.docker.internal:11434"}`);
    console.log(`   Whisper: ${process.env.WHISPER_HOST || "host.docker.internal:8080"}`);
    console.log(`   Allowed user: ${ALLOWED_USER_ID || "any"}`);
  },
});

const shutdown = () => {
  console.log("\n[Bot] Shutting down...");
  bot.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
