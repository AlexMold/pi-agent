/**
 * Agent — Pi-Agent Core executor.
 *
 * Spawns pi with the selected model and extensions (web search).
 * Works in both local (Ollama) and cloud (DeepSeek API) modes.
 *
 * pi CLI syntax: pi [options] -p "prompt"
 * (no "run" subcommand — that was a bug in the old code)
 */

import { spawn } from "child_process";
import { join } from "path";
import type { RouteResult } from "./router.js";

/** Token usage returned by LLM (best-effort — may be 0 if not reported). */
export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentResult {
  text: string;
  usage: AgentUsage;
}

/**
 * Run a task through Pi-Agent.
 *
 * @param signal  Optional AbortSignal — when aborted the child process is
 *                killed and an AbortError is thrown so callers can detect
 *                preemption cleanly.
 */
export async function executeAgentTask(
  task: string,
  route: RouteResult,
  imagePath?: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await executeAgentTaskWithUsage(task, route, imagePath, signal);
  return result.text;
}

/**
 * Same as executeAgentTask, but also returns token usage when the underlying
 * API exposes it (cloud OpenAI-compatible APIs include `usage` in JSON).
 * Falls back to zero values when usage is not reported.
 */
export async function executeAgentTaskWithUsage(
  task: string,
  route: RouteResult,
  imagePath?: string,
  signal?: AbortSignal,
): Promise<AgentResult> {
  // If already aborted before we even start, bail out immediately
  if (signal?.aborted) {
    const err = new Error("Aborted before start");
    err.name = "AbortError";
    throw err;
  }

  // ── Local model: call llama-server API directly (Pi print mode is buggy) ──
  if (route.type === "local" && route.model.includes("llama")) {
    return callLocalModel(task, route, signal);
  }

  return new Promise((resolve, reject) => {
    const args: string[] = [
      "--model",
      route.model,
      "--extension",
      `${import.meta.dirname}/tools/search/index.js`,
      "--no-skills",
      "--no-themes",
    ];

    const isVision = route.model.includes("minicpm");
    if (isVision) {
      // MiniCPM is local, no tool support
      args.push("--no-tools");
    } else {
      // Memory tool only for non-vision models (vision can't use tools)
      args.push("--extension", `${import.meta.dirname}/tools/memory/index.js`);
      // Calendar tool: create & list Google Calendar events
      args.push("--extension", `${import.meta.dirname}/tools/calendar/index.js`);
      // Xiaomi Home tool
      args.push("--extension", `${import.meta.dirname}/tools/xiaomi/index.js`);
      // Reminder tool: set / list / delete reminders
      args.push("--extension", `${import.meta.dirname}/tools/reminder/index.js`);
    }

    if (route.type === "cloud") {
      args.unshift("--thinking", "medium");
    }

    // Prompt and --print flag must come last
    // If image attached, add @path before the prompt
    if (imagePath) {
      args.push(`@${imagePath}`);
    }
    args.push("--print", task);

    // If cloud model, pass API key via env
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "1",
      PI_OFFLINE: "0",
      PI_TELEMETRY: "0",
    };

    if (route.type === "cloud") {
      env.DEEPSEEK_API_KEY = route.apiKey;
      env.OPENAI_API_KEY = route.apiKey;
      env.GOOGLE_API_KEY = route.apiKey;
    }

    // pi binary: resolved next to this file (works from /app and from a checkout)
    const piPath =
      process.env.PI_PATH || join(import.meta.dirname, "..", "node_modules", ".bin", "pi");

    console.log(`[Agent] Spawning: ${piPath} ${args.join(" ")}`);

    const child = spawn(piPath, args, {
      // Relative writes by the agent land here: /app/workspace (volume) or repo root
      cwd: process.env.WORKSPACE_DIR || process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    // ── Abort handling ───────────────────────────────────────────────
    const onAbort = () => {
      console.log("[Agent] AbortSignal fired — killing child process");
      child.kill("SIGTERM");
      // Give it a moment, then SIGKILL if still alive
      setTimeout(() => child.kill("SIGKILL"), 2000);
      const abortErr = new Error("Agent task aborted by newer message");
      abortErr.name = "AbortError";
      reject(abortErr);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      // Log live output so we can see what Pi is doing
      for (const line of chunk.split("\n").filter(Boolean)) {
        console.log(`[Pi STDOUT] ${line}`);
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      const chunk = data.toString().trim();
      stderr += chunk;
      if (chunk) console.error(`[Pi STDERR] ${chunk}`);
    });

    // 15-minute timeout
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Agent timeout (15 min)"));
    }, 900_000);

    child.on("close", (code: number | null) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      console.log(`[Agent] Exited with code ${code}`);
      console.log(`[Agent] Raw stdout (${stdout.length} chars): ${stdout.slice(0, 200)}`);
      console.log(`[Agent] Raw stderr (${stderr.length} chars): ${stderr.slice(0, 200)}`);

      // If we were aborted, the reject was already called — don't double-reject
      if (signal?.aborted) return;

      const result = stdout.trim() || stderr.trim();
      if (code !== 0 && !stdout.trim()) {
        reject(
          new Error(
            `Agent exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`,
          ),
        );
      } else {
        // Best-effort token extraction from pi's streamed JSON output
        const usage = extractUsageFromOutput(stdout);
        resolve({ text: result, usage });
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (!signal?.aborted) reject(err);
    });
  });
}

// ── Direct API call for local llama.cpp model ──────────────────────

async function callLocalModel(
  task: string,
  route: RouteResult,
  signal?: AbortSignal,
): Promise<AgentResult> {
  const url = `${route.baseUrl}/chat/completions`;
  console.log(`[Agent] Direct API call: ${url}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(route.apiKey && route.apiKey !== "not-needed"
        ? { Authorization: `Bearer ${route.apiKey}` }
        : {}),
    },
    body: JSON.stringify({
      messages: [
        { role: "user", content: task },
      ],
      max_tokens: 512,
      temperature: 0.7,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Local model HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text = data.choices?.[0]?.message?.content || "";
  const usage: AgentUsage = {
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
  };
  console.log(
    `[Agent] Local model response (${text.length} chars, ${usage.inputTokens}+${usage.outputTokens} tok): ${text.slice(0, 100)}`,
  );
  return { text, usage };
}

/**
 * Best-effort extraction of token usage from pi's streamed stdout.
 * Pi emits the OpenAI-compatible `usage` block as part of the final JSON chunk.
 * We scan the full output for the last `{"prompt_tokens":N,"completion_tokens":M,...}`
 * pattern, since the stream may contain many JSON fragments.
 */
function extractUsageFromOutput(stdout: string): AgentUsage {
  // Regex matches the OpenAI usage object regardless of property order
  const re =
    /"usage"\s*:\s*\{[^}]*?"prompt_tokens"\s*:\s*(\d+)[^}]*?"completion_tokens"\s*:\s*(\d+)/g;
  let lastIn = 0;
  let lastOut = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stdout)) !== null) {
    lastIn = parseInt(match[1], 10);
    lastOut = parseInt(match[2], 10);
  }
  return { inputTokens: lastIn, outputTokens: lastOut };
}
