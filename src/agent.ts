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
import type { RouteResult } from "./router.js";

/**
 * Run a task through Pi-Agent.
 */
export async function executeAgentTask(
  task: string,
  route: RouteResult,
  imagePath?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const isHostOllama =
      route.baseUrl.includes("host.docker.internal") ||
      route.baseUrl.includes("localhost") ||
      route.baseUrl.includes("127.0.0.1");

    const args: string[] = [
      "--model",
      route.model,
      "--extension",
      "/app/src/search-extension.js",
      "--no-skills",
      "--no-themes",
      "--no-context-files",
    ];

    const isVision = route.model.includes("minicpm");
    if (isVision) {
      args.push("--no-tools");
    } else {
      // Memory tool only for non-vision models (vision can't use tools)
      args.push("--extension", "/app/src/memory-tool.js");
    }

    if (isHostOllama) {
      args.push("--offline");
    }

    if (route.type === "cloud") {
      args.unshift("--thinking", "high");
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
      PI_OFFLINE: isHostOllama ? "1" : "0",
      PI_TELEMETRY: "0",
    };

    if (route.type === "cloud") {
      env.DEEPSEEK_API_KEY = route.apiKey;
      env.OPENAI_API_KEY = route.apiKey;
    }

    // pi binary: absolute path avoids cwd-relative resolution issues
    const piPath = process.env.PI_PATH || "/app/node_modules/.bin/pi";

    console.log(`[Agent] Spawning: ${piPath} ${args.join(" ")}`);

    const child = spawn(piPath, args, {
      cwd: "/app/workspace",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
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
      console.log(`[Agent] Exited with code ${code}`);

      const result = stdout.trim() || stderr.trim();
      if (code !== 0 && !stdout.trim()) {
        reject(
          new Error(
            `Agent exited with code ${code}. Stderr: ${stderr.slice(0, 500)}`,
          ),
        );
      } else {
        resolve(result);
      }
    });

    child.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
