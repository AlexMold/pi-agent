export async function handleProbe(device, config) {
  const did = String(device.id || "1");
  const queries = [];
  for (let s = 1; s <= 15; s++) {
    for (let p = 1; p <= 15; p++) {
      queries.push({ did, siid: s, piid: p });
    }
  }

  const validProps = [];
  for (let i = 0; i < queries.length; i += 10) {
    try {
      const chunk = queries.slice(i, i + 10);
      const res = await device.call("get_properties", chunk);
      console.log("\n[XIAOMI DEBUG] PROBE", JSON.stringify(res, null, 2));
      if (Array.isArray(res)) {
        validProps.push(...res.filter((r) => r.code === 0));
      }
    } catch (err) {}
  }
  return {
    content: [{ type: "text", text: `🔎 Глубокий скан MIOT (SIID/PIID) для ${config.name}:\n${JSON.stringify(validProps, null, 2)}` }],
  };
}
