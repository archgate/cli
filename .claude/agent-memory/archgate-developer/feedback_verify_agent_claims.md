---
name: verify-agent-claims
description: Review agents misquote ADRs, invent supporting detail, and judge non-English prose they cannot read — verify every claim mechanically before acting
metadata:
  type: feedback
---

**Verify a review agent's claim before acting on it.**

**Why:** they misquote both ADRs and the files they have just read, and they fabricate the detail that supports a verdict. Acting on an unverified finding means changing correct code to satisfy a rule that was never written.

**How to apply:** `grep` the exact quoted string first. A governance finding citing no ADR cannot block on governance grounds — but a demonstrated defect blocks on its own merits, regardless of how it was described.

Four failure modes worth testing for by hand:

1. **Misquoting an ADR** — check that the quoted line exists verbatim.
2. **Asserting an ADR does not exist when it does** — `ls .archgate/adrs/<id>*`.
3. **Quoting accurately but applying a stricter rule than the quote supports** — file-level page parity read as section-level parity. Check that the quoted line actually entails the finding.
4. **Flagging a condition already present on the base ref** — confirm the change introduced it.

**A review agent's verdict on non-English prose is worthless**, and it invents the detail that supports it: an orthography pass over the pt-br docs returned PASS while asserting accents the words do not contain (`depreciadas` "(á)", `governança` "(ã)"). Grep cannot settle a claim about meaning, so verify mechanically instead — does the stripped form still occur, did fenced code blocks change — and leave the language judgement to a human speaker.

**Reproduce a described failure before scheduling work from it**, including when your own scan reports zero. Of three issues one audit derived from memory files, two collapsed to nothing once the failure was actually tested (#517 Go proxy, #518 branch protection); the third was real but larger than described (#516).

And prove a zero is a real zero: `\b` inside a JS template literal is a backspace, not a word boundary, so a regex built that way found no corruption where 69 occurrences sat.

See also [[verify-agents-run-typecheck]].
