/**
 * Search Extension for Pi-Agent.
 * Registers tavily_search (AI-optimized) and internet_search (Serper — Google index).
 * Loaded by pi CLI via: --extension src/search-extension.js
 */

import https from "https";

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (_e) {
          reject(new Error("Failed to parse JSON response"));
        }
      });
    });
    req.on("error", (e) => reject(e));
    if (options.body) req.write(options.body);
    req.end();
  });
}

export default function (pi) {
  const { TAVILY_API_KEY, SERPER_API_KEY } = process.env;

  // ── Serper.dev (Google index) ─────────────────────────────────
  if (SERPER_API_KEY) {
    pi.registerTool({
      name: "internet_search",
      description: "Search the web for real-time information using Serper (Google index). Returns titles, links, and snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
      execute: async (_toolCallId, params) => {
        const { query } = params || {};
        try {
          const res = await httpRequest("https://google.serper.dev/search", {
            method: "POST",
            headers: {
              "X-API-KEY": SERPER_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ q: query, num: 5 }),
          });

          const results = res.data.organic
            ?.map((r) => `Title: ${r.title}\nLink: ${r.link}\nSnippet: ${r.snippet}`)
            .join("\n\n") || "Nothing found.";

          return { content: [{ type: "text", text: results }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Search error: ${err.message}` }] };
        }
      },
    });
  }

  // ── Tavily Search (AI-optimized) ──────────────────────────────
  if (TAVILY_API_KEY) {
    pi.registerTool({
      name: "tavily_search",
      description: "AI-optimized web search via Tavily API. Returns clean, structured results. Use for research and complex queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
      execute: async (_toolCallId, params) => {
        const { query } = params || {};
        try {
          const res = await httpRequest("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ api_key: TAVILY_API_KEY, query, max_results: 5 }),
          });
          const results =
            res.data.results
              ?.map((r) => `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`)
              .join("\n\n") || "No results found.";
          return { content: [{ type: "text", text: results }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Tavily error: ${err.message}` }] };
        }
      },
    });
  }
}