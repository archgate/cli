---
name: project-pr-review-thread-triage
description: Find genuinely outstanding PR review comments — the REST API does not expose thread resolution state, only GraphQL does
metadata:
  type: project
---

The REST API does not report whether a review thread is resolved, so `gh pr view --json comments` lists finished threads as if they were open. Only GraphQL exposes `isResolved`.

Two traps in the query itself: `reviewThreads` is a paginated connection, and selecting `isResolved` does not filter by it. A busy PR exceeds one page — this repo has had a PR with 54 threads — so page until `hasNextPage` is false and filter client-side.

```bash
gh api graphql --paginate \
  -f query='
query($endCursor: String) {
  repository(owner: "archgate", name: "cli") {
    pullRequest(number: N) {
      reviewThreads(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { author { login } body } }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | "\(.path):\(.line)"'
```
