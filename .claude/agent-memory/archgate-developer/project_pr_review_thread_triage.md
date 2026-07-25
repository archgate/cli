---
name: project-pr-review-thread-triage
description: Find genuinely outstanding PR review comments — the REST API does not expose thread resolution state, only GraphQL does
metadata:
  type: project
---

The REST API does not report whether a review thread is resolved, so `gh pr view --json comments` lists finished threads as if they were open. Use the GraphQL `reviewThreads` field and filter on `isResolved`:

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
