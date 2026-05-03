#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.
# Requires HF_TOKEN for HuggingFace authentication.
# Get token: https://huggingface.co/settings/tokens

MODEL="/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"

if [ ! -f "$MODEL" ]; then
  echo "⬇️  Downloading Llama-3.2-1B Q4_K_M GGUF (~800 MB)..."
  echo "   URL: $URL"
  if [ -z "$HF_TOKEN" ]; then
    echo "❌ HF_TOKEN not set. Add to .env: HF_TOKEN=hf_..."
    echo "   Get token: https://huggingface.co/settings/tokens"
    echo "   Then: docker compose up -d"
    exit 1
  fi
  curl -L --fail -o "$MODEL" -H "Authorization: Bearer $HF_TOKEN" "$URL" || {
    echo "❌ Download failed. Check HF_TOKEN is valid."
    rm -f "$MODEL"
    exit 1
  fi
  # Verify file is reasonable size (> 100 MB = valid GGUF)
  SIZE=$(stat -c%s "$MODEL" 2>/dev/null || stat -f%z "$MODEL" 2>/dev/null)
  if [ "$SIZE" -lt 100000000 ]; then
    echo "❌ Model file too small ($SIZE bytes) — download was partial/error"
    rm -f "$MODEL"
    exit 1
  fi
  echo "✅ Download complete ($(du -h "$MODEL" | cut -f1))"
else
  echo "✅ Model ready ($(du -h "$MODEL" | cut -f1))"
fi

echo "🚀 Starting llama-server..."
exec /llama-server "$@"
