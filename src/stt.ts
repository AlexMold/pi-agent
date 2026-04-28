/**
 * STT (Speech-to-Text) client for Whisper.cpp server.
 *
 * Whisper server runs on host (port 8080) with Metal/GPU acceleration.
 * Telegram sends voice as OGG/Opus → ffmpeg converts to WAV → whisper.
 */

import { spawn } from "child_process";

const WHISPER_HOST =
  process.env.WHISPER_HOST || "host.docker.internal:8080";
const WHISPER_LANG = process.env.WHISPER_LANG || ""; // auto-detect by default, set to "ru" to force Russian

/**
 * Convert OGG buffer to WAV buffer using ffmpeg.
 */
function oggToWav(oggBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",    // read from stdin
      "-f", "wav",       // output format
      "-ar", "16000",    // 16kHz sample rate (whisper default)
      "-ac", "1",        // mono
      "-c:a", "pcm_s16le", // 16-bit PCM
      "pipe:1",          // write to stdout
    ], { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {}); // ffmpeg logs to stderr

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);
    ffmpeg.stdin.write(oggBuffer);
    ffmpeg.stdin.end();
  });
}

export async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<string> {
  // Convert OGG → WAV
  const wavBuffer = await oggToWav(audioBuffer);

  // Whisper.cpp expects multipart/form-data with "file" field
  // Pass language=ru for Russian speech recognition
  const form = new FormData();
  form.append("file", new Blob([wavBuffer], { type: "audio/wav" }), "voice.wav");

  // Force language only if explicitly set (auto-detect by default)
  if (WHISPER_LANG) {
    form.append("language", WHISPER_LANG);
  }

  const res = await fetch(`http://${WHISPER_HOST}/inference`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Whisper STT failed: ${res.status} ${errText}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}
