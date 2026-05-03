#!/bin/sh
# Download Llama-3.2-1B GGUF model for llama.cpp server.
# Requires HF_TOKEN for HuggingFace authentication.
# Get token at: https://huggingface.co/settings/tokens
#
# Usage: HF_TOKEN=hf_xxx sh docker/download-model.sh

MODEL_DIR="$(dirname "$0")/../models"
MODEL_FILE="Llama-3.2-1B-Instruct-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "✅ Model already exists: $MODEL_DIR/$MODEL_FILE"
  exit 0
fi

echo "⬇️  Downloading Llama-3.2-1B Q4_K_M GGUF (~800 MB)..."

CURL_ARGS="-L -o $MODEL_DIR/$MODEL_FILE"
if [ -n "$HF_TOKEN" ]; then
  CURL_ARGS="$CURL_ARGS -H \"Authorization: Bearer $HF_TOKEN\""
fi

if curl $CURL_ARGS "$URL"; then
  echo "✅ Done: $MODEL_DIR/$MODEL_FILE"
else
  echo "❌ Failed. Set HF_TOKEN env var."
  exit 1
fi
