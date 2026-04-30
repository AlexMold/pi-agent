import fs from "fs";
import path from "path";

// Config location: try cwd/credentials (Docker: /app/workspace/credentials),
// then /app/credentials (docker-compose mount), then CREDENTIALS_DIR env var.
function resolveConfigPath() {
  const envPath = process.env.CREDENTIALS_DIR
    ? path.join(process.env.CREDENTIALS_DIR, "xiaomi_devices.json")
    : null;

  const candidates = [
    envPath,
    path.join(process.cwd(), "credentials", "xiaomi_devices.json"),
    path.join("/app/credentials", "xiaomi_devices.json"),
    path.join(process.cwd(), "..", "credentials", "xiaomi_devices.json"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `Config file not found. Tried:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
  );
}

export function loadDevices() {
  const configPath = resolveConfigPath();
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
