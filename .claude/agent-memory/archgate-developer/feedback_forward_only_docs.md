---
name: forward-only-docs
description: Repo docs must be forward-only and version-independent — describe current state, never the past or a pinned release version
metadata:
  type: feedback
---

- Docs must not hardcode the release version (`v0.50.0`) or drift-prone counts (`31 ADRs`) — point at `package.json`/`.prototools`/`src/cli.ts`. Nothing enforces this (PR #492).
