# TODO

## Status

- **Stage 1** (pi 1.3.0 + persistent per-chat sessions) - done: `b4f3f1d`, `cbb5b65`
- **Stage 2** (memory distillation + session compaction, Sundays 04:00 / `/distill`) - done: `e07d9ee`, `b58f1b5`
- **Stage 3** (decision-model router on Jev/OpenJev) - **declined 2026-10-17**: keeping the qwen2.5:0.5b classifier. OpenJev (27B) does not fit the target hardware (Raspberry Pi 8 GB); no hosted option selected. Plan not active; can be revisited later

## Remaining (outside the stages)

- Deploy to the instance: `npm ci` + rebuild; the instance has local uncommitted edits that conflict with `main` - resolve manually
- usage-tracker records wrong token counts + bring back the `cost` fields in `.pi/agent/models.json`
- `docker/whisper.service`: repo says `large-v3-turbo`, the instance runs `small-q5_1` - decide at deploy time
- `my-origin-develop.patch` in the repo root - delete
