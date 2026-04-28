# ── AI Assistant Pro ──────────────────────────────────────────────────
# Base: Node 24 for full ESM + modern features.
# Runs the bot inside Docker; Ollama & Whisper stay on host for Metal/NPU.

FROM node:24.13.0-slim

WORKDIR /app

# Install system dependencies (for LanceDB native bindings)
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy deps first for layer caching
COPY package*.json ./
COPY tsconfig.json ./

RUN npm ci && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY models.json ./

# Create workspace & memory directories
RUN mkdir -p /app/workspace /app/memory_db

# Default: run bot via ts-node (ESM)
CMD ["node", "--loader", "ts-node/esm", "src/bot.ts"]