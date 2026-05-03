#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.
MODEL="/models/Qwen3.5-1B-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Qwen3.5-1B-GGUF/resolve/main/Qwen3.5-1B-Q4_K_M.gguf"

if [ ! -f "$MODEL" ]; then
  if [ -z "$HF_TOKEN" ]; then
    echo "❌ HF_TOKEN not set. Add to .env: HF_TOKEN=hf_..."
    echo "   Get token: https://huggingface.co/settings/tokens"
    exit 1
  fi
  echo "⬇️  Downloading Qwen 3.5-1B Q4_K_M GGUF (~700 MB)..."
  if ! curl -sSLf -o "$MODEL" -H "Authorization: Bearer $HF_TOKEN" "$URL"; then
    echo "❌ Download failed. Check HF_TOKEN."
    rm -f "$MODEL"
    exit 1
  fi
  SIZE=$(wc -c < "$MODEL")
  if [ "$SIZE" -lt 100000000 ]; then
    echo "❌ File too small ($SIZE bytes)"
    rm -f "$MODEL"
    exit 1
  fi
  echo "✅ Downloaded ($(du -h "$MODEL" | cut -f1))"
else
  echo "✅ Model ready ($(du -h "$MODEL" | cut -f1))"
fi

# Find llama-server binary — try common paths, then search
LLAMA=""
for p in /llama-server /usr/local/bin/llama-server /usr/bin/llama-server /app/llama-server /app/llama.cpp/build/bin/llama-server; do
  if [ -x "$p" ]; then LLAMA="$p"; break; fi
done
if [ -z "$LLAMA" ]; then
  echo "🔍 Searching for llama-server..."
  LLAMA=$(find / -name llama-server -type f 2>/dev/null | head -1)
fi
if [ -z "$LLAMA" ]; then
  echo "❌ llama-server not found. Listing /:"
  ls -la /
  exit 1
fi

echo "🚀 Starting: $LLAMA $@"
exec "$LLAMA" "$@"
