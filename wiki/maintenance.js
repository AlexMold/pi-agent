/**
 * wiki/maintenance.js — Background Maintenance
 *
 * Periodic cleanup: summarize closed sessions, prune old files,
 * extract entity index, log all operations.
 *
 * Usage:
 *   node wiki/maintenance.js          — run full maintenance
 *   node wiki/maintenance.js --lint   — run lint checks only
 *   node wiki/maintenance.js --force  — force summarization of ALL sessions
 *   node wiki/maintenance.js --stats  — show wiki statistics
 */

const { getClosedSessions, deleteSession, ACTIVE_WINDOW_MS } = require("./logger");
const { summarizeAllClosed, extractEntities, getRecentHistory, SUMMARIES_DIR } = require("./summarizer");
const { getWikiStats } = require("./context-builder");
const fs = require("fs");
const path = require("path");

const MESSAGES_DIR = path.join(__dirname, "messages");
const STATE_DIR = path.join(__dirname, "state");
const LOG_FILE = path.join(__dirname, "messages", "maintenance.log");

const PRUNE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
const SUMMARY_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const LINT_MAX_CHARS = 50000;
const ENTITY_MAX_COUNT = 50;

// Initialize
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function writeLog(entry) {
  const now = new Date();
  // Format: ## [YYYY-MM-DD HH:MM:SS] action | message
  const timestamp = now.toISOString().replace("T", " ").replace(/\..+/, "");
  const line = `## [${timestamp}] ${entry.action} | ${entry.message}\n`;

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, line);
  } else {
    fs.appendFileSync(LOG_FILE, line);
  }

  console.log(`[${timestamp}] ${entry.action}: ${entry.message}`);
}

/**
 * Prune sessions older than PRUNE_THRESHOLD_MS without activity.
 */
function pruneDormantSessions() {
  const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".md"));
  let pruned = 0;

  for (const file of files) {
    const filePath = path.join(MESSAGES_DIR, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf-8");

    // Check if session is old enough to prune
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > PRUNE_THRESHOLD_MS) {
      // Also check if it has been summarized already
      const chatId = file.replace(".md", "");
      const hasHistory = checkHistoryExists(chatId);

      // Only prune if it's been closed for >1h (meaning summarizer should have run)
      const lastActiveMatch = content.match(/^Last active: (\S+ \S+)/m);
      if (lastActiveMatch) {
        const lastActive = new Date(lastActiveMatch[1]);
        const inactivityMs = Date.now() - lastActive.getTime();

        if (inactivityMs > ACTIVE_WINDOW_MS && hasHistory) {
          fs.unlinkSync(filePath);
          writeLog({ action: "prune", message: `Deleted ${file} (inactive ${Math.round(inactivityMs / 3600000)}h)` });
          pruned++;
        }
      }
    }
  }

  writeLog({ action: "prune", message: `Removed ${pruned} dormant sessions` });
  return pruned;
}

function checkHistoryExists(chatId) {
  // Check if any summary mentions this chatId
  const files = fs.readdirSync(SUMMARIES_DIR).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const content = fs.readFileSync(path.join(SUMMARIES_DIR, f), "utf-8");
    if (content.includes(`chat/${chatId}`)) return true;
  }
  return false;
}

/**
 * Summarize any closed or oversized sessions.
 */
async function summarizeDormantSessions() {
  const results = await summarizeAllClosed();
  writeLog({
    action: "summarize",
    message: `Processed ${results.length} sessions (${results.filter((r) => r.success).length} succeeded, ${results.filter((r) => !r.success).length} failed)`
  });
  return results;
}

/**
 * Extract entity index from all summaries.
 */
async function extractEntityIndex() {
  try {
    const entities = await extractEntities();

    if (entities && entities.length > 0) {
      // Write/update entity index
      fs.writeFileSync(path.join(SUMMARIES_DIR, "entities.md"), entities);
      writeLog({ action: "entities", message: `Entity index updated (${entities.length} chars)` });
    }
  } catch (err) {
    writeLog({ action: "entities", message: `Extraction failed: ${err.message}` });
  }
}

/**
 * Delete summaries older than SUMMARY_RETENTION_MS.
 */
function cleanupOldSummaries() {
  const files = fs.readdirSync(SUMMARIES_DIR).filter((f) => f.endsWith(".md") && f !== "entities.md");
  let deleted = 0;

  for (const file of files) {
    const filePath = path.join(SUMMARIES_DIR, file);
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;

    if (ageMs > SUMMARY_RETENTION_MS) {
      fs.unlinkSync(filePath);
      writeLog({ action: "cleanup", message: `Deleted ${file} (${Math.round(ageMs / 86400000)} days old)` });
      deleted++;
    }
  }

  writeLog({
    action: "cleanup",
    message: `Removed ${deleted} summaries older than ${SUMMARY_RETENTION_MS / 86400000} days`
  });
  return deleted;
}

/**
 * Lint checks: find issues in the wiki.
 */
function lintWiki() {
  const issues = [];

  // Check for bloated session files
  const files = fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".md"));
  for (const file of files) {
    const filePath = path.join(MESSAGES_DIR, file);
    const content = fs.readFileSync(filePath, "utf-8");
    if (content.length > LINT_MAX_CHARS) {
      issues.push(`BLOATED session: ${file} (${Math.round(content.length / 1024)}KB)`);
    }
  }

  // Check for orphan summaries (summarize files mentioning non-existent chats)
  const summaryFiles = fs.readdirSync(SUMMARIES_DIR).filter((f) => f.match(/2\d{6}\.md$/));
  for (const f of summaryFiles) {
    const content = fs.readFileSync(path.join(SUMMARIES_DIR, f), "utf-8");
    const matches = content.match(/chat\/(\d+)/g);
    if (matches) {
      for (const m of matches) {
        const chatId = m.replace("chat/", "");
        if (!fs.existsSync(path.join(MESSAGES_DIR, `${chatId}.md`))) {
          // Not an issue — session was already deleted after summarization
        }
      }
    }
  }

  // Check summary size limits
  for (const f of summaryFiles) {
    const content = fs.readFileSync(path.join(SUMMARIES_DIR, f), "utf-8");
    if (content.length > 20000) {
      issues.push(`BLOATED summary: ${f} (${Math.round(content.length / 1024)}KB) — needs further compression`);
    }
  }

  if (issues.length === 0) {
    writeLog({ action: "lint", message: "Wiki health OK — no issues found" });
  } else {
    for (const issue of issues) {
      writeLog({ action: "lint", message: issue });
    }
  }

  return issues;
}

/**
 * Show statistics.
 */
function showStats() {
  const stats = getWikiStats();
  console.log("\n" + "=".repeat(50));
  console.log("  Wiki Statistics");
  console.log("=".repeat(50));
  console.log(`  Active sessions:  ${stats.activeSessions}`);
  console.log(`  Summary files:    ${stats.summaryFiles}`);
  console.log(`  Total size:       ${stats.totalSizeKB}KB`);
  console.log(`  Entity index:     ${stats.hasEntitiesIndex ? "✅ yes" : "❌ no"}`);
  console.log(`  Timestamp:        ${stats.date}`);
  console.log("=".repeat(50) + "\n");
}

/**
 * MAIN ROUTER
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log(`\n[MAINTENANCE] Starting...`);

  switch (command) {
    case "--stats":
      showStats();
      process.exit(0);
      break;

    case "--lint":
      console.log("[MAINTENANCE] Running lint checks...\n");
      lintWiki();
      process.exit(0);
      break;

    case "--force":
      console.log("[MAINTENANCE] Force-summarizing all sessions...\n");
      // Summarize everything regardless of age
      const fs = require("fs");
      const { readSession } = require("./logger");
      const { summarizeWithPi } = require("./summarizer");

      for (const file of fs.readdirSync(MESSAGES_DIR).filter((f) => f.endsWith(".md"))) {
        const chatId = file.replace(".md", "");
        const parsed = readSession(chatId);
        if (parsed && parsed.messages.length > 0) {
          await summarizeWithPi(chatId, parsed.username, parsed.messages);
          deleteSession(chatId);
          console.log(`  ✅ Compressed ${chatId}`);
        }
      }
      process.exit(0);
      break;

    case "--help":
      console.log("Usage: node wiki/maintenance.js [option]");
      console.log("");
      console.log("Options:");
      console.log("  (none)     Full maintenance run");
      console.log("  --stats    Show wiki statistics");
      console.log("  --lint     Run lint checks only");
      console.log("  --force    Force-summarize ALL open sessions");
      console.log("  --help     Show this help");
      process.exit(0);
      break;

    default:
      // Full maintenance
      console.log("[MAINTENANCE] Running full maintenance cycle...\n");

      // Step 1: Summarize closed sessions
      console.log("  📝 Summarizing closed sessions...");
      await summarizeDormantSessions();

      // Step 2: Extract entity index
      console.log("  🏷️  Extracting entity index...");
      await extractEntityIndex();

      // Step 3: Prune dormant sessions
      console.log("  🧹 Pruning dormant sessions...");
      pruneDormantSessions();

      // Step 4: Cleanup old summaries
      console.log("  ♻️  Cleaning up old summaries...");
      cleanupOldSummaries();

      console.log("\n[MAINTENANCE] Complete.\n");
      break;
  }
}

// Auto-run if called directly (not imported)
if (require.main === module) {
  main().catch((err) => {
    console.error("[MAINTENANCE] FATAL:", err);
    process.exit(1);
  });
}

// Export for programmatic use
module.exports = {
  pruneDormantSessions,
  summarizeDormantSessions,
  extractEntityIndex,
  cleanupOldSummaries,
  lintWiki,
  showStats,
  writeLog
};
