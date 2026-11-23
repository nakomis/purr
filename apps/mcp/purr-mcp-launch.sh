#!/usr/bin/env bash
# Reads Claude's Purr API key from the macOS login keychain and launches the MCP.
# Keychain entry required (the key itself lives in SSM /purr/prod/api-keys/claude):
#   security add-generic-password -U -s purr -a claude-api-key -w "$(aws ssm get-parameter \
#     --name /purr/prod/api-keys/claude --with-decryption --query Parameter.Value --output text)"
set -euo pipefail

export PURR_URL="${PURR_URL:-https://purr.nakomis.com}"
export PURR_API_KEY=$(security find-generic-password -s purr -a claude-api-key -w)

exec pnpm --silent --dir "$(dirname "$0")" start
