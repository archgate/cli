// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * `SessionStart` hook: installs dependencies in Claude Code cloud sessions.
 *
 * Cloud sessions install here rather than from the environment's own setup
 * script because Bun's fetches from that phase hit known proxy compatibility
 * issues; https://code.claude.com/docs/en/claude-code-on-the-web
 *
 * Local sessions exit immediately, so this is a no-op on every other surface.
 */
if (Bun.env.CLAUDE_CODE_REMOTE !== "true") {
  process.exit(0);
}

const result = Bun.spawnSync({
  cmd: ["bun", "install"],
  cwd: Bun.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
  stdout: "pipe",
  stderr: "pipe",
});
if (result.stdout.length > 0) process.stderr.write(result.stdout);
if (result.stderr.length > 0) process.stderr.write(result.stderr);
