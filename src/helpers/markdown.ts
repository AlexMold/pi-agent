/**
 * helpers/markdown.ts — Markdown to Telegram HTML conversion.
 */

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ breaks: true, linkify: true });

/**
 * Converts Markdown to Telegram-safe HTML.
 * Strips any HTML tags not supported by Telegram's parse_mode.
 */
export function mdToHtml(text: string): string {
  return md
    .render(text)
    .replace(/<(?!\/?(?:b|i|u|s|code|pre|a|tg-emoji|br)\b)[^>]*>/gi, "");
}

/**
 * Clean raw filesystem paths and other noise from agent output.
 */
export function cleanResponse(text: string): string {
  return text
    .replace(
      /\/var\/folders\/[\w/.\- ]+\.(png|jpg|jpeg|gif|webp|pdf|txt|md|js|ts|json|html|css)/gi,
      "[file]",
    )
    .replace(/\/var\/folders\/[^\s,.!?]+/g, "[path]")
    .replace(/\/tmp\/[^\s,.!?]+/g, "[tmp]");
}

/**
 * Split long text into Telegram-friendly chunks (max 4096 chars).
 */
export function chunkText(text: string, maxLen = 4000): string[] {
  return text.match(new RegExp(`[^]{1,${maxLen}}`, "g")) || [text];
}