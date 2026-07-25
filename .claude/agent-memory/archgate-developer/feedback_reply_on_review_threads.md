---
name: reply-on-review-threads
description: Answer every review finding on its own thread — especially declined ones; a summary PR comment does not close the loop
metadata:
  type: feedback
---

Answer every PR review finding on its own thread, not just in a summary comment. Declined → give the reason there (out of scope / came from main / conflicts with an ADR). Accepted → name the fixing commit SHA. A summary comment is optional on top, never a substitute. Applies to bot reviewers too — CodeRabbit re-reviews per thread.
