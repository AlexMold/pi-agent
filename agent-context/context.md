# AI Assistant Pro — Project Context

## Overview
Telegram bot that answers user queries via LLM with smart routing (local Ollama vs cloud DeepSeek), vector memory (LanceDB), voice input (Whisper.cpp), and web search (Tavily + Serper.dev). Executes in Docker; Pi-Agent handles tool-calling.

## Architecture
```
Telegram → grammY Bot → Message Extraction → SmartRouter → Pi-Agent → Response
                           ↓                      ↓              ↓
                      Whisper STT          Local Ollama    Cloud DeepSeek
                      Photo Save           (5 models)      (2 models)
                           ↓
                      LongTermMemory (LanceDB + ring buffer)
                           ↓
                      Web Search (Tavily + Serper)
```

## Tech Stack
- **Runtime**: Node.js 24 (ESM), TypeScript 5.8, ts-node/esm loader
- **Bot**: grammY 1.42
- **LLM**: Ollama (local, 5 models), DeepSeek API (cloud, 2 models)
- **Agent**: Pi-Agent CLI (@mariozechner/pi-coding-agent 0.70.2)
- **Memory**: LanceDB 0.17 (vector DB) + in-memory ring buffer
- **STT**: Whisper.cpp server (localhost:8080) via multipart/form-data
- **Search**: Tavily API + Serper.dev (Google index)
- **Infra**: Docker Compose, macOS host with Metal/NPU acceleration

## File Structure (post-refactor)
```
src/
├── bot.ts                      # Entry: wires middleware, handlers (80 lines)
├── services/
│   ├── config.ts               # Singleton: env, model lists, constants
│   └── message-handler.ts      # Voice/photo/text extraction pipeline
├── helpers/
│   ├── markdown.ts             # MD→HTML, path noise cleaning, chunking
│   └── response.ts             # Chunked HTML sending with fallback
├── handlers/
│   ├── commands.ts             # /start, /model, /status + model keyboard
│   ├── callbacks.ts            # Inline model selection (callback_query)
│   └── messages.ts             # Core: extract → route → memory → agent → reply
├── agent.ts                    # Pi-Agent spawner (child_process)
├── router.ts                   # SmartRouter: LLM classifier → model selection
├── memory.ts                   # LongTermMemory: LanceDB + ring buffer singleton
├── stt.ts                      # Whisper.cpp client: OGG→WAV→STT
├── memory-tool.js              # Pi extension: recall_memory tool
└── search-extension.js         # Pi extension: tavily_search + internet_search
```

## Key Flows

### Message Processing (handlers/messages.ts)
1. `extractMessage()` → voice (Whisper), photo (save + caption), text (passthrough)
2. Route determination: image → vision model; else manual override or SmartRouter
3. Memory recall: recent messages (ring buffer, 4) + semantic search (LanceDB, 4)
4. Agent execution: `pi --model ... --extension search-extension.js ... --print prompt`
5. Response: clean paths, chunk to 4000 chars, MD→HTML, send via Telegram

### Smart Router (router.ts)
1. Token count > 100K → cloud (instant, no LLM call)
2. Lightweight LLM classifier (gemma4:latest 8B) → picks best model
3. Keyword fallback if LLM unavailable

### Model Pool
| Model | Type | Use Case |
|-------|------|----------|
| ollama/gemma4:latest (8B) | local | Simple chat, greetings |
| ollama/gemma4:31b | local | Workhorse: code, text, analysis |
| ollama/qwen3.6:35b-a3b-q8_0 | local | Complex code, math, architecture |
| ollama/minicpm-v:8b-2.6-q4_K_M | local | Images/screenshots |
| deepseek/deepseek-v4-pro | cloud | Refactoring, security audit, migrations |
| deepseek/deepseek-v4-flash | cloud | Web search, medium tasks, failover |

## Env Vars
```
TELEGRAM_TOKEN, ALLOWED_USER_ID, DEEPSEEK_API_KEY
TAVILY_API_KEY, SERPER_API_KEY
OLLAMA_HOST=host.docker.internal:11434
WHISPER_HOST=host.docker.internal:8080, WHISPER_LANG=ru
PI_SKIP_VERSION_CHECK=1, PI_OFFLINE=1, PI_TELEMETRY=0
```

## Notable Design Decisions
- Singleton pattern for Config and LongTermMemory (single instance across imports)
- Strategy pattern: manual model override vs SmartRouter
- Hybrid memory: ring buffer (fast, always available) + LanceDB (semantic, long-term)
- Cloud failover: when local model fails, auto-fallback to deepseek-v4-flash
- Image guard: vision model failures do NOT fall back to cloud (cloud can't handle images)
- Path cleaning: removes /var/folders and /tmp paths from agent output for privacy
- Pi-Agent loads custom extensions (search, memory) via --extension CLI flags

## Current State
- ✅ Refactored from monolithic bot.ts (230 lines) → 8 focused modules (max 133 lines)
- ✅ tsc --noEmit: 0 errors, all modules load at runtime
- ✅ SOLID: SRP per file, DIP via config/memory abstractions
- ✅ Two search backends: Tavily (AI-optimized) + Serper.dev (Google index)
- ✅ Dockerfile copies entire src/ directory (subdirs included)
- ✅ docker-compose passes TAVILY_API_KEY and SERPER_API_KEY to container
- ⚠️ .whisper/ directory is gitignored but exists locally (Whisper.cpp compiled)
- ⚠️ No tests yet, no CI/CD pipeline