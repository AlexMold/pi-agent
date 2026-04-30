export async function handleStatus(device, config) {
  let statusInfo;
  try {
    statusInfo = await device.call("get_status", []);
  } catch (e) {
    try {
      statusInfo = await device.call("get_prop", ["power", "mode", "bright", "temp", "aqi"]);
    } catch (e2) {
      try {
        const did = String(device.id || "1");
        const res = await device.call("get_properties", [
          { did, siid: 3, piid: 1 },
          { did, siid: 3, piid: 2 },
          { did, siid: 2, piid: 2 },
          { did, siid: 2, piid: 9 },
          { did, siid: 2, piid: 10 },
          { did, siid: 12, piid: 1 },
          { did, siid: 13, piid: 1 },
          { did, siid: 14, piid: 1 },
        ]);

        if (Array.isArray(res)) {
          const props = res.reduce((acc, p) => {
            if (p.code === 0) acc[`${p.siid}-${p.piid}`] = p.value;
            return acc;
          }, {});

          const battery = props["3-1"];
          const charging = props["3-2"] === 1 ? "Заряжается" : "Не заряжается (отключен)";

          let state = "Неизвестно (код " + props["2-2"] + ")";
          const stateCode = props["2-2"];
          if (stateCode === 1) state = "Инициализация";
          else if (stateCode === 2) state = "Спящий режим / Выключен";
          else if (stateCode === 3) state = "Ожидание";
          else if (stateCode === 4) state = "Уборка";
          else if (stateCode === 5) state = "Возвращение на базу";
          else if (stateCode === 6) state = "Обход препятствия";
          else if (stateCode === 7) state = "Подзарядка (пауза в уборке)";
          else if (stateCode === 8) state = "Зарядка окончена";
          else if (stateCode === 9) state = "Завис / Ошибка";
          else if (stateCode === 10) state = "Поиск базы";
          else if (stateCode === 11) state = "Поиск базы (с навигацией)";
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
    content: [{ type: "text", text: `📊 Статус (${config.name}): ${JSON.stringify(statusInfo)}` }],
  };
}
