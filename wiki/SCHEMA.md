# Wiki Schema — Context Management for Telegram Accounting Bot

## Philosophy

This wiki replaces RAG for the Telegram bot. Instead of embedding+retrieval, we incrementally
**compile** conversation knowledge into structured files the LLM reads on every query.
The wiki compounds: every conversation enriches it, every maintenance pass keeps it tight.

**Privacy**: All files live on your machine. No vectors uploaded, no external API calls for memory.

**Context**: Two-tier approach matching Gemma 4's 128K context window:

- **Active session** (last 1h): full message detail, loaded per-chat
- **Historical summaries** (older than 1h): condensed highlights, loaded by topic

## Directory Structure

```
wiki/
├── SCHEMA.md                 ← This file: the rules
├── logger.js                 ← Message logger: saves raw sessions to markdown
├── context-builder.js        ← Assembles context for any query
├── summarizer.js             ← Compresses old sessions into wiki summaries
├── maintenance.js            ← Periodic cleanup & re-compression
├── wiki-state.json           ← Machine-readable state index
├── messages/                 ← Raw session logs (per-chat markdown)
│   └── {chat-id}.md          ← One file per active chat session
├── summaries/                ← Compressed conversation summaries
│   └── {YYYY-MM-DD}.md       ← One file per day's compressed memories
└── state/                    ← Auxiliary state files
    └── users.json            ← Per-user metadata
```

## Tier 1: Active Sessions (Last 1 Hour)

### Storage Format — `messages/{chat-id}.md`

```markdown
# Session: {chat-id}

Last active: {ISO timestamp}

## Active since: {session-start-timestamp}

### [{user-timestamp}] User ({username})

{user-message-text}

### [{assistant-timestamp}] Бухгалтер

{assistant-response-text}
[attached files/filenames mentioned]

---
```

### Rules

- **One file per chat ID** — the bot accumulates all messages for a user into a single file
- **Append only** — new messages get appended, never rewritten
- **Trim before write** — remove entries older than 1 hour before saving
- **Header tracks session start** — `sessionStart` timestamp in metadata

### Why this works

Gemma 4 on `gemma4:latest` has 128K tokens. In a 1-hour conversation this bot sees
maybe 20-50 messages per user. At ~200 tokens each, that's 4K-10K tokens — trivially small.
The LLM reads this file directly on every query to maintain continuity.

## Tier 2: Historical Summaries (Older than 1 Hour)

### Storage Format — `summaries/{YYYY-MM-DD}.md`

```markdown
# Memory Compressed: YYYY-MM-DD

## User: {name} (chat/{id})

**Topics**: invoice, tax, deadline
**Key decisions**:

- Agreed to use OSNO calculation method
- Invoice #12345 corrected with new BIN
  **Open items**:
- Waiting for document scan
- Tax return pending review

## User: {name} (chat/{id})

**Topics**: pricing, delivery
**Key decisions**:

- Agreed to 15% discount for bulk order
- Delivery scheduled for Monday
  **Open items**: None

## Entities Discussed

- Company: ООО "Ромашка" (BIN: 1234567890)
- Invoice: #12345 — 50,000 RUB
- Person: Иванов И.И. (contact)
```

### Compression Algorithm (run by `summarizer.js`)

1. **Detect closed session**: User hasn't sent a message in >1 hour
2. **Read full session** from `messages/{chat-id}.md`
3. **Send to Pi** for summarization using a condensed prompt
4. **Write summary** to the daily summary file
5. **Delete raw session** from `messages/` (the summary replaces the detail)
6. **Update wiki-state.json** to track compressed memories

### Summary Prompt (used in summarizer.js)

```
You are a memory compressor for an accounting assistant bot.

Compress the following conversation into a highly condensed format:

1. **Topics** — 3-5 keywords summarizing the conversation
2. **Key decisions** — bulleted list of actionable decisions (max 5)
3. **Open items** — pending tasks or follow-ups (max 5)
4. **Entities** — companies, invoices, amounts, people mentioned

Format:
```

## User: {username} ({chat-id})

**Topics**: keyword1, keyword2, keyword3
**Key decisions**:

- decision 1
- decision 2
  **Open items**:
- pending item 1
- pending item 2
  **Entities**:
- entity description

```

Rules:
- Be ultra-concise. No conversational filler.
- Preserve ALL actionable info (numbers, dates, IDs, amounts).
- Merge with existing summary if same user discussed today.
- If user talked about multiple topics, list them all.

---
Conversation to compress:
{full-session-text}
```

## Tier 3: Entity Index (Cross-References)

### Storage Format — `summaries/entities.md`

```markdown
# Entity Index

## Companies

- **ООО "Ромашка"** — BIN: 1234567890, INN: 123456789
  Last mentioned: 2025-04-27
  Related: invoices #12345, #12346
- **ИП Сидоров** — BIN: 987654321
  Last mentioned: 2025-04-25
  Related: contract discussion

## Key Contacts

- **Иванов И.И.** — email: ivanov@example.com, phone: +7...
  Last: 2025-04-27

## Pending Tasks

- [ ] Review invoice #12345 for ООО "Ромашка"
- [x] Send tax return — completed 2025-04-26
```

### When it updates

- Updated during summarization: entities extracted from conversations are added/refreshed
- Updated during maintenance pass if new entities spotted

## Context Assembly (for every query)

### `context-builder.js` — assembleContext(chatId)

Builds the context string sent to the LLM:

```
=== ACTIVE SESSION CONTEXT ===
{content of messages/{chatId}.md}  (if exists, recent only)

=== RECENT WI MEMORY ===
{last 3 compressed summary files, most recent}

=== ENTITY INDEX ===
{content of summaries/entities.md} (excerpt, top 20 entities shown)

=== CURRENT DATE/TIME ===
{current timestamp}
```

### Token budget allocation (gemma4:latest, 128K context)

| Component         | Budget                   | Notes                     |
| ----------------- | ------------------------ | ------------------------- |
| System prompt     | ~200 tokens              | Role, instructions        |
| Active session    | ~5,000 tokens            | Last 1h messages per chat |
| Recent summaries  | ~5,000 tokens            | Last 2-3 compressed days  |
| Entity index      | ~3,000 tokens            | Top entities only         |
| User query        | ~1,000 tokens            | Current message           |
| Response buffer   | ~remaining               | Where the LLM generates   |
| **Safety margin** | **~100,000 tokens free** | We're well under limit    |

Even with heavy use, total context stays well within 128K tokens.

### Strategy

1. Load active session for the current chatId
2. Load last 3 summary files (most recent)
3. Load entity index excerpt
4. Combine into single Markdown string
5. Return to caller to prepend before the user query

## Operations

### Ingest (automatic)

Every user message triggers:

1. Append to `messages/{chatId}.md`
2. If session is dormant >1h → trigger summarizer
3. Update `wiki-state.json` timestamp

### Query (automatic)

Before every LLM call:

1. `context-builder.js` assembles context string
2. Context is prepended to the prompt sent to Pi
3. LLM sees both current conversation AND historical memory

### Maintenance (manual — run via cron)

```bash
node wiki/maintenance.js
```

Runs:

1. Prune sessions older than 6 hours without activity
2. Check all sessions for dormancy (>1h) — summarize any found
3. Run entity index extraction from all summaries
4. Delete summaries older than 14 days
5. Log operations to `messages/maintenance.log`

### Lint (periodic — weekly)

```bash
node wiki/maintenance.js --lint
```

Additional checks:

1. Detect contradictions between summaries
2. Find orphan entities (no recent mentions)
3. Check for stale data (invoices marked complete but still in "pending")
4. Verify no summary file exceeds 5000 characters

## Index & Logging

### wiki-state.json (machine-readable index)

```json
{
  "users": {
    "12345": {
      "username": "Ivan",
      "lastActive": "2025-04-27T14:30:00.000Z",
      "sessionActive": true,
      "sessionId": "2025-04-27-14:30",
      "comressedSessions": [{ "date": "2025-04-27", "summaryFile": "summaries/2025-04-27.md" }],
      "totalMessages": 47
    }
  },
  "activeSessions": 2,
  "compressedSessions": 15,
  "entities": 8,
  "lastCronRun": "2025-04-27T14:00:00.000Z"
}
```

### maintenance.log (chronological append-only)

```
## [2025-04-27 14:00:00] prune | Removed 0 dormant sessions (last activity threshold: 6h)
## [2025-04-27 14:00:00] summarize | User 12345 session compressed → summaries/2025-04-27.md
## [2025-04-27 14:00:01] entities | Updated entity index: 8 entities found
## [2025-04-27 14:00:01] cleanup | Deleted 0 summaries older than 14 days
```

## Tips and Tricks

- **Use `/wiki` command** to trigger immediate summarization of current session
- **Use `/wiki status`** to show current wiki stats
- **Use `/wiki memory`** to show recent historical memory
- **Cron job** recommended: every 30 minutes → `cd /path/to/repo && node wiki/maintenance.js`
- **Git** the `wiki/` directory for version history — sessions compress, not delete
- **Docker** — the wiki lives inside the container; configure volume mount if you want persistence across restarts

## Why this works for our bot

| Problem            | RAG approach                          | Wiki approach                            |
| ------------------ | ------------------------------------- | ---------------------------------------- |
| Privacy            | Vectors often sent to cloud           | 100% local files                         |
| Accumulation       | Every query rediscover from scratch   | Compounds over time                      |
| Context cost       | Embeddings + retrieval = extra tokens | Structured memory = predictable tokens   |
| Multi-step tasks   | LLM forgets step 1 by step 5          | Wiki remembers decisions across sessions |
| Maintenance burden | Vector DB drift, chunking issues      | Simple file append, periodic summarize   |
| Our constraint     | Needs to work with Pi CLI spawning    | Pure Node.js, no extra dependencies      |

## Adaptation Notes

This schema is intentionally flexible. You can:

- Change the active session window (default: 1 hour)
- Change the summary retention period (default: 14 days)
- Add custom entity types (e.g., add `contracts`, `contacts`)
- Increase summary depth if using `gemma4:31b` (bigger model, more context)
- Reduce summary depth if using edge models (smaller context = tighter compression)
