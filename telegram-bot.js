require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_ID = parseInt(process.env.ALLOWED_USER_ID, 10);
const WORK_DIR = process.cwd();
const UPLOADS_DIR = path.join(WORK_DIR, "uploads");

let CURRENT_MODEL = process.env.PI_MODEL || "google-antigravity/gemini-3.1-pro-high";

const AVAILABLE_MODELS = [
  "google-antigravity/gemini-3.1-pro-high",
  "google-antigravity/gemini-3.1-pro-low",
  "google-antigravity/gemini-3.1-ultra",
  "google-antigravity/gemini-3.1-flash-high",
  "google-antigravity/gemini-3-flash",
  "google-antigravity/claude-sonnet-4-5",
  "google-antigravity/claude-sonnet-4-5-thinking",
  "google-antigravity/claude-opus-4-6-thinking",
  "google-antigravity/gpt-5-pro",
  "google-antigravity/gpt-5-mini",
  "google-antigravity/o3-mini",
  "google-antigravity/o3-preview",
  "google-antigravity/deepseek-r2-thinking",
  "google-antigravity/llama-4-405b",
];

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const bot = new TelegramBot(token, { polling: false });

// Очищаем вебхуки и старые обновления перед стартом, чтобы избежать 409 Conflict
bot.deleteWebHook({ drop_pending_updates: true })
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
    const PI_PATH = path.join(
      process.env.HOME,
      ".nvm/versions/node/v24.13.0/bin/pi",
    );

    const modelToUse = forcedModel || CURRENT_MODEL;
    const extensionPath = path.join(WORK_DIR, "pi-search-extension.js");

    // Используем выбранную модель и подключаем расширение для поиска
    const args = [
      "--model",
      modelToUse,
      "--extension",
      extensionPath,
      "-p",
      "-c",
      "--verbose",
    ];

    if (imagePath) {
      args.push(`@${imagePath}`);
    }

    args.push(prompt);

    log(`[EXEC] pi ${args.join(" ")}`);

    const child = spawn(PI_PATH, args, {
      cwd: WORK_DIR,
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" },
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

  if (userId !== ALLOWED_USER_ID) {
    log(`[SECURITY] Отклонен запрос от ID: ${userId}`);
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
          "/status - текущие настройки",
        { parse_mode: "Markdown" }
      );
      return;
    }

    if (text === "/models") {
      const list = AVAILABLE_MODELS.map((m, i) =>
        m === CURRENT_MODEL ? `✅ ${i + 1}. ${m}` : `▫️ ${i + 1}. ${m}`
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
          await bot.sendMessage(chatId, `⚠️ Неверный индекс или имя модели. Используйте /models для списка.`);
          return;
        }
      }

      await bot.sendMessage(chatId, `🔄 Модель изменена на: \`${CURRENT_MODEL}\``, {
        parse_mode: "Markdown",
      });
      log(`[CONFIG] Модель изменена на: ${CURRENT_MODEL}`);
      return;
    }

    if (text === "/status") {
      await bot.sendMessage(
        chatId,
        `⚙️ *Текущий статус:*\n\n` +
          `• Модель: \`${CURRENT_MODEL}\`\n` +
          `• Папка: \`${WORK_DIR}\``,
        { parse_mode: "Markdown" }
      );
      return;
    }
  }

  let prompt = msg.text || msg.caption || "Опиши это изображение";
  let activeModel = CURRENT_MODEL;

  // Позволяем указать модель прямо в сообщении (на лету)
  // Формат: "модель: имя_модели Промпт" или "model: имя_модели Промпт"
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
    log(`[ON-THE-FLY] Использование модели: ${activeModel}`);
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
          `⚠️ Не удалось скачать изображение: ${err.message}`
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
          "⚠️ Pi не вернул текстового ответа. Попробуйте переформулировать запрос."
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
        `[CRITICAL ERROR] Не удалось отправить сообщение об ошибке: ${sendErr.message}`
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
