# Archgate

<div align="center">

**Enforce Architecture Decision Records as executable rules — for both humans and AI agents.**

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE.md)
[![Release](https://github.com/archgate/cli/actions/workflows/release.yml/badge.svg)](https://github.com/archgate/cli/actions/workflows/release.yml)
[![Docs](https://img.shields.io/badge/docs-cli.archgate.dev-blue)](https://cli.archgate.dev)

</div>

---

Archgate turns your Architecture Decision Records into a governance layer that runs in CI, enforces rules in pre-commit hooks, and feeds live context to AI coding agents — so architectural decisions don't stay in documents, they stay in the code.

**Write an ADR once. Enforce it everywhere.**

## How it works

Archgate has two layers:

1. **ADRs as documents** — markdown files with YAML frontmatter stored in `.archgate/adrs/`. Each ADR records a decision: what was decided, why, and what to do and not do.
2. **ADRs as rules** — each ADR can have a companion `.rules.ts` file that exports automated checks. Archgate runs these checks against your codebase and reports violations.

```
.archgate/
└── adrs/
    ├── ARCH-001-command-structure.md          # human-readable decision
    ├── ARCH-001-command-structure.rules.ts    # machine-executable checks
    ├── ARCH-002-error-handling.md
    └── ARCH-002-error-handling.rules.ts
```

When a rule is violated, `archgate check` reports the file, line, and which ADR was broken. Exit code 1 means violations — wire it into CI and it blocks merges automatically.

**The CLI is free and open source.** Writing ADRs, enforcing rules, running checks in CI, and wiring up pre-commit hooks all work without an account or subscription.

## Installation

```bash
# npm
npm install -g archgate

# Bun
bun install -g archgate

# Yarn
yarn global add archgate

# pnpm
pnpm add -g archgate
```

You can also install as a dev dependency:

```bash
npm install -D archgate    # or: bun add -d archgate
npx archgate check         # run via package manager
```

**Requirements:** macOS (arm64), Linux (x86_64), or Windows (x86_64). See the [installation guide](https://cli.archgate.dev/getting-started/installation/) for more options.

## Quick start

```bash
# 1. Install (pick your package manager)
npm install -g archgate    # or: bun install -g archgate

# 2. Initialize governance in your project
cd my-project
archgate init

# 3. Edit the generated ADR to document a real decision
# .archgate/adrs/ARCH-001-*.md

# 4. Add a companion .rules.ts to enforce it automatically
# .archgate/adrs/ARCH-001-*.rules.ts

# 5. Run checks
archgate check
```

## Writing rules

Each ADR can have a companion `.rules.ts` file that exports checks using `defineRules()` from the `archgate` package. Rules receive the list of files to check and return an array of violations with file paths and line numbers.

See the [writing rules guide](https://cli.archgate.dev/guides/writing-rules/) for examples and the full [rule API reference](https://cli.archgate.dev/reference/rule-api/).

## Commands

| Command                  | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| `archgate init`          | Initialize `.archgate/` with example ADR and editor config |
| `archgate check`         | Run ADR compliance checks (`--staged` for pre-commit)      |
| `archgate adr create`    | Create a new ADR interactively                             |
| `archgate adr list`      | List all ADRs (`--json`, `--domain`)                       |
| `archgate adr show <id>` | Print a specific ADR                                       |
| `archgate adr update`    | Update an ADR's frontmatter                                |
| `archgate login`         | Authenticate with GitHub for editor plugins                |
| `archgate mcp`           | Start the MCP server for AI agent integration              |
| `archgate upgrade`       | Upgrade to the latest release                              |
| `archgate clean`         | Remove the CLI cache (`~/.archgate/`)                      |

See the [CLI reference](https://cli.archgate.dev/reference/cli-commands/) for full usage and options.

## CI and pre-commit hooks

Add `archgate check` to your CI pipeline or pre-commit hooks to block merges that violate ADRs. See the [CI integration guide](https://cli.archgate.dev/guides/ci-integration/) and [pre-commit hooks guide](https://cli.archgate.dev/guides/pre-commit-hooks/) for setup instructions.

## Supercharge with AI plugins

> **Make your AI agent architecture-aware.** With the optional editor plugins, your AI coding agent reads ADRs before writing code, validates changes against your rules, and captures new architectural patterns back into ADRs — automatically.
>
> Plugins are available for [**Claude Code**](https://cli.archgate.dev/guides/claude-code-plugin/) and [**Cursor**](https://cli.archgate.dev/guides/cursor-integration/).
>
> ```bash
> archgate login             # one-time GitHub auth
> archgate init              # installs the plugin automatically
> ```
>
> **[Get started with plugins](https://cli.archgate.dev/guides/claude-code-plugin/)** — the CLI works fully without them, but plugins close the loop between decisions and code.

## Documentation

Full documentation is available at **[cli.archgate.dev](https://cli.archgate.dev)** — including guides for writing ADRs, writing rules, CI integration, editor plugin setup, and the complete CLI and MCP reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

[FSL-1.1-ALv2](LICENSE.md) — free to use, cannot be used to build a competing product.
