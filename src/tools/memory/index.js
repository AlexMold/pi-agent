/**
 * Memory Tool Extension for Pi-Agent.
 *
 * Registers `recall_memory` tool so the agent can retrieve past conversations.
 * Supports: semantic search, filtering by role, sorting by timestamp, grouping.
 */

import * as lancedb from "@lancedb/lancedb";

const OLLAMA_BASE = process.env.OLLAMA_HOST || "host.docker.internal:11434";

let db;
let table;

async function init() {
  if (db) return;
  db = await lancedb.connect("memory_db/ai_context");
  const tables = await db.tableNames();
  table = tables.includes("history")
    ? await db.openTable("history")
    : null;
}

async function embed(text) {
  const res = await fetch(`http://${OLLAMA_BASE}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: text }),
  });
  const data = await res.json();
  return data.embedding;
}

export default function (pi) {
  pi.registerTool({
    name: "recall_memory",
    description: `Search past conversations and retrieve relevant context.
Use this when you need to reference earlier parts of the conversation or user preferences.
Supports filtering by role (user/assistant), sorting by timestamp, grouping by time periods.`,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to find semantically similar past messages",
        },
        role: {
          type: "string",
          description: "Filter by role: 'user' or 'assistant'. Leave empty for both.",
        },
        limit: {
          type: "number",
          description: "Max results (default 5, max 20)",
          default: 5,
        },
        sort: {
          type: "string",
          description: "Sort order: 'recent' (newest first), 'oldest' (oldest first), 'relevant' (semantic score, default)",
          default: "relevant",
        },
      },
      required: ["query"],
    },
    execute: async (toolCallId, params) => {
      const { query, role, limit = 5, sort = "relevant" } = params;

      try {
        await init();
        if (!table) return { content: [{ type: "text", text: "No conversation history found." }] };

        const vector = await embed(query);
        const searchLimit = Math.min(limit || 5, 20);

        let results;

        if (sort === "recent" || sort === "oldest") {
          // Get all matching results, then sort by timestamp
          const raw = await table
            .search(vector)
            .limit(50)
            .toArray();
          results = raw
            .filter((r) => !role || r.role === role)
            .sort((a, b) =>
              sort === "recent"
                ? (b.timestamp || 0) - (a.timestamp || 0)
                : (a.timestamp || 0) - (b.timestamp || 0)
            )
            .slice(0, searchLimit);
        } else {
          // Semantic relevance (default)
          results = await table
            .search(vector)
            .where(role ? `role = "${role}"` : "true")
            .limit(searchLimit)
            .toArray();
        }

        if (!results.length) {
          return {
            content: [{ type: "text", text: "No relevant conversation history found." }],
          };
        }

        const formatted = results
          .map((r) => {
            const date = r.timestamp
              ? new Date(r.timestamp).toISOString().replace("T", " ").slice(0, 19)
              : "unknown time";
            return `[${date}] [${r.role}]: ${r.text}`;
          })
          .join("\n---\n");

        return {
          content: [{ type: "text", text: `Found ${results.length} relevant messages:\n\n${formatted}` }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Memory search error: ${err.message}` }],
        };
      }
    },
  });
}
