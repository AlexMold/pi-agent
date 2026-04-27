# Wiki Context System — Documentation

## Overview

This is the **Wiki Context System** for the Telegram accounting bot. It replaces RAG (Retrieval-Augmented Generation) with a structured, incrementally-maintained knowledge base of conversation history.

**Key benefits:**

- 🔒 **Privacy**: All data stays local — no vectors sent to the cloud
- 🧠 **Compound memory**: Every conversation enriches the wiki, nothing is lost
- 📦 **Predictable context**: Structured memory replaces unpredictable embedding retrieval
- ⚡ **Fast**: Simple file reads, no complex vector search needed

## Architecture

Three-layer design matched to Gemma 4's context window:

```
┌─────────────────────────────────────────────────┐
│                 LLM Query (Gemma 4)              │
├─────────────────────────────────────────────────┤
│ context-builder.js assembles:                   │
│                                                   │
│ 1. Historical summaries (last N days)           │ ◄── Tier 2: Condensed
│ 2. Active session (last 1h)                      │ ◄── Tier 1: Full detail
│ 3. Entity index (cross-references)              │ ◄── Tier 3: Key facts
│                                                   │
│ → Prepended to user query → sent to Pi CLI     │
└─────────────────────────────────────────────────┘
         ↕ logMessage()          ↕
┌──────────────────┐    ┌───────────────────┐
│ messages/        │    │ summaries/        │
│ {chatId}.md      │    │ {YYYY-MM-DD}.md   │
│ (per-chat)       │    │ (daily memory)    │
├──────────────────┤    ├───────────────────┤
│ entity index     │    │ entities.md       │
│ extracted from   │    │ (key facts)       │
│ summaries        │    └───────────────────┘
└──────────────────┘
```

## Quick Start

### 1. Ensure it's enabled (default: on)

In `.env`:

```bash
WIKI_ENABLED=true  # or "false" to disable
WIKI_MAX_SUMMARIES=3  # days of history to keep
```

### 2. Start using the bot — it's automatic!

Every message you send gets logged. Context is assembled automatically. No setup needed.

### 3. Run maintenance (for cron)

```bash
node wiki/maintenance.js          # Full maintenance
node wiki/maintenance.js --stats  # Show stats
node wiki/maintenance.js --lint   # Health check
node wiki/maintenance.js --force  # Force compress all
```

### 4. Bot commands

```
/wiki                    — Wiki status & stats
/wiki memory             — Show recent historical memory
/wiki summarize          — Compress current session into memory
/wiki stats              — Quick stats summary
```

## Directory Reference

```
wiki/
├── SCHEMA.md              ← Full design documentation
├── logger.js              ← Session logger (core API)
├── context-builder.js     ← Assembles context for queries
├── summarizer.js          ← LLM-based session compression
├── maintenance.js         ← Background cleanup & compression
├── wiki-state.json        ← Machine-readable state
├── messages/              ← Active session logs (per-chat)
│   ├── {chat-id}.md       ← One file per active chat
│   └── maintenance.log    ← Append-only operation log
├── summaries/             ← Compressed conversation memories
│   ├── {YYYY-MM-DD}.md    ← One file per day's memories
│   └── entities.md        ← Cross-referenced entity index
└── state/                 ← Auxiliary state
    └── users.json         ← Per-user metadata
```

## How Context Assembly Works

For every query, `context-builder.js` runs `assembleContext(chatId)`:

```javascript
const ctx = wikiContext.assembleContext(chatId);
// Returns:
{
  context: "full markdown context string",
  tokens: 12450,          // approximate token count
  components: {
    history: "...",       // compressed summaries from recent days
    activeSession: "...", // current session messages
    entities: "..."       // entity index excerpt
  },
  hasActiveSession: true,
  hasHistory: true
}
```

The assistant prepends this to the user query:

```
---
Context Wiki
{ctx.context}
---

{user's actual question}
```

## Token Budget (gemma4:latest, 128K context)

| Component        | Typical Size       | Notes                    |
| ---------------- | ------------------ | ------------------------ |
| System prompt    | ~200 tokens        | Role + instructions      |
| Active session   | ~2K–5K tokens      | Last 1h messages         |
| Recent summaries | ~3K–8K tokens      | Last 3 compressed days   |
| Entity index     | ~1K–3K tokens      | Top entities only        |
| User query       | ~200–1K tokens     | Current message + images |
| **Total**        | **~9K–22K tokens** | Well under 128K          |

Even with heavy use, context stays ~15% of the available window.

## Cron Setup

For automatic maintenance every 30 minutes:

```bash
# Add to crontab
crontab -e

# Run maintenance every 30 minutes
*/30 * * * * /home/user/repo/scripts/run-wiki-cron.sh
```

## Docker Persistence

The wiki data lives in `wiki/`. To persist across container restarts:

```yaml
# docker-compose.yml
services:
  bot:
    volumes:
      - ./wiki:/app/wiki # Mount wiki directory
```

Then git-add the wiki files (or exclude from git if too large):

```bash
# .dockerignore or .gitignore
# wiki/messages/
# wiki/summaries/*.md
```

## Troubleshooting

### Context too large

```bash
# Reduce history window
WIKI_MAX_SUMMARIES=2

# Or use the bigger model
# (gemma4:31b has 256K context)
```

### Summarization failing

```bash
# Check if Pi is running properly
node -e "require('./wiki/summarizer').summarizeAllClosed().then(r => console.log(r))"

# Check logs
tail -20 wiki/messages/maintenance.log
```

### Session not closing

Sessions close automatically after 1 hour of inactivity, or when they exceed 50K chars:

```bash
# Force close all sessions
node wiki/maintenance.js --force

# Check active sessions
ls -la wiki/messages/
```

## Contributing

See `SCHEMA.md` for the full design spec including:

- Storage format details
- Compression algorithm
- Entity index conventions
- Lint procedures

This is inspired by the LLM Wiki concept (note that this is intentionally adapted for the Telegram bot use case with Gemma 4's context constraints).
