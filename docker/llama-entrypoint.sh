#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.
# Uses the original llama-server binary from the base image.

MODEL="/models/qwen3.5-1b-q4_k_m.gguf"
URL="https://huggingface.co/Qwen/Qwen3.5-1B-GGUF/resolve/main/qwen3.5-1b-q4_k_m.gguf"

if [ ! -f "$MODEL" ]; then
  echo "⬇️  Downloading Qwen 3.5-1B Q4_K_M GGUF (~800 MB)..."
  curl -L -o "$MODEL" "$URL"
  echo "✅ Download complete"
else
  echo "✅ Model ready"
fi

exec llama-server "$@"
