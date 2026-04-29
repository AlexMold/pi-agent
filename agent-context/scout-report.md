# Scout Report — AI Assistant Pro

**Date:** 2026-04-29  
**Scope:** Full codebase analysis (1,332 lines across 14 source files)  
**Focus:** Architecture, error handling, security, observability, code quality

---

## 🔴 CRITICAL

### 1. Live API Keys Committed to Repository

**File:** `.env`  
**Severity:** CRITICAL — keys are already in git history.

Every API key is hardcoded in the committed `.env` file:

| Key | Value (first 24 chars) |
|-----|-----------------------|
| `TELEGRAM_TOKEN` | `[REDACTED]` |
| `DEEPSEEK_API_KEY` | `[REDACTED]` |
| `TAVILY_API_KEY` | `[REDACTED]` |
| `SERPER_API_KEY` | `[REDACTED]` |
| `GROQ_API_KEY` | `[REDACTED]` (unused but present) |

**Action:** Rotate all keys immediately. Add `.env` to `.gitignore` (it's already there — use `.env.example` instead).

---

## 🟠 HIGH

### 2. Telegram Token Leaks in Logs and URLs

**File:** `src/services/message-handler.ts` (line 45, 57)  
**Severity:** HIGH

```typescript
const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
```

The bot token appears in plaintext in `fetch()` URLs. If any logging infrastructure captures URLs (proxies, error traces, etc.), the token leaks. The `config.telegramToken` getter reveals it at module scope.

**Action:** Use `ctx.api.getFileLink()` instead, which returns a pre-signed URL that doesn't expose the token (grammY handles this internally).

### 3. Empty Catch Blocks Swallow Errors

**Files:** `src/handlers/messages.ts` (lines 56, 65, 79, 87), `src/memory.ts` (lines 106, 137)  
**Severity:** HIGH

```typescript
try { await memory.remember(query, { role: "user", chatId }); } catch (_) {}
try { await memory.recall(query, chatId, 4, 4); } catch (_) {}
try { await memory.remember(cleanResponse(raw), { role: "assistant", chatId }); } catch (_) {}
```

Four silent swallows in the core message path alone. If LanceDB or the embedding service fails, the user gets no indication, and the agent runs without context memory. Debugging silent failures is impossible.

**Action:** Log the error message in each catch block. For memory failures, consider degrading gracefully but audibly.

### 4. Pi-Agent Orphan Processes on Crash

**File:** `src/agent.ts`  
**Severity:** HIGH

When `executeAgentTask()` is called, it spawns `pi` as a child process. If:
- The Node process crashes (`uncaughtException`)
- A timeout kills the child
- A concurrent message arrives for the same chat

...there is no mechanism to track or kill orphaned Pi-Agent processes. Each spawn is fire-and-forget. Over time, resource exhaustion is guaranteed.

**Action:** Implement a process registry (Map of chatId → child process). Kill orphaned processes on new messages or shutdown. Add a max concurrent spawns limit.

### 5. Config Singleton Contains Mutable State

**File:** `src/services/config.ts` (line 36)  
**Severity:** HIGH

```typescript
readonly userModelOverride = new Map<number, string>();
```

This mutable map lives in a singleton shared across all imports. If two requests hit simultaneously (e.g., photo upload + text message), they race on the same map. This is a concurrency bug waiting to happen.

**Action:** Move per-chat state to an independent store (weak map, Redis, or database). At minimum, add a comment warning against concurrent access.

### 6. Duplicate Model Definitions Cause Drift

**Files:**
- `src/services/config.ts` — `localModels` + `cloudModels`
- `src/router.ts` — `MODELS` record (hardcoded again)
- `models.json` — third copy with different IDs (e.g., `deepseek-v4-distill-32b`)

**Severity:** HIGH

Three separate sources of truth for model definitions. `models.json` is unused but copied into Docker. `router.ts` duplicates `config.ts` with slightly different descriptions. Adding/removing a model requires editing three places — they will drift.

**Action:** Consolidate into `config.ts` as the single source. Reference it from the router. Remove `models.json` or derive it from config.

---

## 🟡 MEDIUM

### 7. No Graceful Shutdown for Active Agent Tasks

**File:** `src/bot.ts` (lines 88-93)  
**Severity:** MEDIUM

```typescript
const shutdown = () => {
  bot.stop();
  process.exit(0);
};
```

On SIGINT/SIGTERM, the process exits immediately. Any in-flight Pi-Agent child processes become orphans. LanceDB writes in progress get truncated. Ring buffer data is lost.

**Action:** Track active processes, send SIGTERM to children, wait for completion with a hard timeout, then exit.

### 8. Workspace Photos Accumulate Indefinitely

**File:** `src/services/message-handler.ts` (line 63)  
**Files:** `/app/workspace/photo_*.jpg` (two already present, 121 KB each)  
**Severity:** MEDIUM

Photos are saved with a timestamp-based filename and never cleaned up. In a high-traffic scenario, this fills the container disk. No eviction policy, no max-age, no size limit.

**Action:** Add a cleanup task (e.g., delete files older than 1 hour). Use a temp directory or set `TMPDIR`. Or inline the photo data without writing to disk.

### 9. 15-Minute Agent Timeout

**File:** `src/agent.ts` (line 81)  
**Severity:** MEDIUM

```typescript
const timeout = setTimeout(() => {
  child.kill();
  reject(new Error("Agent timeout (15 min)"));
}, 900_000);
```

A 15-minute timeout for a Telegram bot interaction is impractical. The user receives no feedback for the duration. This also ties up the handler — grammY's `bot.on` will not process concurrent messages for the same chat while this is running (unless using grammY's built-in concurrency).

**Action:** Reduce to 2-3 minutes. Implement streaming/progress updates. Use grammY's `bot.use()` with concurrency enabled, or move to a queue-based architecture.

### 10. Cloud API Keys Passed to Child Process Environment

**File:** `src/agent.ts` (lines 69-72)  
**Severity:** MEDIUM

```typescript
if (route.type === "cloud") {
  env.DEEPSEEK_API_KEY = route.apiKey;
  env.OPENAI_API_KEY = route.apiKey;
}
```

API keys are injected into the spawned process environment. A malicious Pi extension or a compromised dependency could read `process.env.DEEPSEEK_API_KEY`. Additionally, `/proc/[pid]/environ` leaks on Linux hosts.

**Action:** Pass API keys via a temporary file descriptor (pipe) or use Pi-Agent's native API key configuration if supported.

### 11. No Request Correlation IDs

**Severity:** MEDIUM

Every log line uses bare `console.log`/`console.error` with ad-hoc prefixes like `[Agent]`, `[Memory]`, `[STT]`, `[Security]`. No correlation ID ties together a single request's journey from extraction → routing → memory → agent → response. Debugging a failure requires stitching together timestamps manually.

**Action:** Generate a UUID per incoming message. Thread it through all subsystems. Use a structured logger (pino, winston) with the correlation ID.

### 12. `process.exit(1)` on Missing Config

**File:** `src/services/config.ts` (line 8)  
**Severity:** MEDIUM

```typescript
function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ ${key} not set in .env`);
    process.exit(1);
  }
  return value;
}
```

This runs at module import time. If `TELEGRAM_TOKEN` is missing, the process exits before any error handler is registered. No stack trace, no cleanup, no indication of what went wrong to external monitoring.

**Action:** Throw an error instead of exiting. Let the top-level error handler (or Docker restart policy) manage recovery. Validate all env vars in a startup check before starting the bot.

---

## 🔵 LOW / CODE QUALITY

### 13. `js-tiktoken` for Token Counting Is Fragile

**File:** `src/router.ts` (line 16)  
**Severity:** LOW

```typescript
const enc = getEncoding("cl100k_base");
```

`cl100k_base` is the encoding for GPT-4 / text-embedding-ada-002. This is used as a proxy for token counting across all models. Every model family (Gemma, Qwen, DeepSeek) uses different tokenizers. The 100K threshold is therefore an approximation at best.

**Action:** Accept the approximation but document it. Consider model-specific thresholds or use the model's own tokenizer for critical routing decisions.

### 14. LanceDB Initialization Dumps 768-Zero Vector

**File:** `src/memory.ts` (lines 49-57)  
**Severity:** LOW

```typescript
this.table = await this.db.createTable("history", [
  {
    vector: new Array(768).fill(0),
    text: "init",
    role: "system",
    chatId: 0,
    timestamp: Date.now(),
  },
]);
```

This dummy row becomes a real entry in the vector database. It will appear in semantic searches as a zero-vector match (noise). It should be removed immediately after table creation.

**Action:** Delete the init row after table creation, or use `createEmptyTable` if LanceDB supports schema-only creation.

### 15. `memory-tool.js` Duplicates LanceDB + Embedding Logic

**File:** `src/memory-tool.js` (lines 13-28)  
**Severity:** LOW

The memory extension re-initializes its own LanceDB connection and embedding function, duplicating logic from `src/memory.ts`. It also hardcodes `OLLAMA_BASE` from `process.env` directly instead of using the config service.

**Action:** Extract a shared embedding module. Both the TypeScript memory service and the JS Pi extension should import from the same source.

### 16. `search-extension.js` Uses Raw `https` Instead of `fetch`

**File:** `src/search-extension.js` (lines 7-27)  
**Severity:** LOW

The rest of the codebase uses the modern `fetch()` API (Node 24). The search extension wraps `https.request()` manually — more boilerplate, fewer features (no timeout, no AbortController support, no streaming).

**Action:** Switch to `fetch()`. Set a reasonable timeout per search request (currently infinite).

### 17. ffmpeg Stderr Silently Discarded

**File:** `src/stt.ts` (line 30)  
**Severity:** LOW

```typescript
ffmpeg.stderr.on("data", () => {}); // ffmpeg logs to stderr
```

While ffmpeg stderr is noisy, critical errors (missing codec, invalid input) also go to stderr. If conversion fails for reasons other than exit code, it's invisible.

**Action:** Log stderr at debug level, or buffer it and include in error messages when ffmpeg fails.

### 18. `nodemon` in Production Dependencies

**File:** `package.json`  
**Severity:** LOW

`nodemon` (^3.1.14) is listed under `dependencies` instead of `devDependencies`. It gets installed in the Docker image, adding unnecessary size and attack surface.

**Action:** Move to `devDependencies`.

### 19. ts-node in Production (Docker)

**File:** `docker/Dockerfile` (line 28)  
**Severity:** LOW

```dockerfile
CMD ["node", "--loader", "ts-node/esm", "src/bot.ts"]
```

Running `ts-node` in production is a known anti-pattern. It adds startup latency (~1-2 seconds for TypeScript compilation), uses more memory, and can hide TypeScript errors that would be caught by `tsc` at build time.

**Action:** Pre-compile with `tsc` and run the output `.js` files. Use `ts-node` only in development.

---

## 📊 Summary

| Category | Count | Key Items |
|----------|-------|-----------|
| 🔴 CRITICAL | 1 | Live API keys in committed `.env` |
| 🟠 HIGH | 5 | Token in URLs, empty catch blocks, orphan processes, mutable singleton, duplicate model defs |
| 🟡 MEDIUM | 6 | No graceful shutdown, workspace bloat, 15min timeout, env vars to children, no correlation IDs, `process.exit` |
| 🔵 LOW | 7 | Tokenizer mismatch, init vector, duplicate logic, raw https, silent stderr, nodemon, ts-node in prod |
| **Total** | **19** | |

### Quick Wins (can fix in <1 hour)

1. Rotate all API keys (TELEGRAM_TOKEN, DEEPSEEK, TAVILY, SERPER, GROQ)
2. Replace `bot${token}` URLs with `ctx.api.getFileLink()`
3. Add logging to all empty `catch (_) {}` blocks
4. Move `nodemon` to `devDependencies`
5. Remove `models.json` (unused)
6. Add workspace photo auto-cleanup on startup

### Architectural Recommendations

1. **Adopt a queue-based processing model** — Telegram bot handlers should enqueue tasks and return quickly. A worker pool processes agent tasks with proper concurrency control, timeouts, and progress updates.

2. **Add a health check endpoint** — Even though this is a bot (not an HTTP service), a simple `/health` route or a periodic self-test (ping Ollama, check LanceDB, send a test message to a monitoring chat) would catch failures proactively.

3. **Introduce structured logging** — Replace `console.log` with `pino` or similar. Add correlation IDs. This is cheap and pays for itself on the first production incident.

4. **Consolidate model config** — One source of truth. Remove `models.json` and the `MODELS` duplicate in `router.ts`. Derive everything from `config.ts`.

5. **Add tests** — Zero tests in the repo. The most critical paths (message extraction → routing → agent → response) have no coverage. Start with integration tests for the router and memory modules.
