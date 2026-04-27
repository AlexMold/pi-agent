require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const { RoutingEngine } = require("./lib/model-router");
const { ROUTES } = require("./lib/routes");

const token = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);
const WORK_DIR = process.cwd();
const UPLOADS_DIR = path.join(WORK_DIR, "uploads");

// Default model — use the largest available local model for best results
let CURRENT_MODEL = process.env.PI_MODEL || "ollama/qwen3.6:35b-a3b-q8_0";
let AUTO_ROUTING = true;

const AVAILABLE_MODELS = [
  "ollama/qwen3.6:35b-a3b-q8_0",   // 128k context — most capable
  "ollama/gemma4:31b",              // 64k  context — strong reasoning
  "ollama/gemma4:latest",           //  8k  context — fast for simple tasks
];

// Initialize Routing Engine
const router = new RoutingEngine({ botName: "Бухгалтерский ассистент" });
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
    const PI_PATH = process.env.PI_PATH || path.join(
      process.env.HOME || "",
      ".nvm/versions/node/v24.13.0/bin/pi",
    );

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
      "-p",
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
        PI_TELEMETRY: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
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
    await bot.sendMessage(chatId, `⛔ Доступ запрещен. Ваш ID: \`${userId}\`. Разрешен только ID: \`${ALLOWED_USER_ID}\``, { parse_mode: "Markdown" });
    return;
  }

  // Обработка команд
  if (msg.text && msg.text.startsWith("/")) {
    const text = msg.text.trim();

    if (text === "/start" || text === "/help") {
      await bot.sendMessage(
        chatId,
        "🤖 *Бухгалтерский ассистент*\n\n" +
          "Присылайте текст или фото для анализа. Я использую Pi для обработки запросов.\n\n" +
          "*Команды:*\n" +
          "/models - список доступных моделей\n" +
          "/model <номер или имя> - сменить текущую модель\n" +
          "/autoroute <on/off> - включить/выключить авто-роутинг\n" +
          "/status - текущие настройки",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (text === "/models") {
      const list = AVAILABLE_MODELS.map((m, i) =>
        m === CURRENT_MODEL ? `✅ ${i + 1}. ${m}` : `▫️ ${i + 1}. ${m}`,
      ).join("\n");
      await bot.sendMessage(chatId, `📊 *Доступные модели:*\n\n${list}`, {
        parse_mode: "Markdown",
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
          await bot.sendMessage(
            chatId,
            `⚠️ Неверный индекс или имя модели. Используйте /models для списка.`,
          );
          return;
        }
      }

      await bot.sendMessage(
        chatId,
        `🔄 Модель изменена на: \`${CURRENT_MODEL}\``,
        {
          parse_mode: "Markdown",
        },
      );
      log(`[CONFIG] Модель изменена на: ${CURRENT_MODEL}`);
      return;
    }

    if (text.startsWith("/autoroute ")) {
      const val = text.replace("/autoroute ", "").trim().toLowerCase();
      AUTO_ROUTING = val === "on" || val === "true" || val === "1";
      await bot.sendMessage(
        chatId,
        `🤖 Авто-роутинг: ${AUTO_ROUTING ? "✅ ВКЛ" : "❌ ВЫКЛ"}`,
      );
      return;
    }

    if (text === "/status") {
      await bot.sendMessage(
        chatId,
        `⚙️ *Текущий статус:*\n\n` +
          `• Модель: \`${CURRENT_MODEL}\`\n` +
          `• Авто-роутинг: \`${AUTO_ROUTING ? "ВКЛ" : "ВЫКЛ"}\`\n` +
          `• Папка: \`${WORK_DIR}\``,
        { parse_mode: "Markdown" },
      );
      return;
    }
  }

  let prompt = msg.text || msg.caption || "Опиши это изображение";
  let activeModel = CURRENT_MODEL;
  let routingInfo = "";

  // 1. Проверяем ручной выбор модели через префикс
  const modelMatch = prompt.match(
    /^(?:model|модель):\s*([^\s\n]+)\s*([\s\S]*)$/i,
  );
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
          `[AUTO-ROUTE] Query: "${msg.text.substring(0, 50)}..." -> Route: ${result.winningRoute.id} (${activeModel})`,
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
        await bot.sendMessage(
          chatId,
          `⚠️ Не удалось скачать изображение: ${err.message}`,
        );
      } catch (e) {}
      return;
    }
  }

  if (!msg.text && !msg.photo) return;

  log(`[IN] ${prompt}${imagePath ? " [WITH IMAGE]" : ""}`);

  // Отправляем статус "печатает" и запускаем интервал
  bot.sendChatAction(chatId, "typing").catch(() => {});
  const typingInterval = setInterval(() => {
    bot.sendChatAction(chatId, "typing").catch(() => {});
  }, 5000);

  try {
    const response = await runPiQuery(prompt, imagePath, activeModel);
    clearInterval(typingInterval);

    if (!response || response.length < 2) {
      try {
        await bot.sendMessage(
          chatId,
          "⚠️ Pi не вернул текстового ответа. Попробуйте переформулировать запрос.",
        );
      } catch (e) {}
      return;
    }

    log(`[OUT] ${response.substring(0, 300)}...`);

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
      log(
        `[CRITICAL ERROR] Не удалось отправить сообщение об ошибке: ${sendErr.message}`,
      );
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
