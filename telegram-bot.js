require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const { RoutingEngine } = require("./lib/model-router");
const { ROUTES } = require("./lib/routes");

// === Wiki Context System ===
const wikiLogger = require("./wiki/logger");
const wikiContext = require("./wiki/context-builder");
const wikiSummarizer = require("./wiki/summarizer");
const wikiMaintenance = require("./wiki/maintenance");
const token = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);
const WORK_DIR = process.cwd();
const UPLOADS_DIR = path.join(WORK_DIR, "uploads");

// Wiki settings - controlled via env
const WIKI_ENABLED = process.env.WIKI_ENABLED !== "false"; // true by default
const WIKI_MAX_SUMMARIES = parseInt(process.env.WIKI_MAX_SUMMARIES, 10) || 3;

// Fixed default — always gemma4:latest, no LLM routing (avoids subprocess hangs)
let CURRENT_MODEL = process.env.PI_MODEL || "ollama/gemma4:latest";
let AUTO_ROUTING = false; // disabled — LLM fallback in model-router has no timeout
let AVAILABLE_MODELS = ["ollama/gemma4:latest"];

// Initialize Routing Engine
const router = new RoutingEngine({ botName: "Помощник по рутине" });
router.addRoutes(ROUTES);

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const bot = new TelegramBot(token, { polling: false });

// Очищаем вебхуки и старые обновления перед стартом, чтобы избежать 409 Conflict
bot
  .deleteWebHook({ drop_pending_updates: true })
  .then(() => {
    bot.startPolling();
    log(`🔒 Бот запущен. Рабочая папка: ${WORK_DIR}`);
  })
  .catch((err) => {
    log(`[FATAL] Ошибка при запуске бота: ${err.message}`);
  });

const { spawn } = require("child_process");

function getTimestamp() {
  return new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
}

function log(message) {
  console.log(`[${getTimestamp()}] ${message}`);
}

// Используем spawn вместо exec, так как это стабильнее для Pi в не-интерактивном режиме
function runPiQuery(prompt, imagePath = null, forcedModel = null) {
  return new Promise((resolve, reject) => {
    const PI_PATH = process.env.PI_PATH || path.join(process.env.HOME || "", ".nvm/versions/node/v24.13.0/bin/pi");

    const modelToUse = forcedModel || CURRENT_MODEL;
    const extensionPath = path.join(WORK_DIR, "pi-search-extension.js");

    // Используем выбранную модель и подключаем расширение для поиска
    const args = [
      "--model",
      modelToUse,
      "--offline",
      "--no-skills",
      "--no-themes",
      "--no-context-files",
      "--extension",
      extensionPath,
      "-p"
    ];

    if (imagePath) {
      args.push(`@${imagePath}`);
    }

    args.push(prompt);

    log(`[EXEC] pi ${args.join(" ")}`);

    const child = spawn(PI_PATH, args, {
      cwd: WORK_DIR,
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: "1",
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data;
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString().trim();
      stderr += chunk;
      if (chunk) log(`[PI STDERR] ${chunk}`);
    });

    // Таймаут 15 минут (для сложных задач с поиском)
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Таймаут ожидания ответа от Pi (15 минут)"));
    }, 900000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      log(`[PI EXIT] Код: ${code}`);
      if (code !== 0 && !stdout) {
        reject(new Error(`Pi exited with code ${code}. Stderr: ${stderr}`));
      } else {
        resolve(stdout.trim() || stderr.trim());
      }
    });
  });
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  log(`[INCOMING] Message from ${userId} (Chat: ${chatId}): ${msg.text || "[No text]"}`);

  if (userId !== ALLOWED_USER_ID) {
    log(`[SECURITY] Отклонен запрос от ID: ${userId}. Allowed: ${ALLOWED_USER_ID}`);
    await bot.sendMessage(
      chatId,
      `⛔ Доступ запрещен. Ваш ID: \`${userId}\`. Разрешен только ID: \`${ALLOWED_USER_ID}\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Обработка команд
  if (msg.text && msg.text.startsWith("/")) {
    const text = msg.text.trim();

    if (text === "/start" || text === "/help") {
      await bot.sendMessage(
        chatId,
        "🤖 *Помощник по рутине*\n\n" +
          "Привет! Я ваш ежедневный ассистент для планирования, управления задачами и рутиной.\n\n" +
          "*Возможности:*\n" +
          "📅 Планирование дня и отслеживание задач\n" +
          "🧠 Память через Wiki — я помню ваши предпочтения\n" +
          "🔍 Поиск информации в интернете\n" +
          "💡 Советы по продуктивности\n\n" +
          "Просто поговорите со мной — я автоматически запоминаю контекст!",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/models") {
      const list = AVAILABLE_MODELS.map((m, i) =>
        m === CURRENT_MODEL ? `✅ ${i + 1}. ${m}` : `▫️ ${i + 1}. ${m}`
      ).join("\n");
      await bot.sendMessage(chatId, `📊 *Доступные модели:*\n\n${list}`, {
        parse_mode: "Markdown"
      });
      return;
    }

    if (text.startsWith("/model ")) {
      const input = text.replace("/model ", "").trim();
      const index = parseInt(input, 10);

      if (!isNaN(index) && index > 0 && index <= AVAILABLE_MODELS.length) {
        CURRENT_MODEL = AVAILABLE_MODELS[index - 1];
      } else {
        // Проверяем, может это полное имя модели
        if (AVAILABLE_MODELS.includes(input)) {
          CURRENT_MODEL = input;
        } else {
          await bot.sendMessage(chatId, `⚠️ Неверный индекс или имя модели. Используйте /models для списка.`);
          return;
        }
      }

      await bot.sendMessage(chatId, `🔄 Модель изменена на: \`${CURRENT_MODEL}\``, {
        parse_mode: "Markdown"
      });
      log(`[CONFIG] Модель изменена на: ${CURRENT_MODEL}`);
      return;
    }

    if (text.startsWith("/autoroute ")) {
      const val = text.replace("/autoroute ", "").trim().toLowerCase();
      AUTO_ROUTING = val === "on" || val === "true" || val === "1";
      await bot.sendMessage(chatId, `🤖 Авто-роутинг: ${AUTO_ROUTING ? "✅ ВКЛ" : "❌ ВЫКЛ"}`);
      return;
    }

    if (text === "/status") {
      let wikiStatus = "";
      if (WIKI_ENABLED) {
        const stats = wikiContext.getWikiStats();
        const hasMemory = wikiContext.hasMemoryForUser(chatId);
        wikiStatus = `
• Wiki: \`ВКЛ\` | Сессий: ${stats.activeSessions} | Память: ${stats.totalSizeKB}KB`;
        if (hasMemory) wikiStatus += " | 🔖 Есть история";
      }
      await bot.sendMessage(
        chatId,
        `⚙️ *Текущий статус:*\n\n` +
          `• Модель: \`${CURRENT_MODEL}\`\n` +
          `• Авто-роутинг: \`${AUTO_ROUTING ? "ВКЛ" : "ВЫКЛ"}\`\n` +
          `• Папка: \`${WORK_DIR}\`\n` +
          wikiStatus,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  // === Wiki commands (before normal processing) ===
  if (msg.text && msg.text.startsWith("/wiki")) {
    const subcmd = msg.text.trim().replace("/wiki", "").trim().toLowerCase().replace(/^\s+/, "");

    if (!WIKI_ENABLED) {
      await bot.sendMessage(chatId, "⚠️ Wiki отключен. Установите WIKI_ENABLED=true в .env");
      return;
    }

    if (subcmd === "" || subcmd === "status") {
      // Show wiki status
      const stats = wikiContext.getWikiStats();
      const session = wikiLogger.readSession(chatId);
      const hasMemory = wikiContext.hasMemoryForUser(chatId);

      let msg_parts = `📚 *Wiki Status:*\n\n`;
      msg_parts += `📂 Активные сессии: \`${stats.activeSessions}\`\n`;
      msg_parts += `📜 Файлы памяти: \`${stats.summaryFiles}\`\n`;
      msg_parts += `💾 Размер: \`${stats.totalSizeKB}KB\`\n`;
      msg_parts += `🏷️ Индекс: ${stats.hasEntitiesIndex ? "✅" : "❌"}\n`;
      msg_parts += `🔖 Память о вас: ${hasMemory ? "✅ есть" : "❌ нет"}\n`;
      if (session) {
        msg_parts += `💬 Сообщений в сессии: \`${session.messages.length}\`\n`;
      }
      await bot.sendMessage(chatId, msg_parts, { parse_mode: "Markdown" });
    } else if (subcmd === "memory") {
      // Show recent memory
      const history = wikiSummarizer.getRecentHistory(WIKI_MAX_SUMMARIES);
      if (history && history.length > 0) {
        // Truncate to Telegram limit
        const trimmed = history.length > 3800 ? history.substring(0, 3800) + "\n\n[... truncated ...]" : history;
        await bot.sendMessage(chatId, `📜 *Recent Memory:*\n\n${trimmed}`, { parse_mode: "Markdown" });
      } else {
        await bot.sendMessage(chatId, "📜 Нет сохраненной истории. Команды пока не сохраняют память.");
      }
    } else if (subcmd === "summarize" || subcmd === "close") {
      // Force summarize current session
      await bot.sendMessage(chatId, "📝 Compressing session...");
      try {
        const results = await wikiSummarizer.summarizeAllClosed();
        if (results.length > 0) {
          await bot.sendMessage(chatId, `✅ Session compressed. ${results[0].success ? "Success" : "Failed"}`);
        } else {
          await bot.sendMessage(chatId, `✅ No sessions to compress.`);
        }
      } catch (err) {
        await bot.sendMessage(chatId, `⚠️ Compression failed: ${err.message}`);
      }
    } else if (subcmd === "stats") {
      const stats = wikiContext.getWikiStats();
      await bot.sendMessage(
        chatId,
        `📊 Wiki Stats: ${stats.activeSessions} sessions, ${stats.summaryFiles} memory files, ${stats.totalSizeKB}KB total`
      );
    } else {
      await bot.sendMessage(
        chatId,
        `⚠️ Unknown wiki command: \`/wiki ${subcmd}\`\n\nCommands: wiki, wiki memory, wiki summarize, wiki stats`
      );
    }
    return;
  }

  let prompt = msg.text || msg.caption || "Опиши это изображение";
  let activeModel = CURRENT_MODEL;
  let routingInfo = "";

  // 1. Проверяем ручной выбор модели через префикс
  const modelMatch = prompt.match(/^(?:model|модель):\s*([^\s\n]+)\s*([\s\S]*)$/i);
  if (modelMatch) {
    const modelInput = modelMatch[1];
    const index = parseInt(modelInput, 10);

    if (!isNaN(index) && index > 0 && index <= AVAILABLE_MODELS.length) {
      activeModel = AVAILABLE_MODELS[index - 1];
    } else {
      activeModel = modelInput;
    }

    prompt = modelMatch[2].trim() || "Опиши это изображение";
    log(`[MANUAL] Использование модели: ${activeModel}`);
  }
  // 2. Если ручного выбора нет и включен авто-роутинг, используем RoutingEngine
  else if (AUTO_ROUTING && msg.text) {
    try {
      const result = await router.route(msg.text);
      if (result.winningRoute && result.winningRoute.model) {
        activeModel = result.winningRoute.model;
        routingInfo = `[Route: ${result.winningRoute.id}] `;
        log(
          `[AUTO-ROUTE] Query: "${msg.text.substring(0, 50)}..." -> Route: ${result.winningRoute.id} (${activeModel})`
        );
      }
    } catch (err) {
      log(`[ROUTE ERROR] ${err.message}`);
    }
  }

  let imagePath = null;

  if (msg.photo && msg.photo.length > 0) {
    // Берем самое большое разрешение
    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

    try {
      log(`[IMAGE] Скачивание фото...`);
      const filePath = await bot.downloadFile(fileId, UPLOADS_DIR);
      imagePath = filePath;
      log(`[IMAGE] Сохранено в: ${imagePath}`);
    } catch (err) {
      log(`[IMAGE ERROR] ${err.message}`);
      try {
        await bot.sendMessage(chatId, `⚠️ Не удалось скачать изображение: ${err.message}`);
      } catch (e) {}
      return;
    }
  }

  if (!msg.text && !msg.photo) return;

  // === Wiki: Log user message to session ===
  const username = msg.from.first_name || "Anonymous";
  const extraFile = imagePath ? `Attached: ${path.basename(imagePath)}` : "";
  if (WIKI_ENABLED) {
    wikiLogger.logMessage(chatId, username, "user", msg.text || msg.caption || "", extraFile);
  }

  log(`[IN] ${prompt}${imagePath ? " [WITH IMAGE]" : ""}`);

  // Отправляем статус "печатает" и запускаем интервал
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing").catch(() => {});
  }, 5000);

  try {
    // === Wiki: Assemble context for this chat ===
    let fullPrompt = prompt;
    if (WIKI_ENABLED) {
      const ctx = wikiContext.assembleContext(chatId);
      if (ctx.context && ctx.context.trim().length > 10) {
        // Insert context before the user query
        fullPrompt = `---\nContext Wiki\n${ctx.context}\n---\n\n${prompt}`;
        log(
          `[WIKI] Context assembled: ${ctx.tokens} tokens, active=${ctx.hasActiveSession}, history=${ctx.hasHistory}`
        );
      }
    }

    const response = await runPiQuery(fullPrompt, imagePath, activeModel);
    clearInterval(typingInterval);

    if (!response || response.length < 2) {
      try {
        await bot.sendMessage(chatId, "⚠️ Pi не вернул текстового ответа. Попробуйте переформулировать запрос.");
      } catch (e) {}
      return;
    }

    log(`[OUT] ${response.substring(0, 300)}...`);

    // === Wiki: Log assistant response ===
    if (WIKI_ENABLED) {
      wikiLogger.logMessage(chatId, username, "assistant", response);
    }

    // Разбиваем длинный ответ на части (лимит Telegram — 4096 символов)
    const chunks = response.match(/[\s\S]{1,4000}/g) || [response];
    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
    }
  } catch (err) {
    if (typeof typingInterval !== "undefined") clearInterval(typingInterval);
    log(`[ERROR] ${err.message}`);
    try {
      await bot.sendMessage(chatId, `⚠️ Ошибка агента: ${err.message}`);
    } catch (sendErr) {
      log(`[CRITICAL ERROR] Не удалось отправить сообщение об ошибке: ${sendErr.message}`);
    }
  } finally {
    // Удаляем временный файл изображения если он был
    if (imagePath && fs.existsSync(imagePath)) {
      try {
        fs.unlinkSync(imagePath);
      } catch (unlinkErr) {
        log(`[FS ERROR] Не удалось удалить файл: ${unlinkErr.message}`);
      }
    }
  }
});

// Глобальные обработчики для предотвращения падения бота
process.on("unhandledRejection", (reason, promise) => {
  log(`Unhandled Rejection at: ${promise} reason: ${reason}`);
});

process.on("uncaughtException", (err) => {
  log(`Uncaught Exception: ${err}`);
});

// Graceful shutdown
function shutdown() {
  log("Shutting down...");
  bot.stopPolling().then(() => {
    log("Polling stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
