/**
 * wiki/logger.js — Session Logger
 *
 * Persists Telegram conversation messages to markdown files.
 * Each active chat gets its own file in wiki/messages/{chatId}.md
 * Messages are appended, trimmed to 1-hour window on each write.
 */

const fs = require("fs");
const path = require("path");

const MESSAGES_DIR = path.join(__dirname, "messages");
const ACTIVE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Ensure messages directory exists
if (!fs.existsSync(MESSAGES_DIR)) {
  fs.mkdirSync(MESSAGES_DIR, { recursive: true });
}

/**
 * Log a single message exchange to the session file.
 *
 * @param {string} chatId - Telegram chat ID
 * @param {string} username - Username or chat title
 * @param {string} userType - 'user' or 'assistant'
 * @param {string} message - Message text content
 * @param {string} extra - Optional extra (e.g., file path, model used)
 */
function logMessage(chatId, username, userType, message, extra = "") {
  const sessionFile = path.join(MESSAGES_DIR, `${chatId}.md`);
  const now = new Date();
  const timestamp = now.toISOString().replace(/T/, " ").replace(/\..+/, "");
  const dateHeader = now.toISOString();

  // If session file doesn't exist, create with header
  if (!fs.existsSync(sessionFile)) {
    let newSession = `# Session: ${chatId}\n`;
    newSession += `Username: ${username}\n`;
    newSession += `Session start: ${dateHeader}\n`;
    newSession += `Last active: ${timestamp}\n\n`;
    fs.writeFileSync(sessionFile, newSession);
  }

  // Build the message block
  let block = "";
  if (userType === "user") {
    block = `### [${timestamp}] User (${username})\n${message}\n`;
  } else {
    block = `### [${timestamp}] Бухгалтер\n${message}\n`;
  }

  if (extra) {
    block += `*${extra}*\n`;
  }

  block += `\n---\n\n`;

  // Append
  fs.appendFileSync(sessionFile, block);
  fs.appendFileSync(sessionFile, `Last active: ${timestamp}\n`);
}

/**
 * Read a session file and return parsed content.
 * Returns { sessionStart, username, messages: [{timestamp, type, text, extra}] }
 */
function readSession(chatId) {
  const sessionFile = path.join(MESSAGES_DIR, `${chatId}.md`);

  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  const content = fs.readFileSync(sessionFile, "utf-8");
  const lines = content.split("\n");

  let sessionStart = "";
  let username = "";
  const messages = [];

  // Parse header
  for (let i = 0; i < lines.length && lines[i].startsWith("#"); i++) {
    if (lines[i].startsWith("Session:")) {
      // skip
    } else if (lines[i].startsWith("Username:")) {
      username = lines[i].replace("Username: ", "").trim();
    } else if (lines[i].startsWith("Session start:")) {
      sessionStart = lines[i].replace("Session start: ", "").trim();
    }
  }

  // Parse message blocks
  let currentMsg = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith("### [")) {
      // Save previous message
      if (currentMsg) {
        messages.push(currentMsg);
      }

      // Parse: ### [2025-04-27 14:30:00] User (Ivan)
      const match = line.match(/\[(.+?)\]\s+(User|Бухгалтер)\s+\((.+?)\)/);
      if (match) {
        currentMsg = {
          timestamp: match[1],
          type: match[2] === "User" ? "user" : "assistant",
          title: `${match[2]} (${match[3]})`,
          text: "",
          extra: ""
        };
      }
    } else if (line.startsWith("*") && currentMsg) {
      // Extra info (file references)
      currentMsg.extra = line.replace(/^\*|\*$/g, "").trim();
    } else if (line === "---" || line === "") {
      // End of message block
      // skip
    } else if (line.startsWith("Last active:")) {
      // Skip footer
    } else if (line.startsWith("#") || line.startsWith("Username:") || line.startsWith("Session start:")) {
      // Header
    } else if (currentMsg) {
      currentMsg.text += (currentMsg.text ? "\n" : "") + line;
    }
  }

  // Push last message
  if (currentMsg) {
    messages.push(currentMsg);
  }

  return { sessionStart, username, messages };
}

/**
 * Get all sessions that are older than the active window.
 * A session is considered "closed" if its last activity was more than 1 hour ago.
 */
function getClosedSessions() {
  const files = fs.readdirSync(MESSAGES_DIR);
  const now = Date.now();
  const closedSessions = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = path.join(MESSAGES_DIR, file);
    const stat = fs.statSync(filePath);
    const sessionContent = fs.readFileSync(filePath, "utf-8");

    // Extract last active timestamp from header
    const lastActiveMatch = sessionContent.match(/^Last active: (\S+ \S+)/m);
    if (!lastActiveMatch) continue;

    const lastActive = new Date(lastActiveMatch[1]).getTime();
    const age = now - lastActive;

    if (age > ACTIVE_WINDOW_MS) {
      closedSessions.push({
        chatId: file.replace(".md", ""),
        filePath,
        lastActive: lastActiveMatch[1],
        ageMs: age,
        ageMinutes: Math.round(age / 60000)
      });
    }
  }

  return closedSessions;
}

/**
 * Delete a session file (used after summarization).
 */
function deleteSession(chatId) {
  const sessionFile = path.join(MESSAGES_DIR, `${chatId}.md`);
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
    return true;
  }
  return false;
}

/**
 * Estimate token count (rough: ~1 word = 1.3 tokens, ~4 chars = 1 token for English, ~1 char = 1 char for Russian)
 */
function estimateTokens(text) {
  const russianChars = text.match(/[\u0400-\u04FF]/g);
  const russianWords = (russianChars || []).length * 0.75; // rough Russian token estimation
  const englishChars = text.replace(/[\u0400-\u04FF]/g, "");
  const englishTokens = Math.ceil(englishChars.length / 4);
  return Math.ceil(russianWords + englishTokens);
}

/**
 * Check if a session file exceeds the configured size limit (to prevent bloating).
 * Default max: 50,000 chars (about ~8K tokens for mixed Russian/English).
 */
function isSessionTooLarge(chatId, maxChars = 50000) {
  const sessionFile = path.join(MESSAGES_DIR, `${chatId}.md`);
  if (!fs.existsSync(sessionFile)) return false;
  const content = fs.readFileSync(sessionFile, "utf-8");
  return content.length > maxChars;
}

module.exports = {
  logMessage,
  readSession,
  getClosedSessions,
  deleteSession,
  estimateTokens,
  isSessionTooLarge,
  MESSAGES_DIR,
  ACTIVE_WINDOW_MS
};
