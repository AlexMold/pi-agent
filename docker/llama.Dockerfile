# ── Llama.cpp Server with auto-download ────────────────────────────
# Extends the official image, adds a startup script that downloads
# the model automatically if it doesn't exist.
#
# syntax=docker/dockerfile:1

FROM ghcr.io/ggml-org/llama.cpp:server

# The official image has llama-server as entrypoint and in PATH.
# We add a small wrapper that downloads the model first.

COPY docker/llama-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Our wrapper calls the original llama-server after download check
ENTRYPOINT ["/entrypoint.sh"]
CMD ["--host", "0.0.0.0", "--port", "8081", "--model", "/models/Qwen3.5-1B-Q4_K_M.gguf", "--ctx-size", "2048", "--threads", "4"]
