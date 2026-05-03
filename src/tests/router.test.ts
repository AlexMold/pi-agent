/**
 * tests/router.test.ts
 *
 * Tests for SmartRouter keyword-based fallback (no Ollama network required).
 * Uses the synchronous routeSync() path only.
 */

import { describe, it, expect } from "vitest";
import { SmartRouter } from "../router.js";

describe("SmartRouter.routeSync – keyword routing", () => {
  it("routes simple greetings to lightweight gemma4:latest", () => {
    const result = SmartRouter.routeSync("привет", []);
    expect(result.model).toBe("ollama/gemma4:latest");
    expect(result.type).toBe("local");
  });

  it("routes 'hi' greeting to lightweight model", () => {
    const result = SmartRouter.routeSync("hi", []);
    expect(result.model).toBe("ollama/gemma4:latest");
  });

  it("routes refactoring tasks to cloud pro model", () => {
    const result = SmartRouter.routeSync("помоги с рефакторингом этого кода", []);
    expect(result.model).toContain("deepseek-v4-pro");
    expect(result.type).toBe("cloud");
  });

  it("routes security audit to cloud pro model", () => {
    const result = SmartRouter.routeSync("сделай аудит безопасности", []);
    expect(result.model).toContain("deepseek-v4-pro");
  });

  it("routes web search queries to cloud flash model", () => {
    const result = SmartRouter.routeSync("найди цены на iPhone 16", []);
    expect(result.model).toContain("deepseek-v4-flash");
    expect(result.type).toBe("cloud");
  });

  it("routes math tasks to local model (no heavy model)", () => {
    const result = SmartRouter.routeSync("реши математическую задачу с доказательством", []);
    expect(result.type).toBe("local");
  });

  it("routes generic tasks to default local model", () => {
    const result = SmartRouter.routeSync("что такое dependency injection?", []);
    expect(result.model).toBe("ollama/gemma4:latest");
    expect(result.type).toBe("local");
  });

  it("overflows to cloud when tokens exceed 100k", () => {
    // Generate a large dummy prompt that exceeds the 100k token threshold
    const bigPrompt = "word ".repeat(110_000);
    const result = SmartRouter.routeSync(bigPrompt, []);
    expect(result.model).toContain("deepseek-v4-pro");
    expect(result.reason).toMatch(/overflow/i);
  });

  it("returns a valid RouteResult shape for every keyword branch", () => {
    const queries = [
      "привет",
      "refactor my service",
      "найди новости",
      "доказательство теоремы",
      "explain REST APIs",
    ];

    for (const q of queries) {
      const r = SmartRouter.routeSync(q, []);
      expect(r).toHaveProperty("model");
      expect(r).toHaveProperty("type");
      expect(r).toHaveProperty("reason");
      expect(r).toHaveProperty("baseUrl");
      expect(r).toHaveProperty("apiKey");
      expect(["local", "cloud"]).toContain(r.type);
    }
  });
});

describe("SmartRouter.countTokens", () => {
  it("counts tokens for a simple string", () => {
    const n = SmartRouter.countTokens("hello world");
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10);
  });

  it("returns 0 for an empty string", () => {
    expect(SmartRouter.countTokens("")).toBe(0);
  });
});
