const https = require("https");
const { spawn } = require("child_process");
const path = require("path");

const CHANNEL_NAME = "bydmoldova";
const PI_PATH = path.join(process.env.HOME, ".nvm/versions/node/v24.13.0/bin/pi");

function fetchChannel() {
  return new Promise((resolve, reject) => {
    https
      .get(
        `https://t.me/s/${CHANNEL_NAME}`,
        {
          headers: { "User-Agent": "Mozilla/5.0" }
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        }
      )
      .on("error", reject);
  });
}

function parseMessages(html) {
  const messages = [];
  const msgRegex =
    /<div class="tgme_widget_message_text js-message_text" dir="auto">([\s\S]*?)<\/div>[\s\S]*?<time class="time" datetime="([\d-T:+]+)">/g;

  let match;
  while ((match = msgRegex.exec(html)) !== null) {
    let text = match[1].replace(/<[^>]+>/g, " ").trim();
    let date = new Date(match[2]);
    messages.push({ text, date });
  }
  return messages;
}

async function summarize(messages) {
  if (messages.length === 0) return "Сообщений за последние 24 часа не найдено.";

  const prompt = `Ниже приведен список сообщений из Telegram-канала @${CHANNEL_NAME} за последние 24 часа. 
Кратко резюмируй основные темы обсуждения, важные новости и настроения участников.

Сообщения:
${messages.map((m) => `- [${m.date.toISOString()}] ${m.text}`).join("\n")}

Итоговое резюме:`;

  return new Promise((resolve, reject) => {
    const args = [
      "--model",
      "ollama/gemma4:latest",
      "--offline",
      "--no-skills",
      "--no-themes",
      "--no-context-files",
      "-p",
      prompt
    ];

    const child = spawn(PI_PATH, args, {
      env: { ...process.env, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" }
    });

    let stdout = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Pi CLI exited with code ${code}`));
    });
  });
}

async function main() {
  try {
    console.log(`[${new Date().toISOString()}] Fetching messages from @${CHANNEL_NAME}...`);
    const html = await fetchChannel();
    const allMessages = parseMessages(html);

    const now = new Date();
    const last24h = allMessages.filter((m) => now - m.date < 24 * 60 * 60 * 1000);

    console.log(`Found ${last24h.length} messages in the last 24 hours.`);

    const summary = await summarize(last24h);
    console.log("\n--- DAILY SUMMARY ---");
    console.log(summary);
    console.log("---------------------\n");
  } catch (err) {
    console.error("Error:", err.message);
  }
}

main();
