---
name: reference-cursor-approval-agent
description: PRs go through an external Cursor.com "Archgate CLI Approver" automation, not implemented anywhere in this repo
metadata:
  type: reference
---

PRs in `archgate/cli` are evaluated by a Cursor Automation called "Archgate CLI Approver" (PR check "Cursor Approval Agent," linked to `cursor.com/automations/<id>`). It's entirely external/hosted — not a GitHub Actions workflow or any file in this repo. It reads [APPROVAL_POLICY.md](../../../APPROVAL_POLICY.md) at the repo root to customize its behavior (bespoke logic in the automation's own prompt, not a Cursor platform feature — confirmed no built-in policy-file mechanism exists).

**Current policy:** a `success` Bugbot check alone is sufficient for approval, even with no review comment — Cursor's docs confirm `success` legitimately means "no issues found," Bugbot doesn't always post a comment. Human review is still required when the check is missing/pending/failed or Bugbot left unresolved comments.

**How to apply:** if a future "Cursor approval failing" report is a different failure mode, don't assume `APPROVAL_POLICY.md` covers it — the automation's policy-reading behavior is self-reported by the automation, not independently verified against its actual prompt. Only the cursor.com account owner can edit the automation's prompt directly if the policy file isn't picked up.
