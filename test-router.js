/**
 * Test script for Model Router
 */

import { RoutingEngine } from "./lib/model-router.js";
import dotenv from "dotenv";
dotenv.config();

async function testRouter() {
  const engine = new RoutingEngine();
  
  engine.addRoutes([
    {
      id: "accounting",
      name: "Accounting",
      description: "Questions about taxes, invoices, bank transfers, or accounting software.",
      keywords: ["tax", "invoice", "bank", "transfer", "vat"],
      model: "google-antigravity/gemini-3.1-pro-high"
    },
    {
      id: "coding",
      name: "Coding",
      description: "Software development, debugging, or refactoring tasks.",
      keywords: ["code", "debug", "refactor", "function", "javascript"],
      model: "google-antigravity/gemini-3.1-pro-high"
    },
    {
      id: "chitchat",
      name: "Chitchat",
      description: "General conversation, greetings, or casual talk.",
      keywords: ["hi", "hello", "weather"],
      model: "google-antigravity/gemini-3-flash"
    }
  ]);

  const queries = [
    "How do I file my VAT return for March?",
    "Write a function to calculate Fibonacci numbers in JS.",
    "Hello there! How's it going?",
    "Analyze this bank statement for suspicious transactions."
  ];

  for (const query of queries) {
    console.log(`\nQuery: "${query}"`);
    const result = await engine.route(query);
    if (result.winningRoute) {
      console.log(`-> Route: ${result.winningRoute.name} (Model: ${result.winningRoute.model})`);
      console.log(`   Confidence: ${result.confidence}`);
      console.log(`   Reason: ${result.explanation}`);
    } else {
      console.log("-> No route found.");
    }
  }
}

testRouter().catch(console.error);
