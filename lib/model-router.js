/**
 * RoutingEngine - A flexible model routing layer for AI agents.
 * Adapted for use with the Pi CLI.
 */
const { spawn } = require("child_process");
const path = require("path");

class RoutingEngine {
  constructor(options = {}) {
    this.routes = [];
    this.routerModel = options.routerModel || "google-antigravity/gemini-3-flash";
    this.piPath = options.piPath || path.join(process.env.HOME, ".nvm/versions/node/v24.13.0/bin/pi");
  }

  addRoute(route) {
    this.routes.push(route);
  }

  addRoutes(routes) {
    this.routes.push(...routes);
  }

  /**
   * Route a query using keyword matching (fastest)
   */
  async routeByKeyword(query) {
    const queryLower = query.toLowerCase();
    for (const route of this.routes) {
      if (route.keywords) {
        for (const kw of route.keywords) {
          if (queryLower.includes(kw.toLowerCase())) {
            return { winningRoute: route, confidence: 1.0, explanation: `Matched keyword: ${kw}` };
          }
        }
      }
    }
    return { winningRoute: null, confidence: 0 };
  }

  /**
   * Route a query using the Pi CLI (most flexible)
   */
  async routeByLLM(query) {
    if (this.routes.length === 0) {
      return { winningRoute: null, confidence: 0, explanation: "No routes defined" };
    }

    const systemPrompt = `You are a semantic router for an Accounting Assistant bot. Your task is to categorize the user's query into one of the following routes.

Available Routes:
${this.routes.map(r => `- ${r.id}: ${r.description}${r.examples ? ` (Examples: ${r.examples.join(", ")})` : ""}`).join("\n")}

Return the result in JSON format:
{
  "routeId": "the-id-or-null",
  "confidence": 0.0 to 1.0,
  "explanation": "why this route was chosen"
}

If no route matches well, return "routeId": null.`;

    const prompt = `${systemPrompt}\n\nQuery: "${query}"\n\nResult (JSON):`;

    try {
      const response = await this._runPi(prompt, this.routerModel);
      const jsonStr = response.match(/\{[\s\S]*\}/)?.[0];
      
      if (!jsonStr) {
        const matchedRoute = this.routes.find(r => response.includes(r.id));
        return { 
          winningRoute: matchedRoute || null, 
          confidence: matchedRoute ? 0.7 : 0, 
          explanation: "LLM returned non-JSON response" 
        };
      }

      const result = JSON.parse(jsonStr);
      const winningRoute = this.routes.find(r => r.id === result.routeId) || null;
      
      return {
        winningRoute,
        confidence: result.confidence || 0,
        explanation: result.explanation
      };
    } catch (error) {
      console.error("LLM routing failed:", error);
      return { winningRoute: null, confidence: 0, explanation: `Error: ${error.message}` };
    }
  }

  async route(query) {
    const keywordResult = await this.routeByKeyword(query);
    if (keywordResult.winningRoute) return keywordResult;

    return this.routeByLLM(query);
  }

  _runPi(prompt, model) {
    return new Promise((resolve, reject) => {
      const args = ["--model", model, "-p", "-c", prompt];
      const child = spawn(this.piPath, args, {
        env: { ...process.env, PI_SKIP_VERSION_CHECK: "1" }
      });

      let stdout = "";
      child.stdout.on("data", (data) => stdout += data);
      child.on("close", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`Pi CLI exited with code ${code}`));
      });
    });
  }
}

module.exports = { RoutingEngine };
