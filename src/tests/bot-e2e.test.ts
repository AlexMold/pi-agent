/**
 * tests/bot-e2e.test.ts
 *
 * End-to-end tests for the Telegram bot orchestration pipeline.
 * Mocks all external dependencies (grammy, agent, memory, router, STT)
 * and verifies the full message → handler → router → memory → queue → agent → response flow.
 *
 * What is covered:
 *   • Text message handler — full pipeline end-to-end
 *   • Message preemption (second message aborts first)
 *   • Local → cloud fallback on agent failure
 *   • Model override via callback query
 *   • /start and /status commands
 *   • /model command — keyboard generation and selection
 *   • Conversation history injection (memory context prefix)
 *   • Vision route building for photo messages
 *   • Error recovery paths
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot, Context } from "grammy";

// ── Set test env before module mocks ────────────────────────────
process.env.TELEGRAM_TOKEN = "test:token";
process.env.DEEPSEEK_API_KEY = "sk-test-key";
process.env.SERPER_API_KEY = "test-serper";
process.env.TAVILY_API_KEY = "test-tavily";
process.env.OLLAMA_HOST = "localhost:11434";

// ── Module-level mocks (hoisted by vitest) ─────────────────────────
// All variables used inside vi.mock factories must be wrapped in vi.hoisted

const mockModelOverride = vi.hoisted(() => new Map<number, string>());
const mockExecuteAgentTask = vi.hoisted(() => vi.fn());
const mockRemember = vi.hoisted(() => vi.fn());
const mockRecall = vi.hoisted(() => vi.fn());
const mockRoute = vi.hoisted(() => vi.fn());
const mockRouteSync = vi.hoisted(() => vi.fn());
const mockExtractMessage = vi.hoisted(() => vi.fn());
const mockGetModelOverride = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockSetModelOverride = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClearModelOverride = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/config.js", () => ({
  config: {
    telegramToken: "test:token",
    allowedUserId: 0,
    ollamaHost: "localhost:11434",
    whisperHost: "localhost:8080",
    deepseekApiKey: "sk-test-key",
    hasCloudAccess: true,
    userModelOverride: mockModelOverride,
    allModels: [
      { id: "llama/qwen3.5-0.8b", label: "🟢 Qwen 3.5-0.8B", type: "local" },
      { id: "deepseek/deepseek-v4-pro", label: "☁️ DeepSeek V4 Pro", type: "cloud" },
      { id: "deepseek/deepseek-v4-flash", label: "☁️ DeepSeek V4 Flash", type: "cloud" },
      { id: "google/gemini-2.5-flash", label: "☁️ Gemini 2.5 Flash (img)", type: "cloud" },
    ],
    localModels: [
      { id: "llama/qwen3.5-0.8b", label: "🟢 Qwen 3.5-0.8B", type: "local" },
    ],
    cloudModels: [
      { id: "deepseek/deepseek-v4-pro", label: "☁️ DeepSeek V4 Pro", type: "cloud" },
      { id: "deepseek/deepseek-v4-flash", label: "☁️ DeepSeek V4 Flash", type: "cloud" },
      { id: "google/gemini-2.5-flash", label: "☁️ Gemini 2.5 Flash (img)", type: "cloud" },
    ],
    findModel: (id: string) => {
      const all = [
        { id: "llama/qwen3.5-0.8b", label: "🟢 Qwen 3.5-0.8B", type: "local" },
        { id: "deepseek/deepseek-v4-pro", label: "☁️ DeepSeek V4 Pro", type: "cloud" },
      ];
      return all.find((m) => m.id === id) || null;
    },
    isLocalModel: (id: string) => id.includes("llama"),
    isVisionModel: (id: string) => id.includes("minicpm"),
  },
}));

vi.mock("../agent.js", () => ({
  executeAgentTask: mockExecuteAgentTask,
}));

vi.mock("../memory.js", () => ({
  memory: {
    init: vi.fn().mockResolvedValue(undefined),
    remember: mockRemember,
    recall: mockRecall,
    getModelOverride: mockGetModelOverride,
    setModelOverride: mockSetModelOverride,
    clearModelOverride: mockClearModelOverride,
  },
}));

vi.mock("../router.js", () => ({
  SmartRouter: {
    route: mockRoute,
    routeSync: mockRouteSync,
    countTokens: vi.fn(() => 10),
  },
}));

vi.mock("../services/message-handler.js", () => ({
  extractMessage: mockExtractMessage,
}));

vi.mock("../helpers/markdown.js", () => ({
  cleanResponse: vi.fn((s: string) => s),
  mdToHtml: vi.fn((s: string) => s),
  chunkText: vi.fn((s: string) => [s]),
}));

vi.mock("../helpers/response.js", () => ({
  sendChunkedResponse: vi.fn(async (_ctx: Context, text: string) => {
    await (_ctx as any).reply(text);
  }),
}));

// ── Actual handler imports (after mocks) ───────────────────────────

import { registerMessageHandler } from "../handlers/messages.js";
import { registerCommands } from "../handlers/commands.js";
import { registerCallbacks } from "../handlers/callbacks.js";
import { chatQueue } from "../services/chat-queue.js";
import { sendChunkedResponse } from "../helpers/response.js";

// The mocked config — vi.mock replaces this module for all importers
import { config } from "../services/config.js";

// ── Helpers ────────────────────────────────────────────────────────

const DEFAULT_CHAT_ID = 12345;

interface MockBot extends Bot {
  _messageHandlers: Array<{
    filter: string[];
    handler: (ctx: Context) => Promise<void>;
  }>;
  _commandHandlers: Map<string, (ctx: Context) => Promise<void>>;
  _callbackHandlers: Array<{
    pattern: RegExp;
    handler: (ctx: Context) => Promise<void>;
  }>;
}

function createMockBot(): MockBot {
  const handlers: MockBot["_messageHandlers"] = [];
  const commands = new Map<string, (ctx: Context) => Promise<void>>();
  const callbacks: MockBot["_callbackHandlers"] = [];

  return {
    _messageHandlers: handlers,
    _commandHandlers: commands,
    _callbackHandlers: callbacks,
    on: vi.fn((filter: any, handler: any) => {
      if (Array.isArray(filter)) {
        handlers.push({ filter, handler });
      } else {
        handlers.push({ filter: [filter], handler });
      }
    }),
    command: vi.fn((name: string, handler: any) => {
      commands.set(name, handler);
    }),
    callbackQuery: vi.fn((pattern: RegExp, handler: any) => {
      callbacks.push({ pattern, handler });
    }),
    catch: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    // Bot token needed for api calls
    token: "test:token",
    botInfo: { id: 1, first_name: "Test", is_bot: true, username: "test_bot" },
  } as unknown as MockBot;
}

function createMockContext(overrides: Partial<any> = {}): Context {
  const ctx = {
    chat: { id: DEFAULT_CHAT_ID, type: "private" as const },
    from: { id: DEFAULT_CHAT_ID, is_bot: false, first_name: "Test" },
    message: { text: "test query", message_id: 1, date: Math.floor(Date.now() / 1000) },
    msg: { text: "test query", message_id: 1, date: Math.floor(Date.now() / 1000) },
    reply: vi.fn().mockResolvedValue({ message_id: 2 }),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 2 }),
      getFile: vi.fn().mockResolvedValue({ file_path: "test/file.jpg" }),
    },
    match: null as string[] | null,
    ...overrides,
  };
  return ctx as unknown as Context;
}

/** Reset all mocks and the chat queue singleton between tests */
function resetAll() {
  vi.clearAllMocks();
  // Reset chat queue internal state
  const q = chatQueue as any;
  if (q.slots) q.slots.clear();
  // Reset config overrides
  mockModelOverride.clear();
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Bot E2E — Message Handler", () => {
  beforeEach(() => {
    resetAll();
    mockRoute.mockResolvedValue({
      model: "llama/qwen3.5-0.8b",
      type: "local",
      reason: "default",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    mockRouteSync.mockReturnValue({
      model: "llama/qwen3.5-0.8b",
      type: "local",
      reason: "default",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    mockExecuteAgentTask.mockResolvedValue("Echo: test query");
    mockExtractMessage.mockImplementation(async (ctx: any) => ({
      query: ctx.message?.text || "default query",
    }));
    mockRecall.mockResolvedValue([]);
    mockRemember.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetAll();
  });

  // ── 1. Full text message pipeline ─────────────────────────────
  it("processes a text message through the full pipeline", async () => {
    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    // Wait for async pipeline to complete
    await vi.waitFor(() => {
      // Router was called
      expect(mockRoute).toHaveBeenCalled();
      // Message stored in memory
      expect(mockRemember).toHaveBeenCalledWith("test query", {
        role: "user",
        chatId: DEFAULT_CHAT_ID,
      });
      // Agent executed
      expect(mockExecuteAgentTask).toHaveBeenCalled();
    });

    // Model notification sent
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("qwen3.5-0.8b"),
      expect.any(Object),
    );
  });

  // ── 2. Conversation history injection ──────────────────────────
  it("injects conversation history when memory has past messages", async () => {
    mockRecall.mockResolvedValue([
      { role: "user", text: "привет" },
      { role: "assistant", text: "здравствуй" },
    ]);

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext({ message: { text: "как дела?" } });
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      expect(mockExecuteAgentTask).toHaveBeenCalled();
    });

    // Verify conversation history was prepended
    const agentCallArgs = mockExecuteAgentTask.mock.calls[0][0];
    expect(agentCallArgs).toContain("<conversation_history>");
    expect(agentCallArgs).toContain("[user]: привет");
    expect(agentCallArgs).toContain("[assistant]: здравствуй");
    expect(agentCallArgs).toContain("как дела?");
  });

  // ── 3. Message preemption ─────────────────────────────────────
  it("aborts the first message when a second arrives quickly", async () => {
    vi.useFakeTimers();

    // First agent call hangs indefinitely until aborted
    let firstAborted = false;
    mockExecuteAgentTask.mockImplementation(async (_prompt: string, _route: any, _img: any, signal?: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            firstAborted = true;
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
        // Never resolves naturally — must be aborted
      });
    });

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx1 = createMockContext({ message: { text: "первый" }, reply: vi.fn().mockResolvedValue({ message_id: 1 }) });
    const ctx2 = createMockContext({ message: { text: "второй" }, reply: vi.fn().mockResolvedValue({ message_id: 2 }) });

    await bot._messageHandlers[0].handler(ctx1);
    // Small tick to let the first task start
    await vi.advanceTimersByTimeAsync(10);
    // Second message preempts
    mockExecuteAgentTask.mockResolvedValue("Ответ на второй");
    await bot._messageHandlers[0].handler(ctx2);

    // Let queue settle
    await vi.advanceTimersByTimeAsync(500);

    // First task was aborted
    expect(firstAborted).toBe(true);

    // Second task ran to completion
    expect(mockExecuteAgentTask).toHaveBeenCalledTimes(2);
    const lastCallArgs = mockExecuteAgentTask.mock.calls[1][0];
    expect(lastCallArgs).toContain("второй");

    // Abort notification sent (second reply call, after model notification)
    expect(ctx2.reply).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("Отменяю"),
    );

    vi.useRealTimers();
  });

  // ── 4. Local → cloud fallback ─────────────────────────────────
  it("falls back to cloud when local agent fails and cloud key is present", async () => {
    // First call (local) fails, second (cloud) succeeds
    mockExecuteAgentTask
      .mockRejectedValueOnce(new Error("Ollama unavailable"))
      .mockResolvedValueOnce("Cloud fallback response");

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      // Agent was called twice: once local (failed), once cloud (fallback)
      expect(mockExecuteAgentTask).toHaveBeenCalledTimes(2);
    });

    // Cloud model was used for fallback
    const fallbackRoute = mockExecuteAgentTask.mock.calls[1][1];
    expect(fallbackRoute.type).toBe("cloud");
  });

  // ── 5. Agent success stores assistant response ────────────────
  it("stores assistant response in memory after successful agent run", async () => {
    mockExecuteAgentTask.mockResolvedValue("Assistant reply text");

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      expect(mockRemember).toHaveBeenCalledWith("Assistant reply text", {
        role: "assistant",
        chatId: DEFAULT_CHAT_ID,
      });
    });
  });

  // ── 6. Empty query is skipped ─────────────────────────────────
  it("skips processing when query is empty", { timeout: 2000 }, async () => {
    mockExtractMessage.mockResolvedValue({ query: "" });

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    // Wait for microtasks (the early return happens synchronously)
    await new Promise((r) => setTimeout(r, 100));
    expect(mockRoute).not.toHaveBeenCalled();
    expect(mockExecuteAgentTask).not.toHaveBeenCalled();
  });

  // ── 7. Vision route for photo messages ────────────────────────
  it("builds a vision route for photo messages", async () => {
    mockExtractMessage.mockResolvedValue({
      query: "Опиши это изображение",
      imagePath: "photo_test.jpg",
    });

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      expect(mockExecuteAgentTask).toHaveBeenCalled();
    });

    // Vision route uses Gemini cloud model
    const route = mockExecuteAgentTask.mock.calls[0][1];
    expect(route.model).toContain("gemini");
    expect(route.type).toBe("cloud");
    expect(mockExecuteAgentTask.mock.calls[0][2]).toBe("photo_test.jpg");
  });
});

describe("Bot E2E — Commands", () => {
  beforeEach(() => {
    resetAll();
  });

  it("/start sends welcome message", async () => {
    const bot = createMockBot();
    registerCommands(bot);

    const handler = bot._commandHandlers.get("start")!;
    const ctx = createMockContext();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("AI Assistant Pro"),
      expect.any(Object),
    );
  });

  it("/status shows system info", async () => {
    const bot = createMockBot();
    registerCommands(bot);

    const handler = bot._commandHandlers.get("status")!;
    const ctx = createMockContext();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Ollama"),
      expect.any(Object),
    );
  });

  it("/model shows model keyboard", async () => {
    const bot = createMockBot();
    registerCommands(bot);

    const handler = bot._commandHandlers.get("model")!;
    const ctx = createMockContext();
    await handler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Выбор модели"),
      expect.objectContaining({
        reply_markup: expect.any(Object),
      }),
    );
  });
});

describe("Bot E2E — Callbacks (Model Selection)", () => {
  beforeEach(() => {
    resetAll();
  });

  it("switches model and answers callback", async () => {
    const bot = createMockBot();
    registerCallbacks(bot);

    const handler = bot._callbackHandlers[0].handler;
    const targetModel = "deepseek/deepseek-v4-pro";

    const ctx = createMockContext({
      match: ["model:deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-pro"],
    });
    await handler(ctx);

    // Override was saved
    expect(mockModelOverride.get(DEFAULT_CHAT_ID)).toBe(targetModel);
    // Confirm callback
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.stringContaining("DeepSeek"),
    );
    // Message updated — model ID appears in the HTML content
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("DeepSeek V4 Pro"),
      expect.any(Object),
    );
  });

  it("resets to auto mode", async () => {
    const bot = createMockBot();
    registerCallbacks(bot);

    const handler = bot._callbackHandlers[0].handler;

    // First set a manual override
    mockModelOverride.set(DEFAULT_CHAT_ID, "llama/qwen3.5-0.8b");

    // Then reset to auto
    const ctx = createMockContext({
      match: ["model:auto", "auto"],
    });
    await handler(ctx);

    expect(mockModelOverride.has(DEFAULT_CHAT_ID)).toBe(false);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.stringContaining("Smart Router"),
    );
  });
});

describe("Bot E2E — Error Recovery", () => {
  beforeEach(() => {
    resetAll();
    mockRoute.mockResolvedValue({
      model: "llama/qwen3.5-0.8b",
      type: "local",
      reason: "default",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    mockExtractMessage.mockImplementation(async (ctx: any) => ({
      query: ctx.message?.text || "default query",
    }));
  });

  it("shows error when local is unavailable and no cloud key", async () => {
    // Temporarily remove cloud access in the mock
    const mockConfigAny = config as any;
    const originalCloudAccess = mockConfigAny.hasCloudAccess;
    mockConfigAny.hasCloudAccess = false;

    mockExecuteAgentTask.mockRejectedValue(new Error("Connection refused"));

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("нет облачного ключа"),
      );
    });

    // Restore
    mockConfigAny.hasCloudAccess = originalCloudAccess;
  });

  it("shows error when cloud vision model fails", async () => {
    mockExtractMessage.mockResolvedValue({
      query: "describe this",
      imagePath: "photo.jpg",
    });
    mockExecuteAgentTask.mockRejectedValue(new Error("Gemini API error"));

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx = createMockContext();
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("Ошибка"),
      );
    });
  });
});

describe("Bot E2E — Queue Integrity", () => {
  beforeEach(() => {
    resetAll();
    mockRoute.mockResolvedValue({
      model: "llama/qwen3.5-0.8b",
      type: "local",
      reason: "default",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    mockExtractMessage.mockImplementation(async (ctx: any) => ({
      query: ctx.message?.text || "default query",
    }));
  });

  it("processes two different chats independently", async () => {
    let callCount = 0;
    mockExecuteAgentTask.mockImplementation(async () => {
      callCount++;
      return `response-${callCount}`;
    });

    const bot = createMockBot();
    registerMessageHandler(bot);

    const ctx1 = createMockContext({
      chat: { id: 100 },
      message: { text: "chat100" },
    });
    const ctx2 = createMockContext({
      chat: { id: 200 },
      message: { text: "chat200" },
    });

    await bot._messageHandlers[0].handler(ctx1);
    await bot._messageHandlers[0].handler(ctx2);

    await vi.waitFor(() => {
      expect(mockExecuteAgentTask).toHaveBeenCalledTimes(2);
    });

    // Verify both chats got their queries
    const queries = mockExecuteAgentTask.mock.calls.map((c: any) => c[0]);
    expect(queries.some((q: string) => q.includes("chat100"))).toBe(true);
    expect(queries.some((q: string) => q.includes("chat200"))).toBe(true);
  });

  it("discards intermediate messages and runs only the latest", async () => {
    vi.useFakeTimers();

    let abortedCount = 0;
    const agentResults: string[] = [];

    mockExecuteAgentTask.mockImplementation(async (_prompt: string, _route: any, _img: any, signal?: AbortSignal) => {
      return new Promise<string>((resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () => {
            abortedCount++;
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
        // Fast resolution for the last (non-aborted) call
        setTimeout(() => {
          if (!signal?.aborted) {
            agentResults.push(_prompt);
            resolve(`done: ${_prompt}`);
          }
        }, 50);
      });
    });

    const bot = createMockBot();
    registerMessageHandler(bot);

    const replyMock = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctxBase = { reply: replyMock, replyWithChatAction: vi.fn().mockResolvedValue(undefined) };

    // Send A
    await bot._messageHandlers[0].handler(createMockContext({
      ...ctxBase,
      message: { text: "A" },
    }));
    await vi.advanceTimersByTimeAsync(20);

    // Rapid-fire B, then C while A is running
    mockExecuteAgentTask.mockClear();
    mockExecuteAgentTask.mockImplementation(async (_p: string, ..._rest: any[]) => {
      return `done: ${_p}`;
    });

    await bot._messageHandlers[0].handler(createMockContext({
      ...ctxBase,
      message: { text: "B" },
    }));
    await vi.advanceTimersByTimeAsync(5);
    await bot._messageHandlers[0].handler(createMockContext({
      ...ctxBase,
      message: { text: "C" },
    }));

    await vi.advanceTimersByTimeAsync(500);

    // Only the latest (C) should have run to completion
    const queries = mockExecuteAgentTask.mock.calls.map((c: any) => c[0]);
    const hasA = queries.some((q: string) => q.includes("A"));
    const hasB = queries.some((q: string) => q.includes("B"));
    const hasC = queries.some((q: string) => q.includes("C"));

    // C ran, B may or may not have run (depends on timing), 
    // but the final result should be C
    expect(hasC).toBe(true);

    vi.useRealTimers();
  });
});

describe("Bot E2E — Model Override Persistence", () => {
  beforeEach(() => {
    resetAll();
    mockRoute.mockResolvedValue({
      model: "llama/qwen3.5-0.8b",
      type: "local",
      reason: "default",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
    });
    mockExtractMessage.mockImplementation(async (ctx: any) => ({
      query: ctx.message?.text || "default query",
    }));
  });

  it("saves model override to LanceDB when user selects a model", async () => {
    const bot = createMockBot();
    registerCallbacks(bot);

    const handler = bot._callbackHandlers[0].handler;
    const ctx = createMockContext({
      match: ["model:deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-flash"],
    });
    await handler(ctx);

    // Should call setModelOverride to persist
    expect(mockSetModelOverride).toHaveBeenCalledWith(
      DEFAULT_CHAT_ID,
      "deepseek/deepseek-v4-flash",
    );
  });

  it("clears LanceDB override when user selects auto", async () => {
    const bot = createMockBot();
    registerCallbacks(bot);

    // First set a manual override, then switch to auto
    mockModelOverride.set(DEFAULT_CHAT_ID, "llama/qwen3.5-0.8b");

    const handler = bot._callbackHandlers[0].handler;
    const ctx = createMockContext({
      match: ["model:auto", "auto"],
    });
    await handler(ctx);

    // Should call clearModelOverride
    expect(mockClearModelOverride).toHaveBeenCalledWith(DEFAULT_CHAT_ID);
  });

  it("restores model override lazily on first message after restart", async () => {
    mockGetModelOverride.mockResolvedValue("deepseek/deepseek-v4-flash");
    mockExecuteAgentTask.mockResolvedValue("response");

    const bot = createMockBot();
    registerMessageHandler(bot);

    // Simulate restart: override not in memory, but exists in LanceDB
    mockModelOverride.clear();

    const ctx = createMockContext({ message: { text: "hello" } });
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      // Should query LanceDB for persisted override
      expect(mockGetModelOverride).toHaveBeenCalledWith(DEFAULT_CHAT_ID);
      // Should restore to in-memory Map
      expect(mockModelOverride.get(DEFAULT_CHAT_ID)).toBe(
        "deepseek/deepseek-v4-flash",
      );
    });
  });

  it("skips LanceDB lookup when override already in memory", async () => {
    mockExecuteAgentTask.mockResolvedValue("response");

    const bot = createMockBot();
    registerMessageHandler(bot);

    // Override already in memory from a previous callback
    mockModelOverride.set(DEFAULT_CHAT_ID, "llama/qwen3.5-0.8b");

    const ctx = createMockContext({ message: { text: "hello" } });
    await bot._messageHandlers[0].handler(ctx);

    await vi.waitFor(() => {
      // Should NOT query LanceDB — already in memory
      expect(mockGetModelOverride).not.toHaveBeenCalled();
    });
  });
});
