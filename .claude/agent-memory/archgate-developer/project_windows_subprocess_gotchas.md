---
name: project-windows-subprocess-gotchas
description: Windows-specific subprocess, path, and env-capture gotchas outside the test suite
metadata:
  type: project
---

- **Git Bash `/tmp` is invisible to Windows-native tools.** A bash redirect to `/tmp/x` writes into Git Bash's virtual mount; Windows-native python/node then get `FileNotFoundError` on that path. Use a repo-relative path or `$TMPDIR` when piping files between bash and Windows-native tools.
- **YAML double-quoted strings need escaped backslashes for Windows paths.** `cwd: "E:\project"` silently corrupts (`\p` isn't a valid escape). Use `JSON.stringify(path)` to produce correctly escaped YAML (JSON and YAML double-quoted escaping match). Hit in Copilot CLI session-context tests (`workspace.yaml`).
- **Windows binary upgrade: never use detached child processes for `.old` cleanup.** `replaceBinary()` renames the locked running exe to `.old`; a detached `cmd /c ping ... & del` cleanup is unreliable (spawn/timing races). `cleanupStaleBinary()` instead does a fire-and-forget `unlink()` at next CLI startup, when the file is guaranteed unlocked. Platform-agnostic via `getArtifactInfo()`. Do not reintroduce detached cleanup processes.
- **Module-level `{ ...Bun.env }` captures env at import time.** Spreading into a module constant freezes the snapshot; test-time `Bun.env.HOME` overrides won't affect it. Use a function returning `{ ...Bun.env, ... }` per call instead. Applied in `src/helpers/credential-store.ts`.
