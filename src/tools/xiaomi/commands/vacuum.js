export async function handleVacuumCommand(device, command, value) {
  if (command === "set_mode") {
    try {
      if (typeof device.setMode === "function") await device.setMode(value);
      else throw new Error("not supported");
    } catch (e) {
      let modeVal = Number(value);
      if (isNaN(modeVal)) {
        const v = String(value).toLowerCase();
        if (v.includes("quiet") || v.includes("silent") || v.includes("min")) modeVal = 1;
        else if (v.includes("standard") || v.includes("normal")) modeVal = 0;
        else if (v.includes("strong") || v.includes("medium")) modeVal = 2;
        else if (v.includes("turbo") || v.includes("max")) modeVal = 3;
        else modeVal = 0;
      }
      await device.call("set_properties", [{ did: String(device.id || "1"), siid: 2, piid: 9, value: modeVal }]);
    }
    return { content: [{ type: "text", text: `✅ Режим всасывания установлен: ${value}` }] };
  }

  if (command === "set_water") {
    let waterVal = Number(value);
    if (isNaN(waterVal)) {
      const v = String(value).toLowerCase();
      if (v.includes("low")) waterVal = 1;
      else if (v.includes("medium")) waterVal = 2;
      else if (v.includes("high")) waterVal = 3;
      else waterVal = 2;
    }
    await device.call("set_properties", [{ did: String(device.id || "1"), siid: 2, piid: 10, value: waterVal }]);
    return { content: [{ type: "text", text: `✅ Уровень воды установлен: ${value} (код ${waterVal})` }] };
  }

  if (command === "set_dnd") {
    const dndVal = value === "true" || value === true;
    await device.call("set_properties", [{ did: String(device.id || "1"), siid: 5, piid: 1, value: dndVal }]);
    return { content: [{ type: "text", text: `✅ Режим "Не беспокоить" установлен: ${dndVal}` }] };
  }

  if (command === "power") {
    const powerState = value === "true" || value === true;
    if (typeof device.power === "function") {
      await device.power(powerState);
    } else if (typeof device.setPower === "function") {
      await device.setPower(powerState);
    } else {
      if (powerState) {
        try {
          await device.call("app_start", []);
        } catch (e) {
          try {
            await device.call("action", { did: String(device.id || "1"), siid: 2, aiid: 1, in: [] });
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
            await device.call("action", { did: String(device.id || "1"), siid: 2, aiid: 2, in: [] });
            await device.call("action", { did: String(device.id || "1"), siid: 3, aiid: 1, in: [] });
          } catch (e2) {
            await device.call("set_power", ["off"]);
          }
        }
      }
    }
    return { content: [{ type: "text", text: `✅ Питание установлено: ${powerState}` }] };
  }

  return null;
}
