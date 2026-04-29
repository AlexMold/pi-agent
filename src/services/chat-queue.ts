/**
 * services/chat-queue.ts — Per-chat message queue with LLM preemption.
 *
 * Problem: user sends message A, then quickly sends message B while LLM is
 * still generating the answer to A. We don't want to queue B — we want to:
 *   1. Cancel the in-flight LLM call for A
 *   2. Combine A+B (or just use B with the existing context) and restart
 *
 * Each chat gets its own Queue<ChatTask>. When a new task arrives:
 *  - If nothing is running → start immediately
 *  - If a task is running  → abort it + replace the pending slot with the
 *    newest task (older pending tasks are discarded / merged into the newest)
 */

export interface ChatTask {
  /** The merged query text that should be sent to the LLM */
  query: string;
  /** Resolved conversation-history prefix (already fetched from memory) */
  ctxPrefix: string;
  /** Optional image path */
  imagePath?: string;
  /** Signal that the executor should honour to cancel itself */
  signal: AbortSignal;
}

type TaskRunner = (task: ChatTask) => Promise<void>;

interface SlotState {
  /** AbortController for the task that is currently executing */
  runningController: AbortController | null;
  /** The task that is waiting to run once the current one finishes / is aborted */
  pending: { query: string; ctxPrefix: string; imagePath?: string } | null;
  /** Whether the executor loop is active */
  running: boolean;
}

/**
 * Per-chat message queue manager (singleton).
 *
 * Usage:
 *   chatQueue.enqueue(chatId, { query, ctxPrefix, imagePath }, runner);
 *
 * `runner` is called with a ChatTask that includes an AbortSignal. The runner
 * MUST check `task.signal.aborted` at checkpoints (e.g. after the LLM call)
 * and MUST pass the signal to any cancellable sub-operation.
 */
class ChatQueue {
  private readonly slots = new Map<number, SlotState>();

  private getSlot(chatId: number): SlotState {
    if (!this.slots.has(chatId)) {
      this.slots.set(chatId, {
        runningController: null,
        pending: null,
        running: false,
      });
    }
    return this.slots.get(chatId)!;
  }

  /**
   * Enqueue a new incoming message for the given chat.
   *
   * @param chatId   Telegram chat ID
   * @param payload  Raw task data (query + ctxPrefix + optional imagePath)
   * @param runner   Async function that does the actual LLM work
   * @param onSkip   Called when a previous task is aborted (for UX notification)
   */
  enqueue(
    chatId: number,
    payload: { query: string; ctxPrefix: string; imagePath?: string },
    runner: TaskRunner,
    onSkip?: () => void,
  ): void {
    const slot = this.getSlot(chatId);

    if (slot.running) {
      // There is an active task → abort it and remember the new payload
      if (slot.runningController) {
        onSkip?.();
        slot.runningController.abort();
      }
      // Replace (not append) the pending slot — older pending tasks are dropped
      slot.pending = payload;
      return;
    }

    // Nothing running → start immediately
    this.run(chatId, payload, runner, onSkip);
  }

  private run(
    chatId: number,
    payload: { query: string; ctxPrefix: string; imagePath?: string },
    runner: TaskRunner,
    onSkip?: () => void,
  ): void {
    const slot = this.getSlot(chatId);
    const controller = new AbortController();
    slot.runningController = controller;
    slot.running = true;

    const task: ChatTask = { ...payload, signal: controller.signal };

    runner(task)
      .catch((err) => {
        // AbortError is expected when we preempt — suppress it
        if (err?.name !== "AbortError") {
          console.error(`[ChatQueue] runner error for chat ${chatId}:`, err);
        }
      })
      .finally(() => {
        slot.running = false;
        slot.runningController = null;

        if (slot.pending) {
          const next = slot.pending;
          slot.pending = null;
          // Small tick so this isn't fully synchronous
          setImmediate(() => this.run(chatId, next, runner, onSkip));
        }
      });
  }
}

export const chatQueue = new ChatQueue();
