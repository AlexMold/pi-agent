const https = require('https');

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          reject(new Error("Failed to parse JSON response"));
        }
      });
    });
    req.on('error', (e) => reject(e));
    if (options.body) req.write(options.body);
    req.end();
  });
}

module.exports = function(pi) {
  // Инструмент Brave Search
  pi.registerTool({
    name: "brave_search",
    description: "Search the web using Brave Search API for high-quality results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    },
    execute: async ({ query }) => {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY;
      if (!apiKey) return { content: [{ type: "text", text: "Error: BRAVE_SEARCH_API_KEY not set in .env" }] };

      try {
        const res = await httpRequest(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
          headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey }
        });
        const results = res.data.web?.results?.slice(0, 5).map(r => `Title: ${r.title}\nURL: ${r.url}\nDescription: ${r.description}`).join('\n\n') || "No results found.";
        return { content: [{ type: "text", text: results }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Brave Search error: ${err.message}` }] };
      }
    }
  });

  // Инструмент Google Search (Custom Search JSON API)
  pi.registerTool({
    name: "google_search",
    description: "Search the web using Google Custom Search API.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    },
    execute: async ({ query }) => {
      const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
      const cx = process.env.GOOGLE_SEARCH_CX; // Search Engine ID
      if (!apiKey || !cx) return { content: [{ type: "text", text: "Error: GOOGLE_SEARCH_API_KEY or GOOGLE_SEARCH_CX not set in .env" }] };

      try {
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}`;
        const res = await httpRequest(url);
        const results = res.data.items?.slice(0, 5).map(r => `Title: ${r.title}\nURL: ${r.link}\nDescription: ${r.snippet}`).join('\n\n') || "No results found.";
        return { content: [{ type: "text", text: results }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Google Search error: ${err.message}` }] };
      }
    }
  });
};
