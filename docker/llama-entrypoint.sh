#!/bin/sh
# Wrapper: download model if missing, then launch llama-server.
# Requires HF_TOKEN env var for HuggingFace authentication.
# Or pre-download: sh docker/download-model.sh

MODEL="/models/Llama-3.2-1B-Instruct-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"

if [ ! -f "$MODEL" ]; then
  echo "⬇️  Downloading Llama-3.2-1B Q4_K_M GGUF (~800 MB)..."
  AUTH=""
  if [ -n "$HF_TOKEN" ]; then
    AUTH="-H \"Authorization: Bearer $HF_TOKEN\""
  fi
  if curl -L --fail -o "$MODEL" $AUTH "$URL"; then
    echo "✅ Download complete"
  else
    echo "❌ Download failed. Set HF_TOKEN or run: sh docker/download-model.sh"
    echo "   Get token: https://huggingface.co/settings/tokens"
    exit 1
  fi
else
  echo "✅ Model ready"
fi

exec /llama-server "$@"
