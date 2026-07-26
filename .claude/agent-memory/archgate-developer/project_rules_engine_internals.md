---
name: project-rules-engine-internals
description: Open follow-up work in the ADR rules engine that no rule or test tracks
metadata:
  type: project
---

- Rules-file load is still re-parsed per invocation — `runner.ts`'s per-run caches do NOT cover it; deferred, see #345.
