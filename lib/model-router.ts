/**
 * RoutingEngine - A flexible model routing layer for AI agents.
 */

import { complete, type Message } from "@mariozechner/pi-ai";

export interface Route {
  id: string;
  name: string;
  description: string;
  keywords?: string[];
  examples?: string[];
  model?: string; // Optional: specify which model to use for this route
  metadata?: Record<string, any>;
}

export interface RoutingResult {
  winningRoute: Route | null;
  confidence: number;
  explanation?: string;
}

export class RoutingEngine {
  private routes: Route[] = [];
  private routerModel: string;

  constructor(options: { routerModel?: string } = {}) {
    this.routerModel = options.routerModel || "ollama/gemma4:latest";
  }

  addRoute(route: Route) {
    this.routes.push(route);
  }

  addRoutes(routes: Route[]) {
    this.routes.push(...routes);
  }

  /**
   * Route a query using keyword matching (fastest)
   */
  async routeByKeyword(query: string): Promise<RoutingResult> {
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
   * Route a query using an LLM (most flexible)
   */
  async routeByLLM(query: string, signal?: AbortSignal): Promise<RoutingResult> {
    if (this.routes.length === 0) {
      return { winningRoute: null, confidence: 0, explanation: "No routes defined" };
    }

    const systemPrompt = `You are a semantic router. Your task is to categorize the user's query into one of the following routes.

Available Routes:
${this.routes.map(r => `- ${r.id}: ${r.description}${r.examples ? ` (Examples: ${r.examples.join(", ")})` : ""}`).join("\n")}

Return the result in JSON format:
{
  "routeId": "the-id-or-null",
  "confidence": 0.0 to 1.0,
  "explanation": "why this route was chosen"
}

If no route matches well, return "routeId": null.`;

    try {
      const response = await complete(this.routerModel, {
        systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: query }], timestamp: Date.now() }]
      }, { signal });

      const text = response.content.filter(c => c.type === "text").map(c => c.text).join("");
      const jsonStr = text.match(/\{[\s\S]*\}/)?.[0];
      
      if (!jsonStr) {
        // Fallback to plain text ID if JSON fails
        const matchedRoute = this.routes.find(r => text.includes(r.id));
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

  /**
   * Hybrid routing: keyword first, then LLM
   */
  async route(query: string, signal?: AbortSignal): Promise<RoutingResult> {
    const keywordResult = await this.routeByKeyword(query);
    if (keywordResult.winningRoute) return keywordResult;

    return this.routeByLLM(query, signal);
  }
}
