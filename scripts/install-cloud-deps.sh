#!/bin/bash
# Installs dependencies in Claude Code cloud sessions only. Runs as a
# SessionStart hook because Bun's cloud setup-script fetches hit known
# proxy compatibility issues; https://code.claude.com/docs/en/claude-code-on-the-web
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi

bun install
exit 0
