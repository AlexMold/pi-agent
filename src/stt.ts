/**
 * STT (Speech-to-Text) client for Whisper.cpp.
 *
 * The Whisper server runs on the host (port 8080) for GPU/NPU access.
 * This client is called from within Docker via host.docker.internal.
 */

const WHISPER_HOST =
  process.env.WHISPER_HOST || "host.docker.internal:8080";

export async function transcribeAudio(
  audioBuffer: Buffer,
): Promise<string> {
  const res = await fetch(`http://${WHISPER_HOST}/inference`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audioBuffer,
  });

  if (!res.ok) {
    throw new Error(`Whisper STT failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}