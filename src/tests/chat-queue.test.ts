/**
 * tests/chat-queue.test.ts
 *
 * Tests for the per-chat preemptive message queue.
 * No I/O — pure in-process logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { chatQueue } from "../services/chat-queue.js";
import type { ChatTask } from "../services/chat-queue.js";

// ── Helpers ────────────────────────────────────────────────────────

/** Creates a runner that resolves after `ms` ms (simulates LLM latency). */
function slowRunner(ms: number, calls: string[]) {
  return async (task: ChatTask) => {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      task.signal.addEventListener("abort", () => {
        clearTimeout(t);
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
    if (!task.signal.aborted) {
      calls.push(task.query);
    }
  };
}

/** Returns a fresh ChatQueue instance for each test so state doesn't leak. */
function freshQueue() {
  // Re-import via a factory trick — easier: just cast internals
  // Since chatQueue is a singleton we reset it between tests via a helper.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = chatQueue as any;
  q.slots.clear();
  return chatQueue;
}

// ── Tests ──────────────────────────────────────────────────────────

describe("ChatQueue", () => {
  beforeEach(() => {
    freshQueue();
  });

  it("runs a task immediately when nothing is in-flight", async () => {
    const completed: string[] = [];
    const runner = async (task: ChatTask) => {
      completed.push(task.query);
    };

    chatQueue.enqueue(1, { query: "hello", ctxPrefix: "" }, runner);
    // Give a tick for the microtask/setImmediate to fire
    await new Promise((r) => setTimeout(r, 10));

    expect(completed).toEqual(["hello"]);
  });

  it("preempts a running task when a new message arrives", async () => {
    const completed: string[] = [];
    const skipped: string[] = [];

    // A "slow" runner that checks the abort signal
    const runner = slowRunner(200, completed);

    chatQueue.enqueue(1, { query: "first", ctxPrefix: "" }, runner, () =>
      skipped.push("skip"),
    );

    // Enqueue second message while first is running
    await new Promise((r) => setTimeout(r, 20));
    chatQueue.enqueue(1, { query: "second", ctxPrefix: "" }, runner, () =>
      skipped.push("skip"),
    );

    // Wait long enough for the second to finish
    await new Promise((r) => setTimeout(r, 400));

    expect(skipped).toHaveLength(1); // one skip notification
    expect(completed).toEqual(["second"]); // only second ran to completion
    expect(completed).not.toContain("first");
  });

  it("discards intermediate messages and runs only the latest", async () => {
    const completed: string[] = [];
    const runner = slowRunner(150, completed);

    chatQueue.enqueue(1, { query: "A", ctxPrefix: "" }, runner);

    await new Promise((r) => setTimeout(r, 10));

    // Rapid-fire B and C while A is running
    chatQueue.enqueue(1, { query: "B", ctxPrefix: "" }, runner);
    chatQueue.enqueue(1, { query: "C", ctxPrefix: "" }, runner);

    await new Promise((r) => setTimeout(r, 400));

    // A was aborted, B was replaced by C, only C ran
    expect(completed).toEqual(["C"]);
  });

  it("isolates queues per chatId", async () => {
    const completed: string[] = [];
    const runner = async (task: ChatTask) => {
      completed.push(`${task.query}`);
    };

    chatQueue.enqueue(100, { query: "chat100", ctxPrefix: "" }, runner);
    chatQueue.enqueue(200, { query: "chat200", ctxPrefix: "" }, runner);

    await new Promise((r) => setTimeout(r, 20));

    expect(completed).toContain("chat100");
    expect(completed).toContain("chat200");
  });

  it("runs the next pending task after the current one finishes normally", async () => {
    const order: string[] = [];

    // A runner that takes 50 ms then pushes result
    const runner = async (task: ChatTask) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 50);
        task.signal.addEventListener("abort", () => {
          clearTimeout(t);
          const err = new Error("abort");
          err.name = "AbortError";
          reject(err);
        });
      });
      order.push(task.query);
    };

    chatQueue.enqueue(1, { query: "first", ctxPrefix: "" }, runner);
    // Wait until first is fully done, then enqueue second (no preemption)
    await new Promise((r) => setTimeout(r, 100));
    chatQueue.enqueue(1, { query: "second", ctxPrefix: "" }, runner);
    await new Promise((r) => setTimeout(r, 100));

    expect(order).toEqual(["first", "second"]);
  });
});
