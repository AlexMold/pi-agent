/**
 * wiki/context-builder.js — Context Assembler
 *
 * Assembles the complete context string for any given chat session.
 * Combines: active session + historical memory + entity index.
 * This context is prepended to user queries before sending to Pi.
 */

const { readSession, estimateTokens } = require("./logger");
const { getRecentHistory } = require("./summarizer");
const fs = require("fs");
const path = require("path");

const SUMMARIES_DIR = path.join(__dirname, "summaries");
const ENTITIES_FILE = path.join(SUMMARIES_DIR, "entities.md");
const MAX_ACTIVE_SESSION_CHARS = 15000; // ~3K tokens for active session
const MAX_RECENT_SUMMARIES = 3; // days of history
const MAX_ENTITIES_CHARS = 5000; // ~1K tokens for entities

/**
 * Read and trim a file's content to max chars.
 */
function readTrimmed(filePath, maxChars) {
  if (!fs.existsSync(filePath)) return "";
  let content = fs.readFileSync(filePath, "utf-8");
  if (content.length > maxChars) {
    content = content.substring(0, maxChars) + "\n\n[... truncated ...]";
  }
  return content;
}

/**
 * Assemble context for a given chat ID.
 *
 * @param {string} chatId - Telegram chat ID
 * @returns {{ context: string, tokens: number, components: object }}
 */
function assembleContext(chatId) {
  const components = {};
  let contextParts = [];
  let totalTokens = 0;

  // 1. SYSTEM PROMPT (always included)
  const dateStr = new Date().toISOString().split("T")[0];
  const timeStr = new Date().toTimeString().split(" ")[0];

  // 2. ACTIVE SESSION (per-chat, last 1h)
  const session = readSession(chatId);
  if (session && session.messages.length > 0) {
    let sessionContent = `# Active Session: ${chatId}\n`;
    sessionContent += `Username: ${session.username}\n`;
    sessionContent += `Since: ${session.sessionStart}\n\n`;

    // Filter to last 1 hour
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentMessages = session.messages.filter((m) => {
      const msgTime = new Date(m.timestamp.replace(/ /, "T")).getTime();
      return msgTime > oneHourAgo;
    });

    // Check if we need to trim
    let assembledMsgs = recentMessages
      .map((m) => {
        let block = `## [${m.timestamp}] ${m.title}\n${m.text}\n`;
        if (m.extra) block += `*${m.extra}*\n`;
        return block;
      })
      .join("\n---\n\n");

    // If too long, trim from the beginning (oldest first)
    let maxCharsToUse = MAX_ACTIVE_SESSION_CHARS;
    while (assembledMsgs.length > maxCharsToUse && recentMessages.length > 2) {
      // Remove oldest message and retry
      recentMessages.shift();
      assembledMsgs = recentMessages
        .map((m) => {
          let block = `## [${m.timestamp}] ${m.title}\n${m.text}\n`;
          if (m.extra) block += `*${m.extra}*\n`;
          return block;
        })
        .join("\n---\n\n");
    }

    sessionContent = `# Active Session: ${chatId}\nUsername: ${session.username}\n\n`;
    sessionContent += assembledMsgs;
    sessionContent += `\n\n---`;

    components.activeSession = sessionContent;
    totalTokens += estimateTokens(sessionContent);
  }

  // 3. HISTORICAL MEMORY (last N days, compressed summaries)
  const history = getRecentHistory(MAX_RECENT_SUMMARIES);
  if (history && history.length > 0) {
    components.history = history;
    totalTokens += estimateTokens(history);
  }

  // 4. ENTITY INDEX (cross-references)
  if (fs.existsSync(ENTITIES_FILE)) {
    const entities = readTrimmed(ENTITIES_FILE, MAX_ENTITIES_CHARS);
    if (entities && entities.length > 20) {
      components.entities = entities;
      totalTokens += estimateTokens(entities);
    }
  }

  // 5. BUILD FINAL CONTEXT STRING
  const dateHeader = `---\n\`[Date: ${dateStr} Time: ${timeStr}]\`\n---\n\n`;

  // Historical memory first, then active session (so the LLM sees context then current state)
  if (components.history) {
    contextParts.push(dateHeader);
    contextParts.push(components.history);
  }

  if (components.activeSession) {
    contextParts.push(dateHeader);
    contextParts.push(components.activeSession);
  }

  if (components.entities) {
    contextParts.push(dateHeader);
    contextParts.push(components.entities);
  }

  const fullContext = contextParts.join("\n");

  return {
    context: fullContext,
    tokens: totalTokens,
    components,
    hasActiveSession: !!components.activeSession,
    hasHistory: !!components.history
  };
}

/**
 * Check if there is ANY wiki memory for this user.
 */
function hasMemoryForUser(chatId) {
  const session = readSession(chatId);
  if (session) return true;

  // Check summaries
  const files = fs.readdirSync(SUMMARIES_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const content = fs.readFileSync(path.join(SUMMARIES_DIR, file), "utf-8");
    if (content.includes(`(chat/${chatId})`)) return true;
  }

  return false;
}

/**
 * Get a summary of the wiki's current state.
 */
function getWikiStats() {
  const messageDir = path.join(__dirname, "messages");
  const summaryDir = path.join(__dirname, "summaries");

  const activeSessions = fs.readdirSync(messageDir).filter((f) => f.endsWith(".md")).length;

  const summaryFiles = fs.readdirSync(summaryDir).filter((f) => f.endsWith(".md")).length;

  const totalSize =
    fs.readdirSync(messageDir).reduce((acc, f) => acc + fs.statSync(path.join(messageDir, f)).size, 0) +
    fs.readdirSync(summaryDir).reduce((acc, f) => acc + fs.statSync(path.join(summaryDir, f)).size, 0);

  const entitiesFileExists = fs.existsSync(ENTITIES_FILE);

  return {
    activeSessions,
    summaryFiles,
    totalSizeKB: Math.round(totalSize / 1024),
    hasEntitiesIndex: entitiesFileExists,
    date: new Date().toISOString()
  };
}

module.exports = {
  assembleContext,
  hasMemoryForUser,
  getWikiStats
};
