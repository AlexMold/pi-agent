/**
 * services/message-handler.ts — Incoming message extraction.
 *
 * Handles voice → Whisper STT, photo → save to workspace, text → passthrough.
 * Returns the transcribed/extracted query and optional image path.
 */

import type { Context } from "grammy";
import { transcribeAudio } from "../stt.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { config } from "./config.js";

export interface ExtractedMessage {
  query: string;
  imagePath?: string;
}

/**
 * Extract query text from any supported message type (text, voice, photo).
 * Sends status messages to the user during extraction.
 */
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
      const filename = `photo_${Date.now()}.jpg`;
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