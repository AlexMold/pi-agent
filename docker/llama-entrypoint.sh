#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.

MODEL="/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"

if [ ! -f "$MODEL" ]; then
  if [ -z "$HF_TOKEN" ]; then
    echo "❌ HF_TOKEN not set."
    echo "   Add to .env: HF_TOKEN=hf_..."
    echo "   Get token: https://huggingface.co/settings/tokens"
    exit 1
  fi

  echo "⬇️  Downloading Llama-3.2-1B Q4_K_M GGUF (~800 MB)..."
  if ! curl -L --fail -o "$MODEL" -H "Authorization: Bearer $HF_TOKEN" "$URL"; then
    echo "❌ Download failed. Check HF_TOKEN."
    rm -f "$MODEL"
    exit 1
  fi

  # Check the file is a real GGUF (> 100 MB)
  SIZE=$(wc -c < "$MODEL")
  if [ "$SIZE" -lt 100000000 ]; then
    echo "❌ File too small ($SIZE bytes) — not a valid GGUF"
    rm -f "$MODEL"
    exit 1
  fi

  echo "✅ Download OK ($(du -h "$MODEL" | cut -f1))"
else
  echo "✅ Model ready ($(du -h "$MODEL" | cut -f1))"
fi

echo "🚀 Starting llama-server..."
exec /llama-server "$@"
