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
- status: получить текущее состояние, заряд батареи и прочее
- probe: сделать глубокий скан всех скрытых параметров устройства (MIOT)
- set_mode: режим работы (например: 0, 1, 2, 3 или quiet, standard, turbo)
- set_water: уровень воды для швабры (например: 1, 2, 3 или low, medium, high)
- set_dnd: режим не беспокоить (true/false)
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
      else if (!isNaN(Number(value)) && value.trim() !== "")
        value = Number(value);

      const config = devices[deviceId];
      if (!config) {
        return {
          content: [
            { type: "text", text: `❌ Устройство '${deviceId}' не найдено.` },
          ],
        };
      }

      let device;
      try {
        console.log(
          `[Xiaomi Tool] Connecting to ${config.ip} with token ${config.token}...`,
        );
        device = await miio.device({ address: config.ip, token: config.token });

        console.log(
          `[Xiaomi Tool] Connected to ${config.name}. Executing ${command}(${value})...`,
        );

        if (command === "status" || command === "get_status") {
          let statusInfo = {};
          try {
            statusInfo = await device.call("get_status", []);
          } catch (e) {
            try {
              statusInfo = await device.call("get_prop", [
                "power",
                "mode",
                "bright",
                "temp",
                "aqi",
              ]);
            } catch (e2) {
              try {
                // MIOT generic property fetch for ov31gl and modern devices
                const did = String(device.id || "1");
                const res = await device.call("get_properties", [
                  { did, siid: 3, piid: 1 }, // Battery %
                  { did, siid: 3, piid: 2 }, // Charging State
                  { did, siid: 2, piid: 2 }, // Device Status
                  { did, siid: 2, piid: 9 }, // Suction Mode
                  { did, siid: 2, piid: 10 }, // Water Level
                  { did, siid: 12, piid: 1 }, // Main Brush (left)
                  { did, siid: 13, piid: 1 }, // Side Brush (left)
                  { did, siid: 14, piid: 1 }, // Filter (left)
                ]);

                if (Array.isArray(res)) {
                  const props = res.reduce((acc, p) => {
                    if (p.code === 0) acc[`${p.siid}-${p.piid}`] = p.value;
                    return acc;
                  }, {});

                  const battery = props["3-1"];
                  const charging =
                    props["3-2"] === 1
                      ? "Заряжается"
                      : "Не заряжается (отключен)";

                  let state = "Неизвестно (код " + props["2-2"] + ")";
                  const stateCode = props["2-2"];
                  if (stateCode === 1) state = "Инициализация";
                  else if (stateCode === 2) state = "Спящий режим / Выключен";
                  else if (stateCode === 3) state = "Ожидание";
                  else if (stateCode === 4) state = "Уборка";
                  else if (stateCode === 5) state = "Возвращение на базу";
                  else if (stateCode === 6) state = "Обход препятствия";
                  else if (stateCode === 7)
                    state = "Подзарядка (пауза в уборке)";
                  else if (stateCode === 8) state = "Зарядка окончена";
                  else if (stateCode === 9) state = "Завис / Ошибка";
                  else if (stateCode === 10) state = "Поиск базы";
                  else if (stateCode === 11)
                    state = "Поиск базы (с навигацией)";
                  else if (stateCode === 14) state = "На зарядке";
                  else if (stateCode === 15) state = "Сканирование комнаты";

                  statusInfo = {
                    Батарея: battery !== undefined ? `${battery}%` : "Н/Д",
                    "Статус зарядки": charging,
                    Состояние: state,
                    "Режим всасывания (код)": props["2-9"],
                    "Уровень воды (код)": props["2-10"],
                    "Остаток основной щетки (ч)": props["12-1"] || "Н/Д",
                    "Остаток боковой щетки (ч)": props["13-1"] || "Н/Д",
                    "Остаток фильтра (ч)": props["14-1"] || "Н/Д",
                    "Сырые данные (MIOT)": props,
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
              {
                type: "text",
                text: `📊 Статус (${config.name}): ${JSON.stringify(statusInfo)}`,
              },
            ],
          };
        } else if (command === "probe") {
          // Deep MIOT scanner
          const did = String(device.id || "1");
          const queries = [];
          for (let s = 1; s <= 15; s++)
            for (let p = 1; p <= 15; p++)
              queries.push({ did, siid: s, piid: p });

          const validProps = [];
          for (let i = 0; i < queries.length; i += 10) {
            try {
              const chunk = queries.slice(i, i + 10);
              const res = await device.call("get_properties", chunk);
              console.log(
                "\n[XIAOMI DEBUG] PROBE",
                JSON.stringify(res, null, 2),
              );
              if (Array.isArray(res))
                validProps.push(...res.filter((r) => r.code === 0));
            } catch (err) {}
          }
          return {
            content: [
              {
                type: "text",
                text: `🔎 Глубокий скан MIOT (SIID/PIID) для ${config.name}:\n${JSON.stringify(validProps, null, 2)}`,
              },
            ],
          };
        } else if (command === "set_mode") {
          try {
            if (typeof device.setMode === "function")
              await device.setMode(value);
            else throw new Error("not supported");
          } catch (e) {
            let modeVal = Number(value);
            if (isNaN(modeVal)) {
              const v = String(value).toLowerCase();
              if (v.includes("quiet")) modeVal = 0;
              else if (v.includes("standard")) modeVal = 1;
              else if (v.includes("medium")) modeVal = 2;
              else if (v.includes("turbo") || v.includes("strong")) modeVal = 3;
              else modeVal = 1;
            }
            await device.call("set_properties", [
              {
                did: String(device.id || "1"),
                siid: 2,
                piid: 9,
                value: modeVal,
              },
            ]);
          }
          return {
            content: [
              {
                type: "text",
                text: `✅ Режим всасывания установлен: ${value}`,
              },
            ],
          };
        } else if (command === "set_water") {
          let waterVal = Number(value);
          if (isNaN(waterVal)) {
            const v = String(value).toLowerCase();
            if (v.includes("low")) waterVal = 1;
            else if (v.includes("medium")) waterVal = 2;
            else if (v.includes("high")) waterVal = 3;
            else waterVal = 2;
          }
          await device.call("set_properties", [
            {
              did: String(device.id || "1"),
              siid: 2,
              piid: 10,
              value: waterVal,
            },
          ]);
          return {
            content: [
              {
                type: "text",
                text: `✅ Уровень воды установлен: ${value} (код ${waterVal})`,
              },
            ],
          };
        } else if (command === "set_dnd") {
          const dndVal = value === "true" || value === true;
          await device.call("set_properties", [
            { did: String(device.id || "1"), siid: 5, piid: 1, value: dndVal },
          ]);
          return {
            content: [
              {
                type: "text",
                text: `✅ Режим "Не беспокоить" установлен: ${dndVal}`,
              },
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
              } catch (e) {
                try {
                  // MIOT spec for newer devices like ov31gl: start sweeping (siid 2, aiid 1)
                  await device.call("action", {
                    did: String(device.id || "1"),
                    siid: 2,
                    aiid: 1,
                    in: [],
                  });
                } catch (e2) {
                  await device.call("set_power", ["on"]);
                }
              }
            } else {
              try {
                await device.call("app_stop", []);
                await device.call("app_charge", []);
              } catch (e) {
                try {
                  // MIOT spec: stop sweeping (siid 2, aiid 2) or return to dock (siid 3, aiid 1)
                  await device.call("action", {
                    did: String(device.id || "1"),
                    siid: 2,
                    aiid: 2,
                    in: [],
                  });
                  await device.call("action", {
                    did: String(device.id || "1"),
                    siid: 3,
                    aiid: 1,
                    in: [],
                  });
                } catch (e2) {
                  await device.call("set_power", ["off"]);
                }
              }
            }
          }
        } else if (typeof device[command] === "function") {
          await device[command](value);
        } else {
          // If the method isn't wrapped by miio, we can use raw call
          const apiArgs =
            value !== undefined ? (Array.isArray(value) ? value : [value]) : [];
          const res = await device.call(command, apiArgs);
          return {
            content: [
              {
                type: "text",
                text: `✅ Успешно выполнено ${command}(${JSON.stringify(apiArgs)}). Результат: ${JSON.stringify(res)}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `✅ Успешно: ${config.name} -> ${command}(${value})`,
            },
          ],
        };
      } catch (err) {
        console.error(
          `[Xiaomi Tool] Error communicating with ${config.name}:`,
          err,
        );
        return {
          content: [
            {
              type: "text",
              text: `❌ Ошибка связи с ${config.name}: ${err.message}`,
            },
          ],
        };
      } finally {
        if (device) device.destroy();
      }
    },
  });
}
