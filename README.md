# AI Assistant Pro

## Architecture

```
User (Telegram) → grammY Bot → SmartRouter → Pi-Agent → Response
                                    │              │
                              ┌─────┴────┐   ┌────┴────┐
                              │ Local    │   │ Cloud   │
                              │ Ollama   │   │DeepSeek │
                              └──────────┘   └─────────┘
                                    │
                              LongTermMemory
                              (LanceDB + Ollama embeddings)
```

## Components

| File | Purpose |
|------|---------|
| `src/bot.ts` | Telegram bot (grammY) — main orchestrator |
| `src/router.ts` | FinOps router: chooses between local/cloud |
| `src/memory.ts` | Vector memory using LanceDB |
| `src/agent.ts` | Pi-Agent runner in a sandbox |
| `src/stt.ts` | Whisper.cpp client for voice messages |

## Quick Start

### 1. Host: Start Ollama
```bash
ollama serve
ollama pull deepseek-v4-distill-32b
ollama pull gemma4:31b
ollama pull nomic-embed-text
```

### 2. Host: Start Whisper.cpp server
```bash
./whisper-server -m models/ggml-large-v3.bin --port 8080
```

### 3. Create .env with keys
```env
TELEGRAM_TOKEN=...
DEEPSEEK_API_KEY=...
TAVILY_API_KEY=...
```

### 4. Docker
```bash
docker compose up --build -d
docker compose logs -f
```

### 5. Test
Send to Telegram:
> Pi, find the latest trends in Node.js 2026 and write an example of using a new feature in the file trend.js

## FinOps Logic

- **≤100k tokens + simple request** → local DeepSeek Distill 32B (CAPEX = $0)
- **>100k tokens OR keywords** → cloud DeepSeek V4 Pro (OPEX)
- **Local failure** → automatic fallback to cloud