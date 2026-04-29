import fs from "fs";

// The config is in .pi/agent/config/xiaomi_devices.json mounted to /root/.pi/agent/config in Docker
const CONFIG_PATH = "/root/.pi/agent/config/xiaomi_devices.json";

export function loadDevices() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}
