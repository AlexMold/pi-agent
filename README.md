# AI Assistant Pro

## Архитектура

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

## Компоненты

| Файл | Назначение |
|------|------------|
| `src/bot.ts` | Telegram бот (grammY) — основной оркестратор |
| `src/router.ts` | FinOps-роутер: выбирает локально/облако |
| `src/memory.ts` | Векторная память на LanceDB |
| `src/agent.ts` | Запуск Pi-Agent в песочнице |
| `src/stt.ts` | Whisper.cpp клиент для голосовых |

## Быстрый старт

### 1. Хост: запустить Ollama
```bash
ollama serve
ollama pull deepseek-v4-distill-32b
ollama pull gemma4:31b
ollama pull nomic-embed-text
```

### 2. Хост: запустить Whisper.cpp сервер
```bash
./whisper-server -m models/ggml-large-v3.bin --port 8080
```

### 3. Создать .env с ключами
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

### 5. Тест
Отправь в Telegram:
> Пи, найди последние тренды в Node.js 2026 и напиши пример использования новой фичи в файле trend.js

## FinOps логика

- **≤100k токенов + простой запрос** → локальный DeepSeek Distill 32B (CAPEX = $0)
- **>100k токенов ИЛИ keywords** → облачный DeepSeek V4 Pro (OPEX)
- **Локальный сбой** → автоматический fallback на облако