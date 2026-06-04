/**
 * services/message-handler.ts — Incoming message extraction.
 *
 * Handles voice → Whisper STT, photo → save to workspace, text → passthrough.
 * Returns the transcribed/extracted query and optional image path.
 */

import { format } from "date-fns";
import type { Context } from "grammy";
import { transcribeAudio } from "../stt.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { config } from "./config.js";

// ── Security note ─────────────────────────────────────────────────
// Telegram Bot API requires file downloads via:
//   https://api.telegram.org/file/bot<token>/<file_path>
// The token unavoidably appears in the URL. To minimise exposure:
//   - The fetch() call stays inside the Docker container
//   - The URL is NEVER logged (only file_path is logged)
//   - The token value is loaded from .env, not hardcoded

export interface ExtractedMessage {
  query: string;
  imagePath?: string;
}

/**
 * ReplyContext — what we know about the message the user replied to.
 *
 * Returned by extractReplyContext(). Pure data, no I/O performed by the
 * caller (image download is opt-in via REPLY_CONTEXT_DOWNLOAD_IMAGES).
 */
export interface ReplyContext {
  /** Short text version used in the prompt prefix. */
  text: string;
  /** Telegram message type — used for logging and for the LLM to interpret the placeholder. */
  kind:
    | "text"
    | "voice"
    | "photo"
    | "sticker"
    | "video"
    | "document"
    | "animation"
    | "unknown";
  /** "user" for human, "assistant" for the bot's own previous answer. */
  authorRole: "user" | "assistant";
  /** True if the reply target itself is a reply to something else (chain ≥ 2). */
  hasParent: boolean;
  /** Grandparent text, walked one level up. Undefined if no grandparent. */
  parentText?: string;
  /** Local file path if the reply target is an image we re-attached (photo only). */
  imagePath?: string;
}

/** When true, photos in the reply target are downloaded so the LLM can see them. */
export const REPLY_CONTEXT_DOWNLOAD_IMAGES = true;

function placeholderFor(kind: ReplyContext["kind"]): string {
  switch (kind) {
    case "text":      return "";
    case "voice":     return "[voice message]";
    case "photo":     return "[photo]";
    case "sticker":   return "[sticker]";
    case "video":     return "[video]";
    case "document":  return "[document]";
    case "animation": return "[animation]";
    default:          return "[message]";
  }
}

function kindOf(reply: any): ReplyContext["kind"] {
  if (!reply) return "unknown";
  if (reply.text) return "text";
  if (reply.voice) return "voice";
  if (reply.photo) return "photo";
  if (reply.sticker) return "sticker";
  if (reply.video) return "video";
  if (reply.document) return "document";
  if (reply.animation) return "animation";
  return "unknown";
}

/**
 * Inspect ctx.message.reply_to_message and produce a ReplyContext for the LLM
 * prefix. Returns null if there is no reply target or if the target is a
 * service message (join/left/etc.) which carries no useful context.
 */
export async function extractReplyContext(
  ctx: Context,
): Promise<ReplyContext | null> {
  const reply = ctx.message?.reply_to_message as any | undefined;
  if (!reply) return null;

  // Service messages (member joined, pin, etc.) — nothing useful.
  // We deliberately do NOT require `from` to be missing: a Message that has
  // a `from` but no text/caption/media has no useful context either.
  if (!reply.text && !reply.caption && !reply.photo && !reply.voice && !reply.video && !reply.document && !reply.sticker && !reply.animation) {
    return null;
  }

  const kind = kindOf(reply);
  const captionOrText: string = reply.text || reply.caption || "";
  const text = captionOrText || placeholderFor(kind);

  const authorRole: "user" | "assistant" =
    reply.from?.is_bot === true ? "assistant" : "user";

  const parent = reply.reply_to_message as any | undefined;
  const hasParent = Boolean(parent);
  let parentText: string | undefined;
  if (parent) {
    const pKind = kindOf(parent);
    const pText = parent.text || parent.caption || placeholderFor(pKind);
    parentText = pText;
  }

  // Image-aware replies: download the photo so the LLM can actually see it
  let imagePath: string | undefined;
  if (REPLY_CONTEXT_DOWNLOAD_IMAGES && kind === "photo" && Array.isArray(reply.photo) && reply.photo.length > 0) {
    try {
      const photo = reply.photo[reply.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = `reply_${format(new Date(), "yyyyMMddHHmmssSSS")}.jpg`;
      const fullPath = join("/app/workspace", filename);
      await writeFile(fullPath, buf);
      imagePath = filename;
    } catch (err: any) {
      console.error("[ReplyCtx] photo download failed:", err.message);
    }
  }

  return { text, kind, authorRole, hasParent, parentText, imagePath };
}

export async function extractMessage(
  ctx: Context,
): Promise<ExtractedMessage | null> {
  // Voice
  if (ctx.message?.voice) {
    try {
      await ctx.reply("🎤 Распознаю речь...");
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const query = await transcribeAudio(buf);
      await ctx.reply(`📝 ${query}`);
      return { query };
    } catch (err: any) {
      console.error("[STT]", err);
      await ctx.reply("⚠️ Ошибка распознавания голоса");
      return null;
    }
  }

  // Photo
  if (ctx.message?.photo) {
    try {
      await ctx.reply("🖼 Обрабатываю фото...");
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const res = await fetch(url);
      const buf = Buffer.from(await res.arrayBuffer());
      const filename = `photo_${format(new Date(), "yyyyMMddHHmmssSSS")}.jpg`;
      const fullPath = join("/app/workspace", filename);
      await writeFile(fullPath, buf);
      const query = ctx.message.caption || "Опиши это изображение";
      return { query, imagePath: filename };
    } catch (err: any) {
      console.error("[Photo]", err);
      await ctx.reply("⚠️ Ошибка загрузки фото");
      return null;
    }
  }

  // Text
  if (ctx.message?.text) {
    return { query: ctx.message.text };
  }

  return null;
}