/**
 * wiki/summarizer.js — Session Summarizer
 *
 * Reads closed sessions from wiki/messages/ and compresses them into
 * wiki/summaries/{date}.md files using Pi CLI for LLM summarization.
 * Called by maintenance.js or on demand.
 */

const { logMessage, readSession, getClosedSessions, deleteSession, MESSAGES_DIR } = require("./logger");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SUMMARIES_DIR = path.join(__dirname, "summaries");
const MODEL = process.env.PI_MODEL || "ollama/gemma4:latest";
const PI_PATH = process.env.PI_PATH || path.join(process.env.HOME || "", ".nvm/versions/node/v24.13.0/bin/pi");

if (!fs.existsSync(SUMMARIES_DIR)) {
  fs.mkdirSync(SUMMARIES_DIR, { recursive: true });
}

/**
 * Get the summary file for today.
 * Creates it if it doesn't exist.
 */
function getTodaySummaryFile() {
  const today = new Date().toISOString().split("T")[0];
  const summaryFile = path.join(SUMMARIES_DIR, `${today}.md`);

  if (!fs.existsSync(summaryFile)) {
    fs.writeFileSync(summaryFile, `# Memory Compressed: ${today}\n\n`);
  }

  return summaryFile;
}

/**
 * Check if a user already has a summary section in today's file.
 */
function hasSummaryForUser(summaryContent, chatId) {
  return summaryContent.includes(`(chat/${chatId})`);
}

/**
 * Extract all user sections from a summary file.
 */
function extractExistingUsers(summaryContent) {
  const users = [];
  const regex = /## User: (.+?) \(chat\/(\d+)\)/g;
  let match;
  while ((match = regex.exec(summaryContent)) !== null) {
    users.push({ name: match[1], chatId: match[2] });
  }
  return users;
}

/**
 * Summarize a conversation session using Pi CLI.
 *
 * @param {string} chatId - Telegram chat ID
 * @param {string} username - Username
 * @param {Array} messages - Parsed messages array
 */
function summarizeWithPi(chatId, username, messages) {
  return new Promise((resolve, reject) => {
    // Build conversation text
    const conversation = messages
      .filter((m) => m.text && m.text.trim())
      .map((m) => {
        const tag = m.type === "user" ? "User" : "Бухгалтер";
        let text = `[${m.timestamp}] ${tag}: ${m.text}`;
        if (m.extra) text += `\n  *${m.extra}*`;
        return text;
      })
      .join("\n\n");

    const summaryPrompt = `You are a memory compressor for a Telegram accounting assistant bot.

Compress the following conversation into a highly condensed format.

Required sections (in this exact format):
## User: ${username} (chat/${chatId})
**Topics**: 3-5 keywords in Russian/English
**Key decisions**:
- actionable decision 1
- actionable decision 2
**Open items**:
- pending task 1
- pending task 2
**Entities**:
- company name or invoice or person

Rules for compression:
1. Preserve ALL numbers: amounts (RUB), dates, invoice numbers, BIN/INN
2. Preserve ALL company names, person names, contact info
3. Keep it under 300 words total
4. Use bullet points, not paragraphs
5. Merge similar topics together
6. If there are no open items, write "No open items"
7. If no entities mentioned, write "No specific entities mentioned"

---
Conversation:
${conversation}

---
Compressed memory (format exactly as shown above):`;

    const args = [
      "--model",
      MODEL,
      "--offline",
      "--no-skills",
      "--no-themes",
      "--no-context-files",
      "-p",
      summaryPrompt
    ];

    const child = spawn(PI_PATH, args, {
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1", PI_TELEMETRY: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Summarization timeout (2 minutes)"));
    }, 120000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Pi exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Summarize all closed sessions (older than 1 hour).
 *
 * @returns {Promise<Array>} Array of results { chatId, username, success, summary }
 */
async function summarizeAllClosed() {
  const closedSessions = getClosedSessions();
  const todaySummaryFile = getTodaySummaryFile();
  const results = [];

  // Also force-summarize sessions that are too large
  const allFiles = fs
    .readdirSync(MESSAGES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({
      chatId: f.replace(".md", ""),
      filePath: path.join(MESSAGES_DIR, f),
      lastActive: "",
      ageMs: 0,
      ageMinutes: 0
    }));

  // Merge: force-close any sessions that are too large
  const forcedSessions = allFiles.filter((f) => {
    const session = readSession(f.chatId);
    return session && session.messages.length > 0 && fs.readFileSync(f.filePath, "utf-8").length > 50000;
  });

  const allSessions = [
    ...closedSessions,
    ...forcedSessions.map((f) => ({
      chatId: f.chatId,
      filePath: f.filePath,
      lastActive: new Date().toISOString(),
      ageMs: 900000, // pretend they're old
      ageMinutes: 15
    }))
  ];

  for (const session of allSessions) {
    const parsed = readSession(session.chatId);
    if (!parsed || parsed.messages.length === 0) continue;

    try {
      const summary = await summarizeWithPi(session.chatId, parsed.username, parsed.messages);

      // Clean up the summary — extract just the format part
      let cleanSummary = summary;
      if (summary.includes("## User:")) {
        const startIdx = summary.indexOf("## User:");
        cleanSummary = summary.substring(startIdx);
      }

      // Read today's summary and check for existing user section
      let todayContent = fs.readFileSync(todaySummaryFile, "utf-8");

      if (hasSummaryForUser(todayContent, session.chatId)) {
        // Append to existing section (new context for this user)
        const insertPos = todayContent.lastIndexOf("## User:");
        if (insertPos > 0) {
          todayContent =
            todayContent.substring(0, insertPos) + "\n" + cleanSummary + "\n\n" + todayContent.substring(insertPos);
        } else {
          todayContent += "\n" + cleanSummary + "\n";
        }
      } else {
        todayContent += "\n" + cleanSummary + "\n";
      }

      fs.writeFileSync(todaySummaryFile, todayContent);

      // Delete raw session
      deleteSession(session.chatId);

      results.push({
        chatId: session.chatId,
        username: parsed.username,
        success: true,
        summary: cleanSummary
      });

      logMessage(
        "system",
        "maintenance",
        "assistant",
        `⏺ Session for ${parsed.username} (${session.chatId}) compressed into wiki summary. ${parsed.messages.length} message pairs processed.`,
        `Summary saved at ${todaySummaryFile}`
      );
    } catch (err) {
      console.error(`[SUMMARIZER] Failed to summarize ${session.chatId}:`, err.message);
      results.push({
        chatId: session.chatId,
        username: parsed.username,
        success: false,
        error: err.message
      });
    }
  }

  return results;
}

/**
 * Get the combined historical memory (last N days of summaries, most recent first).
 *
 * @param {number} maxDays - Number of days to include (default: 3)
 */
function getRecentHistory(maxDays = 3) {
  const files = fs
    .readdirSync(SUMMARIES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, maxDays);

  const memories = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(SUMMARIES_DIR, file), "utf-8");
    memories.push(content);
  }

  return memories.join("\n---\n\n");
}

/**
 * Extract entities from all summaries into a dedicated index.
 */
function extractEntities() {
  // This is a simpler pass — we use Pi to extract entities from today's summaries
  const files = fs.readdirSync(SUMMARIES_DIR).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return [];

  // Read all summaries
  const allSummaries = files
    .map((f) => ({
      date: f.replace(".md", ""),
      content: fs.readFileSync(path.join(SUMMARIES_DIR, f), "utf-8")
    }))
    .filter((s) => s.content.length > 100); // ignore empty

  if (allSummaries.length === 0) return [];

  // Use last 5 days
  const recent = allSummaries.slice(0, 5);

  const entitiesPrompt = `You are an entity extractor for an accounting assistant bot.
From the following compressed memories, extract all entities in this format:

## Companies
- NAME — extra info (BIN, INN, etc.)
  Last mentioned: DATE

## People
- NAME — role/contact

## Documents
- TYPE #NUMBER — amount/date/status

## Pending Tasks
- [ ] description

Memories:
${recent.map((r) => `### ${r.date}\n${r.content}`).join("\n\n")}

---
Extracted entities:`;

  return new Promise((resolve, reject) => {
    const args = [
      "--model",
      MODEL,
      "--offline",
      "--no-skills",
      "--no-themes",
      "--no-context-files",
      "-p",
      entitiesPrompt
    ];

    const child = spawn(PI_PATH, args, {
      env: { ...process.env, PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Entities extraction timeout"));
    }, 120000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Pi exited with code ${code}`));
    });
  });
}

module.exports = {
  summarizeAllClosed,
  summarizeWithPi,
  getRecentHistory,
  extractEntities,
  getTodaySummaryFile,
  SUMMARIES_DIR
};
