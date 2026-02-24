# Archgate Launch Plan: CLI + Claude Code Plugin

## Current State (Feb 2026)

**CLI:** v0.2.5, feature-complete through Phase 2.5. Binary distribution via npm platform packages works. Self-governed by 6 ADRs with executable rules. Full validation pipeline (`bun run validate`) passing.

**Plugin:** Lives in `archgate/claude-code-plugin` (repo complete). Distribution service live at `plugins.archgate.dev` (Bun + Hono virtual git server with token-based access on Railway).

**What exists:**

- CLI: init, check, adr (create/list/show/update), mcp, upgrade, clean
- MCP server: check, list_adrs, review_context, session_context tools
- Plugin: architect, quality-manager, adr-author skills + developer agent
- Plugin distribution service: `plugins.archgate.dev` with token auth, admin API, Redis KV
- CI: PR validation, automated releases, binary compilation
- npm: `archgate` package + platform-specific binary packages

**What doesn't exist yet:**

- Install script (archgate.dev/install)
- Homebrew tap
- Starter ADR packs
- Documentation site
- Landing page (archgate.dev)
- Beta signup flow (frontend — backend token API exists)
- Any public announcement or marketing

---

## Launch Strategy: Three Waves

The launch is split into three waves, each expanding the audience and distribution surface. Each wave has a clear gate — don't advance until the gate criteria are met.

```
Wave 1: Private Alpha          Wave 2: Closed Beta           Wave 3: Public Launch
(internal + friendlies)        (invited users)               (open to all)

CLI binary via npm             + Install script              + Homebrew tap
Plugin via token service       + Beta signup flow            + Plugin marketplace (GA)
README + CONTRIBUTING          + Documentation site          + Starter ADR packs
No marketing                   + Blog post / dev.to          + HN / X / conference talks
```

---

## Wave 1: Private Alpha

**Audience:** Internal team, 5-10 trusted developers/teams who will provide candid feedback.

**Goal:** Validate that the full loop works end-to-end: install CLI, init project, write ADRs, run checks, use plugin with Claude Code, get value from governed AI development.

### Pre-Alpha Checklist

| #   | Task                                                                           | Status | Owner |
| --- | ------------------------------------------------------------------------------ | ------ | ----- |
| 1   | CLI `bun run validate` passes                                                  | Done   | —     |
| 2   | Binary installs cleanly via `npm install -g archgate` on macOS ARM + Linux x64 | Done   | —     |
| 3   | `archgate init` → `archgate check` works on a fresh project                    | Done   | —     |
| 4   | MCP server starts and tools respond correctly                                  | Done   | —     |
| 5   | Plugin installs via `plugins.archgate.dev` and skills work                     | Verify | —     |
| 6   | README covers install + quickstart + rule authoring                            | Done   | —     |
| 7   | CONTRIBUTING.md is accurate                                                    | Done   | —     |
| 8   | `archgate upgrade` works (fetches latest from npm)                             | Done   | —     |

### Alpha Actions

- [ ] **A1. Smoke test the full loop** on 2-3 real codebases (not just archgate itself)
  - TypeScript project (closest to dogfood)
  - A project with an existing `.cursorrules` or `CLAUDE.md` (migration story)
  - A monorepo (test scoping behavior)

- [ ] **A2. Plugin install test** — Install the plugin via `plugins.archgate.dev` token service end-to-end. Verify: marketplace add, plugin install, MCP connection, all skills respond correctly.

- [ ] **A3. Collect friction points** — What's confusing? What breaks? What's missing from docs? What do users try that doesn't work? Track as GitHub issues.

- [ ] **A4. Fix critical issues** — Address anything that blocks the core loop (install → init → author → check → review).

- [ ] **A5. Write 1-2 example ADR packs** — Not published packages yet, just example directories in a demo repo showing how a team would govern a TypeScript API project or a React frontend.

### Alpha Gate

Advance to Wave 2 when:

- 3+ external users have completed the full loop without hand-holding
- No critical bugs blocking the core workflow
- Install → first check takes < 5 minutes for a new user
- Plugin works reliably with Claude Code

---

## Wave 2: Closed Beta

**Audience:** 50-100 invited developers/teams. Mix of early adopters, DevRel contacts, and enterprise prospects.

**Goal:** Validate adoption at scale. Can users self-serve? Do the docs answer their questions? What ADR packs do people need?

### Beta Infrastructure

| #   | Task                        | Description                                                                                                                  | Status   |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| B1  | Plugin distribution service | `plugins.archgate.dev` — Bun+Hono virtual git server on Railway with Redis token store                                       | **Done** |
| B2  | Install script              | `curl -fsSL https://archgate.dev/install \| sh` — alternative to npm for teams that don't want Node                          | Todo     |
| B3  | Landing page                | `archgate.dev` — one-page site with value prop, install command, link to docs, beta signup                                   | Todo     |
| B4  | Documentation site          | Hosted docs covering: quickstart, ADR authoring guide, rule API reference, CI integration, plugin setup                      | Todo     |
| B5  | Beta signup flow            | Form at `archgate.dev/beta` → admin approval → token generation → email with install instructions (backend token API exists) | Todo     |
| B6  | Feedback channel            | GitHub Discussions or Discord for beta users                                                                                 | Todo     |

### Beta Documentation (B4 Detail)

The documentation site is the single highest-leverage investment for Wave 2. Without it, every user question becomes a support burden.

**Required pages:**

1. **Getting Started (5-min quickstart)**
   - Install CLI (`npm install -g archgate`)
   - `archgate init` in your project
   - Edit the sample ADR
   - Add a `.rules.ts` rule
   - Run `archgate check`
   - See a violation → fix it → pass

2. **ADR Authoring Guide**
   - Frontmatter format (id, title, domain, rules, files)
   - Markdown body sections (Context, Decision, Do's/Don'ts, Consequences, Compliance, References)
   - What makes a good ADR (actionable, specific, testable)
   - Examples: naming convention ADR, API design ADR, testing standard ADR

3. **Rule API Reference**
   - `defineRules()` function signature
   - `RuleContext` API: `glob()`, `grep()`, `grepFiles()`, `readFile()`, `readJSON()`, `report.violation/warning/info()`, `scopedFiles`, `changedFiles`, `projectRoot`, `config`
   - Error handling and timeouts
   - Example rules for common patterns

4. **CI Integration Guide**
   - GitHub Actions setup (workflow YAML)
   - GitLab CI setup
   - Pre-commit hook setup (`archgate check --staged`)
   - `--ci` flag for annotations
   - `--json` flag for custom integrations

5. **Claude Code Plugin Guide**
   - Install plugin (marketplace add + install)
   - Available skills: `@architect`, `@quality-manager`, `@adr-author`
   - Developer agent workflow (UNDERSTAND → PLAN → WRITE → VALIDATE → CAPTURE)
   - MCP tools and when they're used
   - Configuring MCP server connection

6. **Migration Guide**
   - From `.cursorrules` to Archgate ADRs
   - From `CLAUDE.md` conventions to enforceable ADRs
   - From ESLint-only to ESLint + architectural governance

### Beta Marketing

- [ ] **Blog post** — "Governing AI-Generated Code with Architecture Decision Records" — publish on dev.to, Hashnode, personal blog
- [ ] **Demo video** — 3-5 minute screencast showing the full loop: init → write ADR → AI generates code → check catches violation → fix → pass
- [ ] **Social posts** — Announce beta on X/Twitter, LinkedIn, relevant Discord servers (Claude Code community, TypeScript community)

### Beta Gate

Advance to Wave 3 when:

- 20+ beta users are actively using archgate on real projects
- Plugin distribution service handles 50+ installs without issues
- Documentation answers 80% of user questions (measure by support volume decrease over time)
- At least 2 users have contributed feedback that resulted in improvements
- No data loss or security issues with the token service

---

## Wave 3: Public Launch

**Audience:** General public. Anyone who uses AI coding tools and cares about code quality.

**Goal:** Drive adoption. Establish archgate as the standard for AI governance. Build the ecosystem flywheel.

### GA Infrastructure

| #   | Task                    | Description                                                                                 | Depends On            |
| --- | ----------------------- | ------------------------------------------------------------------------------------------- | --------------------- |
| G1  | Homebrew tap            | `brew install archgate/tap/archgate` — auto-updated on release                              | Binary build pipeline |
| G2  | Starter ADR packs (npm) | `@archgate/pack-typescript`, `@archgate/pack-testing`, `@archgate/pack-api-design`          | Pack infrastructure   |
| G3  | Plugin GA distribution  | Move from token-gated beta to public availability (official marketplace or public git repo) | Beta validation       |
| G4  | `archgate pack search`  | Search available packs from npm registry                                                    | —                     |

### GA Marketing

- [ ] **Hacker News** — "Show HN: Archgate — Executable ADRs for governing AI-generated code"
- [ ] **Product Hunt** — Launch with demo video and quickstart
- [ ] **Conference talks** — Submit to TypeScript Conf, Node Congress, AI Engineer Summit
- [ ] **Integration guides** — Partner content with Claude Code, Cursor, Copilot communities
- [ ] **Case studies** — Write up 2-3 beta user success stories with metrics (violations caught, review time saved, onboarding speed)

---

## Distribution Channel Summary

| Channel                                          | Wave 1 | Wave 2 | Wave 3 |
| ------------------------------------------------ | ------ | ------ | ------ |
| npm (`npm install -g archgate`)                  | Yes    | Yes    | Yes    |
| Install script (`archgate.dev/install`)          | No     | Yes    | Yes    |
| Homebrew (`brew install archgate/tap/archgate`)  | No     | No     | Yes    |
| Plugin (token service at `plugins.archgate.dev`) | Yes    | Yes    | Yes    |
| Plugin (public/marketplace)                      | No     | No     | Yes    |

---

## Risk Register

| Risk                                                             | Impact | Likelihood | Mitigation                                                                                                                                                   |
| ---------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Binary size (~55-60MB) deters adoption                           | Medium | Medium     | Document why (embedded Bun runtime). Compare to Deno (60-80MB). Install script makes it invisible.                                                           |
| Claude Code plugin API changes break plugin                      | High   | Medium     | Pin to stable plugin API. Monitor Claude Code changelog. Keep plugin minimal (markdown skills + MCP config).                                                 |
| Users expect archgate to work with Cursor/Copilot out of the box | Medium | High       | MCP server works with any MCP client. Document MCP setup for other tools. Position Claude Code plugin as the reference integration.                          |
| ADR format perceived as too heavyweight                          | High   | Medium     | Provide `archgate init` templates that are minimal. Show that a useful ADR can be 10 lines of frontmatter + 3 rules.                                         |
| npm platform package install fails on some systems               | Medium | Low        | Install script as fallback. Document manual binary download. `archgate upgrade` as self-healing path.                                                        |
| Plugin distribution service downtime                             | Low    | Medium     | Service is stateless (embedded files). Railway auto-restarts. Pre-computed responses at startup. Already deployed — monitor uptime.                          |
| No traction — people don't see the value                         | High   | Medium     | Focus Wave 1 on getting 3 strong testimonials. Demo video showing real violations caught. Quantify: "X violations caught in CI that would have been merged." |

---

## Success Metrics

### Wave 1 (Alpha)

| Metric                           | Target      |
| -------------------------------- | ----------- |
| Users completing full loop       | 3+          |
| Critical bugs found              | 0 remaining |
| Time from install to first check | < 5 minutes |

### Wave 2 (Beta)

| Metric                                                    | Target |
| --------------------------------------------------------- | ------ |
| Beta signups                                              | 100+   |
| Active weekly users (ran `archgate check` in last 7 days) | 20+    |
| Plugin installs                                           | 50+    |
| GitHub stars                                              | 100+   |
| Documentation pages with > 100 views                      | 5+     |
| User-reported issues resolved                             | 80%+   |

### Wave 3 (GA)

| Metric                        | Target |
| ----------------------------- | ------ |
| npm weekly downloads          | 500+   |
| GitHub stars                  | 500+   |
| Community ADR packs published | 3+     |
| Teams using in CI             | 20+    |
| Paying enterprise leads       | 3+     |

---

## Sequenced Task List

This is the ordered backlog. Tasks within a wave can be parallelized where dependencies allow.

### Wave 1 Tasks

1. **W1-01:** Smoke test CLI on 3 real codebases (TS project, project with .cursorrules, monorepo)
2. **W1-02:** Smoke test plugin install via `plugins.archgate.dev` token service end-to-end
3. **W1-03:** Collect and triage friction points from alpha testers
4. **W1-04:** Fix critical issues blocking the core loop
5. **W1-05:** Create 1-2 example ADR sets for demo repos (TypeScript API, React frontend)
6. **W1-06:** Polish README with real-world examples and clearer value prop

### Wave 2 Tasks

7. **W2-01:** Build install script (`archgate.dev/install`)
8. **W2-02:** Build landing page (`archgate.dev`)
9. **W2-03:** Build documentation site (6 pages — see Beta Documentation section)
10. **W2-04:** Build beta signup frontend (form → approval → token → email; backend token API exists)
11. **W2-05:** Set up feedback channel (GitHub Discussions)
12. **W2-06:** Write launch blog post
13. **W2-07:** Record demo video (3-5 min)
14. **W2-08:** Announce beta on social channels
15. **W2-09:** Monitor beta, iterate on feedback

### Wave 3 Tasks

16. **W3-01:** Create Homebrew tap (`archgate/homebrew-tap`) with auto-update CI
17. **W3-02:** Publish starter ADR packs to npm (`@archgate/pack-typescript`, `@archgate/pack-testing`, `@archgate/pack-api-design`)
18. **W3-03:** Transition plugin from closed beta to public availability
19. **W3-04:** Implement `archgate pack search`
20. **W3-05:** Submit Hacker News Show HN
21. **W3-06:** Launch on Product Hunt
22. **W3-07:** Write case studies from beta users
23. **W3-08:** Submit conference talk proposals

---

## Open Decisions

These need to be resolved before or during execution. They are listed here to prompt discussion.

1. **Documentation site tooling** — Starlight (Astro), VitePress, Docusaurus, or Mintlify? Recommendation: VitePress for simplicity and Markdown-native authoring.

2. **Landing page hosting** — Same repo (static site in `/www`), separate repo, or hosted service (e.g., Framer, Webflow)? Recommendation: separate repo (`archgate/www`) with a static site generator.

3. **Plugin GA distribution** — When beta ends, do we move to the official Claude Code marketplace, make the git repo public, or keep the custom service? Depends on marketplace availability and pricing at the time.

4. **Pricing timing** — When do we introduce paid tiers? Not during beta. Earliest at Wave 3 with enterprise features. Free tier must remain generous enough to drive adoption.

5. **macOS code signing** — Unsigned binaries trigger Gatekeeper warnings. Do we invest in an Apple Developer account ($99/year) for Wave 2 or Wave 3? Recommendation: Wave 3 — during beta, users can bypass via `xattr -d com.apple.quarantine`.

6. **ADR pack governance** — Who reviews community-contributed packs? What quality bar? Defer to Wave 3 when there's actual community contribution.

7. **Demo project** — Should we maintain an official demo repo (`archgate/demo`) showing a governed project? Recommendation: Yes, create during Wave 1 (W1-05) and keep it maintained.
