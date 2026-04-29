/**
 * helpers/response.ts — Bot response utilities.
 *
 * Handles sending chunked Markdown→HTML messages with fallback to plain text.
 */

import type { Context } from "grammy";
import { mdToHtml, chunkText, cleanResponse } from "./markdown.js";

/**
 * Send text as Markdown→HTML, fallback to plain text on parse failure.
 */
export async function replyHtml(ctx: Context, text: string): Promise<void> {
  try {
    await ctx.reply(mdToHtml(text), { parse_mode: "HTML" });
  } catch {
    await ctx.reply(text);
  }
}

/**
 * Clean and send a response in chunks (Telegram limit: 4096 chars).
 */
export async function sendChunkedResponse(
  ctx: Context,
  raw: string,
): Promise<void> {
  const cleaned = chunkText(raw)
    .map((c) => cleanResponse(c))
    .filter(Boolean);

  for (const chunk of cleaned) {
    await replyHtml(ctx, chunk);
  }
}