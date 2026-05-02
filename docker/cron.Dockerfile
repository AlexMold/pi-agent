# ── Cron Worker (reminders) ──────────────────────────────────────────
# Minimal container: only reads reminders.json and sends Telegram messages.
# No Pi, LanceDB, cmake, ffmpeg — ~60 MB unpacked.
#
# syntax=docker/dockerfile:1

FROM node:24-alpine

WORKDIR /app

# Only copy what's needed for grammy + the worker script
COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --prefer-offline && \
    npm cache clean --force

COPY src/services/cron-worker.js ./

CMD ["node", "cron-worker.js"]
