# Archgate

<div align="center">

**Enterprise-grade linting and guardrails for AI work.**

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE.md)
[![Release](https://github.com/archgate/cli/actions/workflows/release.yml/badge.svg)](https://github.com/archgate/cli/actions/workflows/release.yml)
[![Docs](https://img.shields.io/badge/docs-cli.archgate.dev-blue)](https://cli.archgate.dev)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/12659/badge)](https://www.bestpractices.dev/projects/12659)

</div>

---

AI agents write code fast, but they don't know your rules. Archgate turns your team's decisions into executable checks: a lint step for architecture, conventions, and AI output. Your agents read the rules before writing code, and `archgate check` blocks what slips through. In CI, in pre-commit hooks, and inside every major AI coding tool.

**Write an ADR once. Enforce it everywhere.**

## How it works

Archgate has two layers:

1. **ADRs as documents**: markdown files with YAML frontmatter stored in `.archgate/adrs/`. Each ADR records a decision: what was decided, why, and what to do and not do.
2. **ADRs as rules**: each ADR can have a companion `.rules.ts` file that exports automated checks. Archgate runs these checks against your codebase and reports violations.

```
.archgate/
└── adrs/
    ├── ARCH-001-command-structure.md          # human-readable decision
    ├── ARCH-001-command-structure.rules.ts    # machine-executable checks
    ├── ARCH-002-error-handling.md
    └── ARCH-002-error-handling.rules.ts
```

When a rule is violated, `archgate check` reports the file, line, and which ADR was broken. Exit code 1 means violations. Wire it into CI and it blocks merges automatically.

**The CLI is free and open source.** Writing ADRs, enforcing rules, running checks in CI, and wiring up pre-commit hooks all work without an account or subscription.

## Installation

Install via standalone script, npm, pip, dotnet, Go, gem, Maven, or proto. See the **[installation guide](https://cli.archgate.dev/getting-started/installation/)** for all options and platform support.

## Quick start

```bash
# 1. Initialize governance in your project
cd my-project
archgate init

# 2. Edit the generated ADR to document a real decision
# .archgate/adrs/ARCH-001-*.md

# 3. Add a companion .rules.ts to enforce it automatically
# .archgate/adrs/ARCH-001-*.rules.ts

# 4. Run checks
archgate check
```

## Writing rules

Each ADR can have a companion `.rules.ts` file that exports automated checks. See the [writing rules guide](https://cli.archgate.dev/guides/writing-rules/) for examples and the full [rule API reference](https://cli.archgate.dev/reference/rule-api/).

## Supercharge with AI plugins

> **Make your AI agent architecture-aware.** With the optional editor plugins, your AI coding agent reads ADRs before writing code, validates changes against your rules, and captures new architectural patterns back into ADRs, automatically.
>
> Plugins are available for [**Claude Code**](https://cli.archgate.dev/guides/claude-code-plugin/), [**Cursor**](https://cli.archgate.dev/guides/cursor-integration/), [**VS Code**](https://cli.archgate.dev/guides/vscode-plugin/), [**Copilot CLI**](https://cli.archgate.dev/guides/copilot-cli-plugin/), and [**opencode**](https://cli.archgate.dev/guides/opencode-integration/).
>
> ```bash
> archgate login             # one-time GitHub auth
> archgate init              # installs the plugin automatically
> ```
>
> **[Get started with plugins](https://cli.archgate.dev/guides/claude-code-plugin/)**. The CLI works fully without them, but plugins close the loop between decisions and code.

## Documentation

Full documentation is available at **[cli.archgate.dev](https://cli.archgate.dev)**, including guides for writing ADRs, writing rules, CI integration, editor plugin setup, and the complete CLI reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

[Apache-2.0](LICENSE.md)
