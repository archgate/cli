# Archgate CLI Roadmap

> **Last updated:** April 2026 | **Current version:** v0.30.1

This document describes what Archgate intends to build, improve, and explicitly _not_ pursue over the next 12 months. It is reviewed quarterly.

## Vision

Archgate becomes the standard governance layer for AI-assisted development. ADRs are the universal format for expressing architectural decisions, and Archgate enforces them automatically — across AI tools, CI systems, and teams.

## What's Done (Phases 0–2.5)

These phases are complete and stable:

- **ADR format & lifecycle** — create, list, show, update ADRs with YAML frontmatter and companion `.rules.ts` files
- **Check engine** — fast, deterministic ADR compliance validation (`archgate check`) with CI annotations, `--staged` support, and JSON output
- **AI integration** — MCP server exposing tools and resources for AI agents to consume ADR context
- **Editor plugins** — Claude Code, VS Code, Cursor, Copilot CLI, and opencode integrations
- **Documentation site** — [cli.archgate.dev](https://cli.archgate.dev) with i18n (English + Brazilian Portuguese)
- **Binary distribution** — macOS ARM, Linux x64, Windows x64 via GitHub Releases with npm thin shim, install script, and proto plugin
- **GitHub Actions** — `archgate/check-action@v1` and `archgate/setup-action@v1` published
- **Self-governance** — the CLI dogfoods 17+ ADRs with executable rules

## In Progress: Ecosystem Growth (Phase 3)

**Timeline:** Q2 2026 – Q1 2027

### ADR Marketplace

- Community-contributed ADR repository at [`archgate/awesome-adrs`](https://github.com/archgate/awesome-adrs)
- `archgate adr import <source>` command to import ADRs from the marketplace or any git URL
- Curated ADR sets: TypeScript, Testing, API Design (with companion `.rules.ts` files)
- Contribution guidelines and review process for community ADRs

### Pre-commit Hook Integration

- Package `archgate check --staged` for husky, lefthook, and pre-commit ecosystems
- Lower the adoption barrier for teams with existing git hook workflows
- Documentation and examples for each hook system

### Starter ADR Sets

- **TypeScript** — strict tsconfig rules, no `any`, naming conventions
- **Testing** — test file co-location, coverage thresholds, fixture patterns
- **API Design** — REST naming, error response format, OpenAPI requirements

### Documentation & Community

- Expand rule examples library (target: 30+ patterns)
- Contributor onboarding guide
- Case studies from early adopters

## What We Will NOT Do

These are explicit non-goals for the foreseeable future:

- **Become a linter.** Archgate orchestrates enforcement (including linting) but will not compete with ESLint, Biome, or Oxlint on code style rules.
- **Lock into a single AI tool.** The MCP server and ADR format are tool-agnostic. We will not build features that only work with one AI vendor.
- **Dictate technology stacks.** Archgate governs how you build, not what you build with. ADRs are stack-agnostic by design.
- **Build a code generation tool.** Archgate governs AI-generated code — it does not generate code itself.
- **Support pre-1.0 API stability guarantees.** The ADR format and Rule API may have breaking changes before 1.0. We version clearly and document migrations.

## Release Cadence

- **Patch releases** (bug fixes, docs): as needed
- **Minor releases** (features, non-breaking): roughly bi-weekly
- **Major milestones** are tracked in [GitHub Issues](https://github.com/archgate/cli/issues) and this roadmap

## How to Influence the Roadmap

- **Feature requests:** [Open an issue](https://github.com/archgate/cli/issues/new) with the `enhancement` label
- **Bug reports:** [Open an issue](https://github.com/archgate/cli/issues/new) with the `bug` label
- **Discussions:** [GitHub Discussions](https://github.com/archgate/cli/discussions) for broader ideas and feedback
- **Contributions:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved
