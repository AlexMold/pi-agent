/**
 * Search Extension for Pi-Agent.
 * Registers google_search, brave_search, and tavily_search tools.
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
  const { TAVILY_API_KEY, GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_CX } = process.env;

  // ── Google Search ──────────────────────────────────────────────
  pi.registerTool({
    name: "google_search",
    description: "Search the web using Google Custom Search API.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
    execute: async ({ query }) => {
      if (!GOOGLE_SEARCH_API_KEY || !GOOGLE_SEARCH_CX) {
        return {
          content: [
            { type: "text", text: "Error: GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not set" },
          ],
        };
      }
      try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
        const res = await httpRequest(url);
        const results =
          res.data.items
            ?.slice(0, 5)
            .map((r) => `Title: ${r.title}\nURL: ${r.link}\nDescription: ${r.snippet}`)
            .join("\n\n") || "No results found.";
        return { content: [{ type: "text", text: results }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Google Search error: ${err.message}` }] };
      }
    },
  });

  // ── Brave Search ───────────────────────────────────────────────
  pi.registerTool({
    name: "brave_search",
    description: "Search the web using Brave Search API for high-quality results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
    execute: async ({ query }) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) {
        return {
          content: [{ type: "text", text: "Error: BRAVE_SEARCH_API_KEY not set" }],
        };
      }
      try {
        const res = await httpRequest(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
          {
            headers: {
              Accept: "application/json",
              "X-Subscription-Token": apiKey,
            },
          },
        );
        const results =
          res.data.web?.results
            ?.slice(0, 5)
            .map((r) => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.description}`)
            .join("\n\n") || "No results found.";
        return { content: [{ type: "text", text: results }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Brave Search error: ${err.message}` }] };
      }
    },
  });

  // ── Tavily Search ──────────────────────────────────────────────
  if (TAVILY_API_KEY) {
    pi.registerTool({
      name: "tavily_search",
      description: "AI-optimized web search via Tavily API. Returns clean, structured results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
      execute: async ({ query }) => {
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
