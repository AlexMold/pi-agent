import fs from "fs";

import path from "path";

// The config is in credentials/xiaomi_devices.json
const CONFIG_PATH = path.join(process.cwd(), "credentials", "xiaomi_devices.json");

export function loadDevices() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
