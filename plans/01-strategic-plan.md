# Archgate Strategic Plan: AI Governance as a Product

## The Problem

AI coding agents are powerful but ungoverned. When enterprises adopt tools like Claude Code, Cursor, or Copilot, they face a fundamental tension:

- **Developers want speed** — AI agents generate code fast, unblocking them from boilerplate and repetitive tasks.
- **Organizations need consistency** — code must follow architectural standards, security policies, naming conventions, and domain-specific patterns.
- **AI agents have no guardrails** — without explicit constraints, they produce code that works but doesn't conform. Every generated file becomes a review burden.

The result: enterprises either slow down AI adoption (losing productivity) or accept inconsistent code (accumulating debt). Neither is acceptable.

> **Status (Feb 2026):** The core product (Phases 0–2.5) is implemented and stable. The CLI scaffolds governance, enforces ADRs via automated checks, and integrates with AI agents via MCP. AI-powered review and capture are delivered through a Claude Code plugin (`plugin/`) with role-based skills (architect, quality-manager, adr-author) and a developer agent — not standalone CLI commands. The focus has shifted to **ecosystem maturity**: rich review context for AI tools, complete ADR lifecycle (create/update/show/list), and session-aware context recovery.

## The Insight: ADRs as Executable Governance

Architecture Decision Records (ADRs) are a well-established practice — teams document decisions like "we use React for the frontend" or "API routes must have OpenAPI schemas." But traditionally, ADRs are passive documents. Developers read them (sometimes) and follow them (hopefully).

Archgate makes ADRs active. The core insight:

> **An ADR should not just describe a rule — it should enforce it.**

Each ADR in Archgate has two expressions:

1. **A human-readable document** — for developers and AI agents to understand the intent, context, and rationale.
2. **Machine-checkable rules** — lint rules, file structure assertions, import boundary checks, config validators — that verify compliance automatically.

When an AI agent writes code in an Archgate-governed project, two things happen:

- The agent reads the ADR documents as context, shaping what it generates (prevention).
- The automated checks validate the output, catching what the agent missed (detection).

This is **governed AI development**: correctness by construction where possible, correctness by detection everywhere else.

## How Archgate Makes This Work

### The Governance Loop

```
  ┌───────────────────────────────────────────────────┐
  │                                                   │
  │   1. ADRs loaded as agent context                 │
  │      (AI writes compliant code from the start)    │
  │                                                   │
  │   2. archgate check (CI, pre-commit)              │
  │      (fast, free, deterministic validation)       │
  │                                                   │
  │   3. @architect skill (Claude Code plugin)        │
  │      (judgment calls humans can't lint for)       │
  │                                                   │
  │   4. @quality-manager skill (Claude Code plugin)  │
  │      (learns from violations, proposes new rules) │
  │                                                   │
  │   5. New ADR rules added ──► back to step 1       │
  │                                                   │
  └───────────────────────────────────────────────────┘
```

The system is a ratchet: every mistake becomes a permanent rule. Over time, more governance shifts from expensive AI review to free automated checks. Token costs decrease while compliance increases.

### The Orchestration Layer (Key Insight)

The governance loop above describes _what_ happens, but not _who drives it_. In practice, there are two enforcement modes:

**Mode 1: CI/Pre-commit (deterministic, no AI)**

- `archgate check --staged` in pre-commit hooks
- `archgate check` in CI pipelines
- Blocks non-compliant code from being merged — the hard gate

**Mode 2: Claude Code Plugin (AI-assisted development)**

- The `plugin/` directory ships with the CLI and provides Claude Code integration
- Plugin skills (`@architect`, `@quality-manager`, `@adr-author`) define governance roles
- A developer agent (`agents/developer.md`) orchestrates the full governance workflow
- MCP tools (`check`, `list_adrs`, `review_context`, `claude_code_session_context`) connect Claude Code to the archgate CLI
- The `review_context` MCP tool pre-computes domain-grouped ADR briefings for efficient AI review

The critical insight: **the MCP tools and CLI commands are passive capabilities**. The _workflow_ — the ordering, gates, and roles — lives in the plugin's agent and skills. Without the plugin, the tools exist but nothing tells the AI _when_ and _how_ to use them.

### Two Enforcement Layers

| Layer                | Mechanism                                    | Cost   | Speed        | Use Case                              |
| -------------------- | -------------------------------------------- | ------ | ------------ | ------------------------------------- |
| **Automated checks** | Lint rules, file assertions, import analysis | Free   | Milliseconds | 70-80% of ADR rules                   |
| **AI review**        | Claude Code plugin reviews code against ADRs | Tokens | Seconds      | Subjective quality, architectural fit |

The strategic goal is to maximize Layer 1 coverage over time, using Layer 2 only for what machines genuinely cannot evaluate.

## Market Position

### What Archgate Is NOT

- **Not a framework** — it doesn't dictate your stack (React, Angular, Vue — doesn't matter).
- **Not a linter** — it orchestrates linting as one enforcement mechanism among many.
- **Not an AI coding tool** — it governs AI coding tools you already use.
- **Not a scaffolding-only CLI** — scaffolding is the entry point, governance is the product.

### What Archgate IS

**A governance layer for AI-assisted development.** It sits between your AI agents and your codebase, ensuring that whatever gets generated follows your rules.

It works with any:

- **AI tool** — Claude Code (via plugin), Cursor, Copilot, Windsurf (via MCP or direct integration)
- **Stack** — the ADR format is stack-agnostic; ADR packs provide stack-specific rules
- **CI system** — GitHub Actions, GitLab CI, Jenkins (the check command runs anywhere)
- **Team size** — solo developer to 500-person engineering org

### Competitive Landscape

| Competitor                      | What they do                         | Archgate differentiator                                                           |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------- |
| ESLint/Biome                    | Lint code style                      | Archgate orchestrates linting as part of broader governance                       |
| Cursor Rules / .cursorrules     | Single file of AI instructions       | Archgate provides structured, versioned, testable ADRs with automated enforcement |
| Claude Code CLAUDE.md           | Project instructions for one AI tool | Archgate abstracts governance across AI tools via MCP                             |
| Architectural fitness functions | Code metrics and constraints         | Archgate combines static checks with AI judgment and learning                     |
| Backstage / Port                | Developer portals                    | Archgate governs what gets built, not where it's cataloged                        |

### Target Customers

**Primary:** Mid-to-large engineering organizations (50-500 developers) adopting AI coding tools who need to maintain architectural consistency.

**Secondary:** Regulated industries (finance, healthcare, government) where compliance is a legal requirement and AI-generated code must be auditable.

**Tertiary:** Consulting firms and agencies that manage multiple client codebases and need repeatable quality standards.

## Value Proposition

### For Engineering Leaders

> "Your AI agents follow your architecture decisions. 80% of compliance is verified in CI for free. The remaining 20% gets AI review. And the system learns — every mistake becomes a new automated check."

### For Developers

> "Stop guessing what patterns to follow. The ADRs tell the AI what to generate, and the checks tell you if it's right. Focus on solving problems, not memorizing conventions."

### For Regulated Industries

> "Every AI-generated code change has an audit trail: which ADRs were active, which checks passed, which violations were flagged. Compliance is provable, not just promised."

## Business Model

```
Free (OSS)              Pro ($X/dev/mo)            Enterprise (custom)
────────────────────    ────────────────────────   ──────────────────────
archgate init            Premium ADR packs          ADR authoring UI
archgate check           Priority support           Compliance dashboard
archgate plugin          Private ADR registries     Audit trail & reports
Community ADR packs                                SSO/SCIM
Claude Code plugin                                 On-prem option
                                                   Custom ADR development
```

The open-source core drives adoption. The plugin is free — governance structure is the value. Enterprise tooling drives revenue. The ADR marketplace creates network effects — the more teams contribute ADR packs, the more valuable the ecosystem becomes.

## Strategic Milestones

1. ~~**Prove the concept** — The money-sync project is the reference implementation. It demonstrates that governed AI development produces consistent, correct code across frontend, backend, and data layers.~~ **DONE**

2. ~~**Extract the framework** — Separate the governance structure from the money-sync application. The CLI becomes the distribution mechanism.~~ **DONE** (Phase 0)

3. ~~**Build the check engine** — The automated enforcement layer that runs in any CI. This is the first product-market fit signal: teams adopt `archgate check` because it catches real problems for free.~~ **DONE** (Phase 1)

4. ~~**Add AI review** — The judgment layer via MCP + AI agent.~~ **PIVOTED** — AI review now runs through Claude Code plugin (`plugin/`) instead of standalone CLI commands. This ensures Anthropic ToS compliance and leverages Claude Code's native capabilities. The CLI remains standalone for deterministic operations.

5. ~~**Build the plugin** — The Claude Code plugin ships with the CLI. Role-based skills (architect, quality-manager, adr-author) and a developer agent orchestrate governance workflows. MCP tools provide rich review context.~~ **DONE** (Phase 2.5)

6. **Build the ecosystem** — ADR packs, authoring tools, compliance dashboards. This is the enterprise play: organizations pay for tooling that scales governance across teams.

## The Long-Term Vision

Archgate becomes the standard for how organizations govern AI-assisted development. Just as ESLint standardized code style enforcement and Docker standardized deployment, Archgate standardizes architectural governance.

The ADR format becomes an industry convention. Teams share ADR packs like they share npm packages. AI agents from any vendor read Archgate ADRs natively. The governance layer is universal, not locked to any single AI tool.

**The moat is not the technology — it's the curated, tested, versioned knowledge base of architectural decisions that organizations build on top of Archgate.**
