---
name: project-pr-review-thread-triage
description: How to distinguish already-resolved vs genuinely outstanding PR review comments — REST API doesn't expose resolution state
metadata:
  type: project
---

**`gh api repos/<owner>/<repo>/pulls/<n>/comments` (REST) does NOT expose whether a review comment thread is resolved.** A stale CodeRabbit/reviewer comment from an earlier commit stays in that endpoint's output forever, indistinguishable from a live, unaddressed one — reading it naively re-litigates already-fixed findings.

**Fix: use the GraphQL `reviewThreads` field**, which has `isResolved` and `isOutdated`:

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: N) {
      reviewThreads(first: 50) {
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 5) { nodes { author { login } body createdAt } }
        }
      }
    }
  }
}'
```

Filter to `isResolved: false` for what actually still needs addressing. `isOutdated: true` alone does NOT mean resolved — a thread can be outdated (the line moved) but still unresolved if nobody marked it fixed.

**How to apply:** before acting on "there are still outstanding comments," run this query first. Don't re-fix findings a prior commit already addressed, and don't miss ones marked outdated-but-unresolved.
