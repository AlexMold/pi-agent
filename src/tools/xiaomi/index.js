import miio from "miio";
import { loadDevices } from "./config.js";
import { handleStatus } from "./commands/status.js";
import { handleProbe } from "./commands/probe.js";
import { handleVacuumCommand } from "./commands/vacuum.js";

export default function (pi) {
  let devices;
  try {
    devices = loadDevices();
  } catch (err) {
    console.warn("[Xiaomi Tool] Devices config not available:", err.message);
    return;
  }

  pi.registerTool({
    name: "control_xiaomi",
    description: `Управление устройствами Xiaomi Home по локальной сети.
Доступные ID: ${Object.keys(devices).join(", ")}.
Доступные команды зависят от устройства:
- power: вкл/выкл (true/false)
- status: получить текущее состояние, заряд батареи и прочее
- probe: сделать глубокий скан всех скрытых параметров устройства (MIOT)
- set_mode: мощность всасывания (silent, standard, strong, turbo)
- set_water: уровень воды для швабры (low, medium, high)
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
      let { deviceId, command, value } = args;

      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (
        !isNaN(Number(value)) &&
        value !== undefined &&
        String(value).trim() !== ""
      )
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
        device = await miio.device({ address: config.ip, token: config.token });

        if (command === "status" || command === "get_status") {
          return await handleStatus(device, config);
        } else if (command === "probe") {
          return await handleProbe(device, config);
        }

        const vacuumResult = await handleVacuumCommand(device, command, value);
        if (vacuumResult) return vacuumResult;

        if (typeof device[command] === "function") {
          await device[command](value);
        } else {
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
        console.error(`[Xiaomi Tool] Error with ${config.name}:`, err.message);
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
