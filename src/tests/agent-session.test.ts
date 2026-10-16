/**
 * Tests for persistent per-chat session args in the pi spawn.
 * Mocks child_process.spawn — never runs a real pi.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { tmpdir } from "os";
import { join } from "path";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", () => ({ spawn: spawnMock }));

import { executeAgentTaskWithUsage } from "../agent.js";

const route = {
  model: "deepseek/deepseek-v4-flash",
  type: "cloud" as const,
  reason: "test",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "test-key",
};

function makeChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => {
    child.stdout.emit("data", Buffer.from("Ответ"));
    child.emit("close", 0);
  });
  return child;
}

describe("executeAgentTaskWithUsage session args", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => makeChild());
    process.env.WORKSPACE_DIR = join(tmpdir(), "pi-session-test");
  });

  it("passes --session-id and --session-dir when sessionId is set", async () => {
    await executeAgentTaskWithUsage("привет", route, undefined, undefined, "42");

    const [piPath, args, opts] = spawnMock.mock.calls[0];
    const i = args.indexOf("--session-id");
    expect(i).toBeGreaterThan(-1);
    expect(args[i + 1]).toBe("chat_42");

    const d = args.indexOf("--session-dir");
    expect(d).toBeGreaterThan(-1);
    expect(args[d + 1]).toBe(join(process.env.WORKSPACE_DIR!, "sessions"));

    expect(opts.env.PI_SESSION_ID).toBe("chat_42");
    expect(opts.cwd).toBe(process.env.WORKSPACE_DIR);
  });

  it("omits session flags and env without sessionId", async () => {
    delete process.env.PI_SESSION_ID;
    await executeAgentTaskWithUsage("привет", route);

    const [piPath, args, opts] = spawnMock.mock.calls[0];
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--session-dir");
    expect(opts.env.PI_SESSION_ID).toBeUndefined();
  });
});
