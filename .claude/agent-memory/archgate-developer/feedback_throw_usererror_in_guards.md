---
name: feedback-throw-usererror-in-guards
description: In command actions with a full error boundary, throw UserError instead of manual logError + exitWith(1)
metadata:
  type: feedback
---

In boundary-wrapped command actions, guards should `throw new UserError(...)` rather than `logError` + `exitWith(1)` — ARCH-012's rule still permits the old shape. Apply when editing; don't mass-convert (PR #467).
