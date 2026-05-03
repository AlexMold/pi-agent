#!/bin/sh
# Download Qwen 3.5-1B GGUF model for llama.cpp server.
# Requires HF_TOKEN for HuggingFace authentication.
# Get token at: https://huggingface.co/settings/tokens
#
# Usage: HF_TOKEN=hf_xxx sh docker/download-model.sh

MODEL_DIR="$(dirname "$0")/../models"
MODEL_FILE="Llama-3.2-1B-Instruct-Q4_K_M.gguf"
URL="https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "✅ Model already exists"
  exit 0
fi

echo "⬇️  Downloading Llama 3.2-1B Q4_K_M GGUF (~785 MB)..."

if [ -z "$HF_TOKEN" ]; then
  echo "❌ HF_TOKEN not set"
  exit 1
fi

curl -sSLf -o "$MODEL_DIR/$MODEL_FILE" -H "Authorization: Bearer $HF_TOKEN" "$URL"
echo "✅ Done: $MODEL_DIR/$MODEL_FILE"
