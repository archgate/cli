# PR Approval Policy

This file is read by the **Cursor Approval Agent ("Archgate CLI Approver")** automation that evaluates pull requests in this repository. It exists to resolve one specific ambiguity in that automation's default behavior; everything not covered here falls back to the automation's own judgment.

## Bugbot signal: a passing check with no comment is a valid, complete signal

Per [Cursor's own Bugbot documentation](https://cursor.com/docs/bugbot), the `success` conclusion on the "Cursor Bugbot" check means:

> Bugbot found no issues, and there are no unresolved Bugbot comments from earlier runs.

In other words, **Bugbot does not always post a PR review comment.** When it finds nothing to flag, it completes with a `success` check and posts no comment at all — that is the documented, expected happy path, not a sign that the review didn't run or that its output is unverified.

**Do:**

- Treat the "Cursor Bugbot" check's own conclusion (`success` / `failure` / etc.) as authoritative on its own.
- Treat `success` with zero new review comments as equivalent to "no issues found" — this alone is sufficient to approve, it does not require also finding a `cursor[bot]` comment containing a `<!-- BUGBOT_REVIEW -->` marker or any other comment-based confirmation.

**Don't:**

- Don't block approval solely because no Bugbot review comment appeared, if the Bugbot check itself reports `success`.
- Don't poll for a comment as a liveness check for Bugbot — use the check's status/conclusion instead.

## When to still hold back for human review

This policy narrows one specific false-negative case. All other conservative defaults still apply — continue requiring human review when:

- The "Cursor Bugbot" check is missing, pending, `failure`, `error`, or otherwise not `success`.
- Bugbot posted one or more unresolved review comments on the PR.
- Any other required status check (lint, test, typecheck, build, etc.) has not passed.
- Anything else about the PR looks ambiguous or out of scope for automated approval — when in doubt, leave a non-blocking comment rather than approve.

## Scope

This policy covers only the Bugbot-signal-detection step of the approval decision. It does not change reviewer assignment, CODEOWNERS behavior, or any other part of the approval workflow.
