#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.

MODEL="/models/qwen3.5-1b-q4_k_m.gguf"
URL="https://huggingface.co/Qwen/Qwen3.5-1B-GGUF/resolve/main/Qwen3.5-1B-Q4_K_M.gguf"

if [ ! -f "$MODEL" ]; then
  echo "⬇️  Downloading Qwen 3.5-1B Q4_K_M GGUF (~800 MB)..."
  curl -L --fail -o "$MODEL" "$URL" || {
    echo "❌ Download failed. Try manually: sh docker/download-model.sh"
    exit 1
  }
  echo "✅ Download complete"
else
  echo "✅ Model ready"
fi

exec /llama-server "$@"
