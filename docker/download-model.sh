#!/bin/sh
# Download Qwen 3.5-1B GGUF model for llama.cpp server.
# The Docker container also auto-downloads on first start.
#
# Usage: sh docker/download-model.sh
# Requires: wget

MODEL_DIR="$(dirname "$0")/../models"
MODEL_FILE="qwen3.5-1b-q4_k_m.gguf"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "✅ Model already exists: $MODEL_DIR/$MODEL_FILE"
  exit 0
fi

echo "⬇️  Downloading Qwen 3.5-1B Q4_K_M GGUF (~800 MB)..."
wget -O "$MODEL_DIR/$MODEL_FILE" \
  https://huggingface.co/Qwen/Qwen3.5-1B-GGUF/resolve/main/qwen3.5-1b-q4_k_m.gguf
echo "✅ Done: $MODEL_DIR/$MODEL_FILE"
