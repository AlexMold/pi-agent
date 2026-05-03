#!/bin/bash
# Download Qwen 3.5-1B GGUF model for llama.cpp server.
#
# Usage: bash docker/download-model.sh
# You need at least 800 MB free disk.
#
# The model file will be saved to ./models/ which is mounted
# into the llama-service container.

set -e

MODEL_DIR="$(dirname "$0")/../models"
MODEL_URL="https://huggingface.co/Qwen/Qwen3.5-1B-GGUF/resolve/main/qwen3.5-1b-q4_k_m.gguf"
MODEL_FILE="qwen3.5-1b-q4_k_m.gguf"

mkdir -p "$MODEL_DIR"

if [ -f "$MODEL_DIR/$MODEL_FILE" ]; then
  echo "✅ Model already exists: $MODEL_DIR/$MODEL_FILE"
  exit 0
fi

echo "⬇️  Downloading Qwen 3.5-1B Q4_K_M GGUF (~800 MB)..."
echo "   URL: $MODEL_URL"
echo ""

curl -L "$MODEL_URL" -o "$MODEL_DIR/$MODEL_FILE"

echo ""
echo "✅ Model downloaded: $MODEL_DIR/$MODEL_FILE"
echo "   Size: $(du -h "$MODEL_DIR/$MODEL_FILE" | cut -f1)"
