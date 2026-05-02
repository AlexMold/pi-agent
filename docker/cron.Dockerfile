# ── Cron Worker (reminders) ──────────────────────────────────────────
# Minimal container: only reads reminders.json and sends Telegram messages.
# No Pi, LanceDB, cmake, ffmpeg — ~60 MB unpacked.
#
# syntax=docker/dockerfile:1

FROM node:24-alpine

WORKDIR /app

# Minimal deps — just grammy
COPY docker/package-cron.json package.json

RUN --mount=type=cache,target=/root/.npm \
    npm install --prefer-offline && \
    npm cache clean --force

COPY src/services/cron-worker.js ./

CMD ["node", "cron-worker.js"]
