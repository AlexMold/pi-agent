/**
 * services/config.ts — Application configuration singleton.
 *
 * Centralizes env vars, model definitions, and constants.
 * Single source of truth for bot configuration.
 */

// ── Env ────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    console.error(`❌ ${key} not set in .env`);
    process.exit(1);
  }
  return value;
}

// ── Model types ─────────────────────────────────────────────────────

export interface ModelDef {
  id: string;
  label: string;
  type: "local" | "cloud";
}

// ── Config singleton ────────────────────────────────────────────────

class Config {
  // Env vars
  readonly telegramToken = requireEnv("TELEGRAM_TOKEN");
  readonly allowedUserId = parseInt(process.env.ALLOWED_USER_ID || "0", 10);
  readonly ollamaHost = process.env.OLLAMA_HOST || "host.docker.internal:11434";
  readonly whisperHost = process.env.WHISPER_HOST || "host.docker.internal:8080";
  readonly llamaHost = process.env.LLAMA_HOST || "host.docker.internal:8081";
  readonly deepseekApiKey = process.env.DEEPSEEK_API_KEY || "";
  readonly geminiApiKey = process.env.GEMINI_API_KEY || "";
  readonly piPath = process.env.PI_PATH || "/app/node_modules/.bin/pi";

  readonly localModels: ModelDef[] = [
    { id: "llama/llama3.2-1b", label: "🟢 Llama 3.2-1B (routing)", type: "local" },
  ];

  readonly cloudModels: ModelDef[] = [
    { id: "deepseek/deepseek-v4-pro",     label: "☁️ DeepSeek V4 Pro",       type: "cloud" },
    { id: "deepseek/deepseek-v4-flash",   label: "☁️ DeepSeek V4 Flash",     type: "cloud" },
    { id: "google/gemini-2.5-flash",      label: "☁️ Gemini 2.5 Flash (img)", type: "cloud" },
  ];

  readonly allModels: ModelDef[] = [...this.localModels, ...this.cloudModels];

  // Per-chat model overrides (mutable state)
  readonly userModelOverride = new Map<number, string>();

  // Convenience getters
  get hasCloudAccess(): boolean { return !!(this.deepseekApiKey || this.geminiApiKey); }

  findModel(id: string): ModelDef | undefined {
    return this.allModels.find((m) => m.id === id);
  }

  isVisionModel(modelId: string): boolean {
    return modelId.includes("minicpm") || modelId.includes("gemini");
  }

  isLocalModel(modelId: string): boolean {
    return this.localModels.some((m) => m.id === modelId);
  }
}

export const config = new Config();