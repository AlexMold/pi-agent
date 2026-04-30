# ── AI Assistant Pro ────────────────────────────────────────────────
# syntax=docker/dockerfile:1
#
# BuildKit cache mounts speed up repeated builds:
#   apt  cache → /var/cache/apt   (survives between builds)
#   npm  cache → /root/.npm       (survives between builds)
#
# Run with: DOCKER_BUILDKIT=1 docker compose build
# BuildKit is the default in Docker ≥ 23.x.

FROM node:24.13.0-slim

WORKDIR /app

# ── System dependencies (rarely changes — cached aggressively) ─────
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      cmake \
      build-essential \
      ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ── npm dependencies (only invalidates when package*.json changes) ──
COPY package*.json tsconfig.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --prefer-offline

# ── Source code (changes most often — placed last) ──────────────────
COPY src/ ./src/

# ── Static config (rarely changes) ──────────────────────────────────
COPY models.json ./

# ── Runtime directories ─────────────────────────────────────────────
RUN mkdir -p /app/workspace /app/memory_db

CMD ["node", "--import", "ts-node/esm", "src/bot.ts"]
