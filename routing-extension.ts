/**
 * Routing Engine Extension for Pi
 */

import { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { RoutingEngine, Route } from "./lib/model-router.js";
import { Type, StringEnum } from "@mariozechner/pi-ai";

const DEFAULT_ROUTES: Route[] = [
  {
    id: "simple_task",
    name: "Simple Task",
    description: "Basic queries, file listing, simple text edits, or greetings.",
    keywords: ["ls", "list", "hello", "hi", "how are you"],
    model: "ollama/gemma4:latest"
  },
  {
    id: "complex_task",
    name: "Complex Task",
    description: "Tasks requiring deep analysis, complex coding, or multi-step reasoning.",
    keywords: ["analyze", "implement", "fix", "refactor"],
    model: "ollama/qwen3.6:35b-a3b-q8_0"
  },
  {
    id: "vision_task",
    name: "Vision Task",
    description: "Tasks involving images, screenshots, or UI analysis.",
    keywords: ["image", "screenshot", "look at", "describe"],
    model: "ollama/gemma4:31b"
  }
];

export default function(pi: ExtensionAPI) {
  const engine = new RoutingEngine();
  engine.addRoutes(DEFAULT_ROUTES);

  // --- Google API Compatibility Fix (TP-106 / Google SDK strictness) ---
  pi.on("session_start", () => {
    const toolsToFix = [
      { name: "orch_integrate", props: { mode: ["fast-forward", "merge", "pr"] } },
      { name: "send_agent_message", props: { type: ["steer", "query", "abort", "info"] } },
      { name: "broadcast_message", props: { type: ["steer", "info", "abort"] } },
      { name: "review_step", props: { type: ["plan", "code"] } }
    ];

    for (const fix of toolsToFix) {
      const oldTool = pi.getAllTools().find(t => t.name === fix.name);
      if (oldTool) {
        // Construct a new parameter object that uses standard enums for the problematic fields
        const newParams: any = { ...oldTool.parameters };
        for (const [prop, values] of Object.entries(fix.props)) {
          if (newParams.properties && newParams.properties[prop]) {
            newParams.properties[prop] = {
              type: "string",
              enum: values,
              description: newParams.properties[prop].description
            };
          }
        }

        pi.registerTool({
          ...oldTool,
          parameters: newParams
        });
      }
    }
  });

  // --- Active Routing Logic ---
  pi.on("before_agent_start", async (event, ctx) => {
    // Get the last user message
    const lastUserEntry = ctx.sessionManager.getBranch()
      .reverse()
      .find(e => e.type === "message" && e.message.role === "user");

    if (lastUserEntry && lastUserEntry.type === "message") {
      const query = lastUserEntry.message.content
        .filter(c => c.type === "text")
        .map(c => c.text)
        .join(" ");

      const result = await engine.route(query);
      
      if (result.winningRoute?.model) {
        // Find the model in the registry to see if it's available/logged in
        const [provider, id] = result.winningRoute.model.split("/");
        const model = ctx.modelRegistry.find(provider, id);
        
        if (model) {
          const success = await pi.setModel(model);
          if (success) {
            ctx.ui.setStatus("routing", `Routed to: ${result.winningRoute.name} (${model.id})`);
          } else {
            ctx.ui.setStatus("routing", `Route ${result.winningRoute.name} skipped: Service logged out`);
          }
        }
      }
    }
  });

  pi.registerCommand("route", {
    description: "Test the routing engine with a query",
    handler: async (args, ctx) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /route <query>", "error");
        return;
      }

      ctx.ui.notify("Analyzing query...", "info");
      const result = await engine.route(args);

      if (result.winningRoute) {
        ctx.ui.notify(`Route: ${result.winningRoute.name} (ID: ${result.winningRoute.id})`, "success");
        if (result.explanation) {
          ctx.ui.log(`Reason: ${result.explanation}`);
        }
        if (result.winningRoute.model) {
          ctx.ui.log(`Recommended model: ${result.winningRoute.model}`);
        }
      } else {
        ctx.ui.notify("No suitable route found.", "warning");
      }
    }
  });

  pi.registerTool({
    name: "route_task",
    description: "Automatically routes a task to the most appropriate model or agent.",
    parameters: Type.Object({
      task: Type.String({ description: "The task to route." }),
      use_subagent: Type.Optional(Type.Boolean({ 
        description: "If true, will attempt to execute the task using the chosen model via subagent.",
        default: false 
      }))
    }),
    async execute(toolCallId, { task, use_subagent }, signal, onUpdate, ctx) {
      const result = await engine.route(task, signal);

      if (!result.winningRoute) {
        return {
          content: [{ type: "text", text: "No specific route found. Proceeding with default model." }],
          details: { route: null }
        };
      }

      let executionResult = "";
      if (use_subagent && result.winningRoute.model) {
        // Here we could call the subagent tool if it were accessible via API
        // Since it's another tool, we'll just return the recommendation for now
        // Or we could spawn pi manually
        executionResult = `Recommendation: Use ${result.winningRoute.model} for this task.`;
      }

      return {
        content: [{ 
          type: "text", 
          text: `Routed to: **${result.winningRoute.name}**\n${result.explanation || ""}\n${executionResult}` 
        }],
        details: { 
          routeId: result.winningRoute.id,
          model: result.winningRoute.model,
          confidence: result.confidence
        }
      };
    }
  });
}
