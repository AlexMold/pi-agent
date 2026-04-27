#!/bin/bash
#
# wiki-cron.sh — Scheduled maintenance for the Wiki system
#
# Add to crontab:
#   */30 * * * * /path/to/script/run-wiki-cron.sh
#
# Every 30 minutes: summarizes closed sessions, extracts entities, prunes.

set -e
cd "$(dirname "$0")/.."
exec node wiki/maintenance.js >> wiki/messages/maintenance.log 2>&1
