/**
 * Xiaomi Tool Extension for Pi-Agent.
 *
 * Registers `control_xiaomi` tool to control local miio devices.
 */

import miio from "miio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The config is in .pi/agent/config/xiaomi_devices.json mounted to /root/.pi/agent/config in Docker
const CONFIG_PATH = "/root/.pi/agent/config/xiaomi_devices.json";

function loadDevices() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

export default function (pi) {
  let devices;
  try {
    devices = loadDevices();
  } catch (err) {
    console.error("[Xiaomi Tool] Could not load devices config:", err.message);
    return; // Do not register tool if config is missing
  }

  pi.registerTool({
    name: "control_xiaomi",
    description: `Управление устройствами Xiaomi Home по локальной сети.
Доступные ID: ${Object.keys(devices).join(", ")}.
Доступные команды зависят от устройства:
- power: вкл/выкл (true/false)
- set_power: альтернативная команда вкл/выкл для некоторых устройств ("on"/"off")
- set_mode: режим работы
- set_bright: яркость (1-100)
- set_temp: температура
Используй этот инструмент только по явному запросу или триггеру.`,
    parameters: {
      type: "object",
      properties: {
        deviceId: { type: "string", description: "ID устройства" },
        command: { type: "string", description: "Название команды" },
        value: { type: "string", description: "Значение" },
      },
    },
    execute: async (toolCallId, args) => {
      console.log(`\n\n=== [XIAOMI DEBUG] EXECUTION STARTED ===`);
      console.log(`[XIAOMI DEBUG] callId:`, toolCallId);
      console.log(`[XIAOMI DEBUG] raw args:`, JSON.stringify(args, null, 2));
      
      let { deviceId, command, value } = args;

      // Auto-parse value since we forced it to be a string in JSON Schema
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (!isNaN(Number(value)) && value.trim() !== "") value = Number(value);

      const config = devices[deviceId];
      if (!config) {
        return {
          content: [{ type: "text", text: `❌ Устройство '${deviceId}' не найдено.` }],
        };
      }

      let device;
      try {
        console.log(`[Xiaomi Tool] Connecting to ${config.ip} with token ${config.token}...`);
        device = await miio.device({ address: config.ip, token: config.token });

        console.log(`[Xiaomi Tool] Connected to ${config.name}. Executing ${command}(${value})...`);

        if (command === "status" || command === "get_status") {
          let statusInfo = {};
          try {
            statusInfo = await device.call("get_status", []);
          } catch (e) {
            try {
              statusInfo = await device.call("get_prop", ["power", "mode", "bright", "temp", "aqi"]);
            } catch (e2) {
              try {
                // MIOT generic property fetch for ov31gl and modern devices
                const did = String(device.id || "1");
                const res = await device.call("get_properties", [
                  { did, siid: 3, piid: 1 }, // Battery %
                  { did, siid: 3, piid: 2 }, // Charging State
                  { did, siid: 2, piid: 2 }, // Device Status
                  { did, siid: 2, piid: 4 }, // Suction Mode
                  { did, siid: 2, piid: 5 }  // Water Level (if applicable)
                ]);
                
                if (Array.isArray(res)) {
                  const props = res.reduce((acc, p) => {
                    if (p.code === 0) acc[`${p.siid}-${p.piid}`] = p.value;
                    return acc;
                  }, {});

                  const battery = props["3-1"];
                  const charging = props["3-2"] === 1 ? "Заряжается" : "Не заряжается";
                  
                  let state = "Неизвестно (" + props["2-2"] + ")";
                  if (props["2-2"] === 1) state = "Ожидание / Спит";
                  if (props["2-2"] === 2) state = "На паузе";
                  if (props["2-2"] === 3) state = "Убирает";
                  if (props["2-2"] === 4) state = "Убирает";
                  if (props["2-2"] === 5) state = "Едет на базу";
                  if (props["2-2"] === 6) state = "На базе (зарядка)";

                  statusInfo = {
                    "Батарея": battery !== undefined ? `${battery}%` : "Н/Д",
                    "Статус зарядки": charging,
                    "Состояние": state,
                    "Режим всасывания (код)": props["2-4"],
                    "Сырые данные (MIOT)": props
                  };
                } else {
                  statusInfo = "Не удалось получить статус MIOT";
                }
              } catch (e3) {
                statusInfo = "Не удалось получить статус MIOT (not supported)";
              }
            }
          }
          return {
            content: [
              { type: "text", text: `📊 Статус (${config.name}): ${JSON.stringify(statusInfo)}` },
            ],
          };
        } else if (command === "power") {
          const powerState = value === "true" || value === true;
          if (typeof device.power === "function") {
            await device.power(powerState);
          } else if (typeof device.setPower === "function") {
            await device.setPower(powerState);
          } else {
            // Fallback for devices without a native generic power method (e.g. vacuums)
            if (powerState) {
              try { 
                await device.call("app_start", []); 
              } catch(e) { 
                try {
                  // MIOT spec for newer devices like ov31gl: start sweeping (siid 2, aiid 1)
                  await device.call("action", {"did": String(device.id || "1"), "siid": 2, "aiid": 1, "in": []});
                } catch(e2) {
                  await device.call("set_power", ["on"]); 
                }
              }
            } else {
              try { 
                await device.call("app_stop", []); 
                await device.call("app_charge", []); 
              } catch(e) { 
                try {
                  // MIOT spec: stop sweeping (siid 2, aiid 2) or return to dock (siid 3, aiid 1)
                  await device.call("action", {"did": String(device.id || "1"), "siid": 2, "aiid": 2, "in": []});
                  await device.call("action", {"did": String(device.id || "1"), "siid": 3, "aiid": 1, "in": []});
                } catch(e2) {
                  await device.call("set_power", ["off"]); 
                }
              }
            }
          }
        } else if (typeof device[command] === "function") {
          await device[command](value);
        } else {
          // If the method isn't wrapped by miio, we can use raw call
          const apiArgs = value !== undefined ? (Array.isArray(value) ? value : [value]) : [];
          const res = await device.call(command, apiArgs);
          return {
            content: [
              { type: "text", text: `✅ Успешно выполнено ${command}(${JSON.stringify(apiArgs)}). Результат: ${JSON.stringify(res)}` },
            ],
          };
        }

        return {
          content: [
            { type: "text", text: `✅ Успешно: ${config.name} -> ${command}(${value})` },
          ],
        };
      } catch (err) {
        console.error(`[Xiaomi Tool] Error communicating with ${config.name}:`, err);
        return {
          content: [
            { type: "text", text: `❌ Ошибка связи с ${config.name}: ${err.message}` },
          ],
        };
      } finally {
        if (device) device.destroy();
      }
    },
  });
}
