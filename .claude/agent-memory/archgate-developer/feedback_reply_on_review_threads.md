---
name: reply-on-review-threads
description: Answer every review finding on its own thread — especially declined ones; a summary PR comment does not close the loop
metadata:
  type: feedback
---

Reply to each PR review finding **on its own thread**, not only in a summary PR comment. Declined findings especially: the reviewer (human or bot) must see the reasoning attached to the code line they raised.

**Why:** User feedback 2026-07-25 on PR #496: I addressed 14 CodeRabbit threads with one consolidated PR comment that explained three declines. The user flagged it as recurring — "the ones you declined you must answer at each thread. not the first time this is happening." An unanswered thread stays open and reads as ignored; the reviewer cannot resolve it, and a summary comment is not linked to the line.

**How to apply:**

- Find unresolved threads with the GraphQL `reviewThreads.isResolved` query (see [[project-pr-review-thread-triage]]) — REST does not expose resolved state.
- Reply per thread: `gh api repos/<owner>/<repo>/pulls/<n>/comments/<first_comment_databaseId>/replies -f body='...'` (the reply targets the thread's FIRST comment id).
- Declined → state the reason on the thread (out of scope / came from main / conflicts with an ADR). Accepted → state the fixing commit SHA. A summary comment is optional on top, never a substitute.
- Applies to bot reviewers too — CodeRabbit re-reviews per thread.
