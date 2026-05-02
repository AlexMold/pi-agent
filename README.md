# AI Assistant Pro

Telegram AI-ассистент с умным роутингом, векторной памятью, голосовым вводом и интеграциями: календарь, умный дом, напоминания, веб-поиск.

## Architecture

```
User (Telegram) → grammY Bot → SmartRouter → Pi-Agent → Response
                                  │               │
                             ┌────┴────┐     ┌────┴──────────────┐
                             │ Local   │     │ Cloud             │
                             │ Ollama  │     │ DeepSeek V4       │
                             └─────────┘     └───────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
               LongTermMemory  Reminders    Calendar
               (LanceDB)       (JSON+R2)   (Google API)
```

### Docker containers

| Container | Image | Purpose |
|-----------|-------|---------|
| `ai-assistant-pro` | `node:24-slim` (~400 MB) | Bot, Pi-Agent, LanceDB, tools |
| `ai-cron-worker` | `node:24-alpine` (~60 MB) | Reminders every 60s |

## Components

| File | Purpose |
|------|---------|
| `src/bot.ts` | Telegram bot (grammY) — main orchestrator |
| `src/router.ts` | SmartRouter: keyword-based + token-count routing |
| `src/memory.ts` | Hybrid memory: LanceDB (semantic) + ring buffer (time-based) |
| `src/agent.ts` | Pi-Agent runner with extension loading |
| `src/services/reminder.ts` | Per-user reminders with persistent JSON storage |
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
| `src/tests/bot-e2e.test.ts` | 16 | Full bot pipeline (mock-based) |

## Quick Start

### 1. Host: Start Ollama

```bash
ollama serve
ollama pull gemma4:31b
ollama pull gemma4:latest
ollama pull qwen3.6:35b-a3b-q8_0
ollama pull nomic-embed-text
```

### 2. Host: Start Whisper.cpp server

```bash
./whisper-server -m models/ggml-large-v3.bin --port 8080
```

### 3. Create `.env`

```env
TELEGRAM_TOKEN=...
DEEPSEEK_API_KEY=...
TAVILY_API_KEY=...
SERPER_API_KEY=...
```

### 4. Docker

```bash
docker compose up --build -d
docker compose logs -f
```

### 5. Verify

```bash
npm run lint       # ESLint (JS files only)
npx tsc --noEmit   # TypeScript typecheck
npm test           # 32 tests
```

## Features

### Smart Router

- **Simple queries** → local Ollama (Gemma 4 / Qwen 3.6)
- **Code/refactoring/security** → cloud DeepSeek V4 Pro
- **Search keywords** → cloud DeepSeek V4 Flash
- **>100k tokens** → automatic cloud overflow
- **Local failure** → automatic fallback to cloud
- Manual override via `/model` command

### Long-Term Memory

- **Ring buffer**: last 30 minutes of messages per chat
- **LanceDB**: semantic search across entire conversation history
- **Reply context**: when user replies to a message, the original text is injected into context

### Reminders

- `set_reminder` via natural language: "напомни через 10 минут", "напомни в 19:00"
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

### Local (Ollama)

- `ollama/gemma4:31b` — general tasks
- `ollama/gemma4:latest` — lightweight
- `ollama/qwen3.6:35b-a3b-q8_0` — math/heavy logic
- `ollama/minicpm-v:8b-2.6-q4_K_M` — vision (images)

### Cloud

- `deepseek/deepseek-v4-pro` — complex tasks
- `deepseek/deepseek-v4-flash` — fast/cheap

## Project Skills

Skills in `.pi/skills/` and `~/.pi/agent/skills/`:

| Skill | Purpose |
|-------|---------|
| `verify-before-merge` | Run lint + tsc + test before declaring done |
| `commit-and-push` | Conventional commits + push workflow |
