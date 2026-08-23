# Archgate CLI Roadmap

This document describes what Archgate intends to build, improve, and explicitly _not_ pursue over the next 12 months. It is reviewed quarterly.

## Vision

Archgate becomes the standard for linting and guardrails in AI-assisted development. ADRs are the universal format for expressing architectural decisions, and Archgate enforces them automatically across AI tools, CI systems, and teams.

## What's Done

These are complete and stable as of v0.55.0:

- **ADR format & lifecycle**: create, list, show, update, import, sync, and domain management, with YAML frontmatter and companion `.rules.ts` files
- **Check engine**: fast, deterministic ADR compliance validation (`archgate check`) with CI annotations, `--staged` support, `--strict` mode, and SARIF output for GitHub code scanning
- **Rule API**: AST-aware rule context (`ctx.ast()`, `ctx.findAstNodes()`) with parse caching and multi-language support, plus `ctx.readYAML()`, `ctx.checkCase()`, `ctx.glob()`, `ctx.grep()`, and `ctx.readFile()`
- **Rule sandbox**: every `.rules.ts` file is statically scanned before execution — module allowlist, blocked network/subprocess/eval access, path-confined filesystem API
- **Suppressions**: `archgate-ignore` comments with reason tracking and unused-suppression reporting
- **AI integration**: `session-context` and `review-context` commands that feed ADR context to AI agents via editor plugins
- **Editor plugins**: Claude Code, VS Code, Cursor, Copilot CLI, Claude Desktop, and opencode
- **Documentation site**: [cli.archgate.dev](https://cli.archgate.dev) with i18n (English + Brazilian Portuguese)
- **Binary distribution**: macOS ARM, Linux x64, Windows x64 via GitHub Releases, with SHA-256 checksums, Sigstore signatures, and SLSA provenance on every artifact
- **Package managers**: npm, PyPI, RubyGems, NuGet, Maven Central (and JBang), and Go — all tracking the same version — plus the install script and the [proto](https://moonrepo.dev/proto) plugin
- **GitHub Actions**: `archgate/check-action@v1` and `archgate/setup-action@v1` published
- **Pre-commit**: [`archgate/pre-commit-hook`](https://github.com/archgate/pre-commit-hook) supporting native hooks, the pre-commit framework, Lefthook, and Husky
- **ADR marketplace**: [`archgate/awesome-adrs`](https://github.com/archgate/awesome-adrs) — 25 packs, 99 ADRs, every one with an executable rule
- **ADR library on the web**: browse and compose packs at [app.archgate.dev/adrs](https://app.archgate.dev/adrs), then copy the generated `archgate adr import` command
- **Self-governance**: the CLI dogfoods 35 of its own ADRs, 30 with executable rules, across a suite of 2,589 tests

## In Progress

**Timeline:** Q3 2026 – Q2 2027

### Community ADR packs

The registry has 25 curated packs and 99 ADRs, and every one of them was written by us.
The contribution path is open and unused: issue templates, a PR template, a review
process, CI that compiles and executes submitted rules, and a `community/links.yaml`
tier for packs hosted in your own repository.

**If you maintain architectural conventions worth sharing, this is the most useful
thing you can contribute.** See [CONTRIBUTING.md](https://github.com/archgate/awesome-adrs/blob/main/CONTRIBUTING.md).
You can submit a curated pack for review, or just a link to your own repo — the CLI
imports from any git URL, so your pack does not have to live in ours.

### Plugin catalog on the platform

[app.archgate.dev/plugins](https://app.archgate.dev/plugins) is a placeholder today.
Browsing plugins by editor, with per-editor install instructions, is the next platform
milestone. Install instructions currently live in the docs site.

### winget distribution

Manifests are written and release automation is wired; the package has not yet been
accepted into `microsoft/winget-pkgs`. Until then, Windows users can use the npm shim,
the PowerShell install script, or a direct download from GitHub Releases.

### Repository opportunity score

Analyze a repository's review friction and decision debt, get a governance score, and
receive a recommended starter set of ADRs for that codebase. Designed; not yet built.

### Documentation & community

- Expand the rule examples library
- Contributor onboarding guide
- Case studies from teams using Archgate in CI

### Under consideration

- `linux-arm64` and `linux-x64-musl` binaries (ARM CI runners, Alpine images)
- macOS code signing and notarization

## What We Will NOT Do

These are explicit non-goals for the foreseeable future:

- **Become a linter.** Archgate orchestrates enforcement (including linting) but will not compete with ESLint, Biome, or Oxlint on code style rules.
- **Lock into a single AI tool.** The ADR format and editor integrations are tool-agnostic. We will not build features that only work with one AI vendor.
- **Dictate technology stacks.** Archgate governs how you build, not what you build with. ADRs are stack-agnostic by design.
- **Build a code generation tool.** Archgate governs AI-generated code. It does not generate code itself.
- **Support pre-1.0 API stability guarantees.** The ADR format and Rule API may have breaking changes before 1.0. We version clearly and document migrations.

## Release Cadence

- **Patch releases** (bug fixes, docs): as needed
- **Minor releases** (features, non-breaking): roughly bi-weekly in practice — 55 minor versions across the first seven months
- **Major milestones** are tracked in [GitHub Issues](https://github.com/archgate/cli/issues) and this roadmap

Archgate is pre-1.0. Breaking changes ship in minor releases and are called out in the
[changelog](CHANGELOG.md) — for example, 0.52.0 replaced `--json`/`--ci`/`--max-warnings`
on `check` with `--strict` and `--output`, and 0.53.0 changed `session-context` to
auto-detect the editor.

## How to Influence the Roadmap

- **Feature requests:** [Open an issue](https://github.com/archgate/cli/issues/new) with the `enhancement` label
- **Bug reports:** [Open an issue](https://github.com/archgate/cli/issues/new) with the `bug` label
- **Discussions:** [GitHub Discussions](https://github.com/archgate/cli/discussions) for broader ideas and feedback
- **Contributions:** See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get involved
