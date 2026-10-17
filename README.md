# AI Assistant Pro

Telegram AI assistant with smart routing, vector memory, voice input, and integrations: calendar, smart home, reminders, web search.

## Architecture

```
User (Telegram) → grammY Bot → SmartRouter → LLM → Response
                                     │        │
                    ┌────────────────┴───┐  ┌─┴──────────────────────┐
                    │ Ollama (host)      │  │ llama.cpp (local, opt.)│
                    │ qwen2.5:0.5b       │  ├────────────────────────┤
                    │ classifier; LanceDB│  │ DeepSeek V4 Pro / Flash│
                    │ embeddings         │  │ Gemini 2.5 Flash (vis.)│
                    └────────────────────┘  └────────────────────────┘
                                     │
                       ┌─────────────┼─────────────┐
                       │             │             │
                LongTermMemory   Reminders     Calendar
                   (LanceDB)     (JSON+R2)   (Google API)
```

The router asks a 0.5B model on the host which model to use, then Pi-Agent runs
the task on the chosen one. Cloud is the default target; the local llama model
is only picked when `DEFAULT_MODEL` points at it.

### Docker containers

| Container | Image | Purpose |
|-----------|-------|---------|
| `ai-assistant-pro` | `node:24-slim` (~400 MB) | Bot, Pi-Agent, LanceDB, tools |
| `llama-service` | `llama.cpp:server` (~1 GB) | Optional local model (idle unless `DEFAULT_MODEL=llama/llama3.2-1b`) |
| `ai-cron-worker` | `node:24-alpine` (~60 MB) | Reminders every 60s |

## Components

| File | Purpose |
|------|---------|
| `src/bot.ts` | Telegram bot (grammY) — main orchestrator |
| `src/router.ts` | SmartRouter: LLM classifier + keyword fallback |
| `src/memory.ts` | Hybrid memory: LanceDB (semantic) + ring buffer (time-based) |
| `src/agent.ts` | LLM runner: Pi-Agent (cloud) + direct API (local) |
| `src/services/reminder-store.js` | Shared reminder persistence (bot tool + cron worker read/write one file) |
| `src/services/distiller.ts` | Weekly memory distillation: facts + behavior rules from sessions, digest-based session compaction |
| `src/services/cron-worker.js` | Lightweight reminder checker (separate container) |
| `src/services/message-handler.ts` | Voice/text/photo extraction |
| `src/services/chat-queue.ts` | Per-chat preemptive message queue |
| `src/stt.ts` | Whisper.cpp client for voice messages |

### Tools (Pi Extensions)

| File | Tools |
|------|-------|
| `src/tools/search/` | `internet_search` (Serper), `tavily_search` (Tavily) |
| `src/tools/calendar/` | `manage_calendar`, `list_events`, `update_event`, `delete_event` |
| `src/tools/xiaomi/` | `control_xiaomi` — smart home over local network |
| `src/tools/memory/` | `recall_memory` — semantic search in past conversations |
| `src/tools/reminder/` | `set_reminder`, `list_reminders`, `delete_reminder` |
| `src/tools/backup.ts` | R2 backup of `.pi/agent` |

### Tests

| File | Tests | Coverage |
|------|-------|----------|
| `src/tests/router.test.ts` | 11 | SmartRouter keyword routing |
| `src/tests/chat-queue.test.ts` | 5 | Per-chat preemptive queue |
| `src/tests/bot-e2e.test.ts` | 22 | Full bot pipeline (mock-based) |
| `src/tests/reply-context.test.ts` | 20 | Reply-chain and image extraction |

## Quick Start

### 1. Get HuggingFace token

```
https://huggingface.co/settings/tokens
```

### 2. Create `.env`

```env
TELEGRAM_TOKEN=...
DEEPSEEK_API_KEY=...
GEMINI_API_KEY=...
TAVILY_API_KEY=...
SERPER_API_KEY=...
HF_TOKEN=hf_...
```

### 3. Docker

```bash
docker compose up --build -d
docker compose logs -f
```

First start also downloads the Llama-3.2-1B GGUF (~785 MB) for `llama-service`.
Running without that container: set `SKIP_LLAMA_WAIT=1` (skips a 120s health
wait) and point `DEFAULT_MODEL` at a cloud model.

### 4. Host services

The container reaches both over `host.docker.internal` (`extra_hosts` in `docker-compose.yml`):

| Service | Port | Used for | Install |
|---------|------|----------|---------|
| Ollama | 11434 | Routing classifier + LanceDB embeddings | `ollama pull qwen2.5:0.5b`, `ollama pull nomic-embed-text` |
| Whisper.cpp | 8080 | Voice messages (STT) | `npm run whisper:setup && npm run whisper:start` or `docker/whisper.service` |

With Ollama down the router still works: it falls back to keyword matching and
memory search degrades to zero vectors.

### 5. Verify

```bash
npm run lint       # ESLint (JS files only)
npx tsc --noEmit   # TypeScript typecheck
npm test           # 58 tests (55 pass, 3 skipped)
```

## Features

### Smart Router

- **Classifier** → local Ollama `qwen2.5:0.5b` (fast, free), keyword fallback if Ollama is down
- **Simple queries / default** → cloud DeepSeek V4 Flash (override with `DEFAULT_MODEL`)
- **Code/refactoring/security** → cloud DeepSeek V4 Pro
- **Search keywords** → cloud DeepSeek V4 Flash
- **Images/photos** → cloud Gemini 2.5 Flash
- **>100k tokens** → automatic cloud overflow
- **Local failure** → automatic fallback to cloud
- Manual override via `/model` command
- Model selection persists in LanceDB across restarts

### Long-Term Memory

- **Pi session per chat**: full conversation history + auto-compaction (~115K tokens), survives bot restarts
- **Weekly distillation** (Sunday 04:00 or `/distill`): durable facts + behavior rules extracted into the facts table, sessions compacted with a digest
- **Known facts**: semantic top-4 injected into every prompt (behavior rules marked)
- **Ring buffer**: in-RAM recent store and fallback (not injected since the session carries recent turns)
- **LanceDB**: semantic search across entire conversation history
- **Reply context**: when user replies to a message, the original text is injected into context

### Reminders

- `set_reminder` via natural language: "remind me in 10 minutes", "remind me at 19:00"
- Cron worker checks every 60s and sends Telegram push notifications
- Persistent storage in shared workspace volume

### Google Calendar

- Create, list, update, delete events
- Automatic push notification (popup 10 min before)
- Recurrence rules support
- Timezone: Europe/Chisinau (UTC+3)

### Web Search

- `internet_search` — Serper.dev (Google index)
- `tavily_search` — AI-optimized search
- Date formatting via `date-fns`

### Xiaomi Smart Home

- Control devices via local network (miIO protocol)
- Supported: humidifier, air fryer, kettle, vacuum S5, vacuum Cinderella
- Status polling with MIOT property scanning

### Backup

- Weekly backup of `.pi/agent` to Cloudflare R2 (every Monday 6:00 AM)

## Cron Jobs

| Schedule | Container | Task |
|----------|-----------|------|
| Every 60s | `ai-cron-worker` | Check and send due reminders |
| Mon 6:00 AM | `ai-assistant-pro` | Backup to R2 |

## Available Models

### Local

| Model | Purpose |
|-------|---------|
| `llama/llama3.2-1b` | Fallback local model (785 MB GGUF, llama.cpp server) — only picked when `DEFAULT_MODEL` points at it |

### Cloud

| Model | Purpose |
|-------|---------|
| `deepseek/deepseek-v4-pro` | Complex tasks, security, migrations |
| `deepseek/deepseek-v4-flash` | Fast, cheap, web search |
| `google/gemini-2.5-flash` | Vision (images, photos) |

## Project Skills

Skills in `.pi/skills/` and `~/.pi/agent/skills/`:

| Skill | Purpose |
|-------|---------|
| `verify-before-merge` | Run lint + tsc + test before declaring done |
| `commit-and-push` | Conventional commits + push workflow |
| `plan-first` | Plan → approve → execute workflow |
