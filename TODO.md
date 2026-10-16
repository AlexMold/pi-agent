# TODO

## Goal

Апгрейд бота на @earendil-works/pi-coding-agent 1.3.0 (нативный автокомпакт, deprecated-линия закрывается), затем постоянная pi-сессия на Telegram-чат: агент реально ведёт дискуссию, переживает рестарты бота, длинные диалоги компактятся встроенным механизмом pi. Дистилляция персональных фактов - отдельный второй этап.

## Tasks

### 1. Апгрейд pi 0.70.2 → 1.3.0

- [x] `package.json`: `"@mariozechner/pi-coding-agent": "^0.70.2"` → `"@earendil-works/pi-coding-agent": "^1.3.0"`; `npm install` (обновить lockfile)
- [x] Проверить в 1.3.0 флаги: `--print`, `--model`, `--thinking medium`, `--no-skills`, `--no-themes`, `--no-tools`, env `PI_SKIP_VERSION_CHECK`/`PI_OFFLINE`/`PI_TELEMETRY` - все есть; добавлен `--no-mcp` (в контейнере mcp.json с chrome-devtools не нужен)
- [x] `models.json`: формат 1.3.0 - providers; но встроенный каталог уже резолвит deepseek-v4-flash/pro и google/gemini-2.5-flash (env-ключи) - оба старых файла удалены (root + .pi/agent) и строка из Dockerfile
- [x] Порт 5 тулов: НЕ ПОНАДОБИЛСЯ - ToolDefinition API 0.70.2 и 1.3.0 идентичны (проверено по dist; internet_search отработал end-to-end на 1.3.0)
- [x] `src/tools/reminder/index.js`: импорт `../../services/reminder.js` (.ts из .js - латентный баг) заменён на `reminder-store.js`; `reminder.ts` переведён на store; extractChatId починен под system-entry со string content + fallback `PI_SESSION_ID` (правка параллельного агента из соседней вкладки - забрал в свой диф)
- [x] Загрузка тулов: `--extension` флаг В 1.3.0 ЕСТЬ - механизм не меняется, settings не нужен
- [x] Интеграционная проверка: полный цикл на 1.3.0 - 5 тулов грузятся, auth.json `[]` терпится, trust не блокирует print, set_reminder реально пишет файл (extracted chatId: 123, reminders.json создан)

### 2. Постоянная pi-сессия на чат

- [x] `src/agent.ts`: опциональный параметр `sessionId` в `executeAgentTaskWithUsage`/`executeAgentTask` (без него - как сейчас)
- [x] В args: `--session-id chat_<id>` + `--session-dir ${sessionsDir}`, где `sessionsDir = join(WORKSPACE_DIR || process.cwd(), "sessions")`; `mkdirSync(recursive)` перед спавном; env `PI_SESSION_ID=chat_<id>`
- [x] `src/handlers/messages.ts`: пробросить `chatId` в оба вызова (основной ~131, фолбэк ~247); других вызывателей нет (grep)
- [x] Лог `[Agent] session=chat_<id>`

### 3. Дедупликация инжектируемого контекста

- [x] `src/handlers/messages.ts`: `memory.recall(query, chatId, 0, 4)` - недавние ходы несёт сессия, остаётся semantic top-4 + `<replied_to>`
- [x] Комментарий в `src/memory.ts`: кольцо остаётся как fallback и хранилище, в промпт больше не подкачивается

### 4. Настройка автокомпакта

- [x] `.pi/agent/models.json` (монтируется в `/root/.pi/agent/models.json`): override deepseek-v4-flash/pro с `contextWindow 131072` (встроенный каталог даёт 1M - компакт не срабатывал бы) → авто-компакт вступает на ~115K токенов
- [x] Ручная проверка: форсированная сессия с окном 24K - 2 CompactionEntry с корректным саммари, секрет из первого хода пережил компакт и 35K токенов filler'а; продолжение сессии проверено («Рекс» помнится между запусками)

### 5. Тесты

- [x] Новый `src/tests/agent-session.test.ts` (mock spawn): `--session-id chat_42` есть при sessionId, нет - при отсутствии; `--session-dir` корректен; `PI_SESSION_ID` в env
- [x] bot-e2e: 5-й аргумент мока `executeAgentTask*` = String(chatId)
- [x] Существующие тесты не сломаны: 57 passed / 3 skipped

### 6. Verify + commit

- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` - зелёные
- [ ] Коммит (conventional) + пуш

## Notes

- Сессии: `workspace/sessions/` (смонтированный volume, переживает рестарт контейнера); `workspace/` в .gitignore
- Аборт «⏩ новое сообщение» (SIGKILL): pi переживает оборванный хвост сессии - проверено тестом с коррапт-файлом (0.70.2) и нужно повторить на 1.3.0 в рамках задачи 4
- Старая линия pi deprecated; после апгрейда кастомный compactor не нужен (нативный компакт)
- `usage-tracker` пишет неверные токены (avg input = 8) - отдельный баг, не входит
- Дистилляция (этап 2): ночной прогон по сессиям → таблица `facts` + дообучение базы знаний
- `--extension` флага в 1.3.0 нет (проверено в `pi --help`) - поэтому задача 1 обязательна перед задачей 2
