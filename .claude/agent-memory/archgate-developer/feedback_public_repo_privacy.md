---
name: feedback-public-repo-privacy
description: This repo is PUBLIC — never commit private sibling-repo internals into agent memory, PR bodies, or PR comments here
metadata:
  type: feedback
---

Never put internals of private sibling repos (repo-relative paths, build-script names, service/backend structure, private PR numbers/links) into anything committed or posted to this repo: agent-memory files, MEMORY.md, PR bodies, PR comments, commit messages. This repo is public; the sibling plugins repo is private.

**Why:** On 2026-07-02 the user flagged that agent-memory files describing the private sibling repo's build pipeline had been pushed to public PRs — they had to be scrubbed from the branch, the closed PR's branch deleted, and the PR body/comments edited. GitHub retains closed-PR diffs, so leaked content is hard to fully purge after the fact.

**How to apply:** Before committing memory or posting PR text here, check for private-repo references. The private repo's _existence_ and the distributed plugin's _user-facing behavior_ (installed skill paths like `~/.config/opencode/skills/`, CLI flags the skills invoke) are public knowledge and fine to mention; its internal structure is not. Detailed sibling-repo knowledge belongs in that repo's own agent memory. When work spans both repos, split the capture: public-safe summary here, full detail there.
