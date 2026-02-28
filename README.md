# Archgate

<div align="center">

**Enforce Architecture Decision Records as executable rules — for both humans and AI agents.**

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE.md)
[![Release](https://github.com/archgate/cli/actions/workflows/release.yml/badge.svg)](https://github.com/archgate/cli/actions/workflows/release.yml)

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

**Editor plugins are an optional paid add-on** for teams that want AI agents (Claude Code, Cursor) to read ADRs, validate changes, and capture new patterns automatically. Plugins are distributed from [plugins.archgate.dev](https://plugins.archgate.dev). See [Editor plugins](#editor-plugins) for details.

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

You can also install Archgate as a dev dependency and run it through your package manager:

```bash
# Install as dev dependency
npm install -D archgate    # or: bun add -d archgate

# Run via package manager
npx archgate check         # npm / Yarn / pnpm
bun run archgate check     # Bun
```

**Requirements:** macOS (arm64), Linux (x86_64), or Windows (x86_64). Node.js is only needed to run the npm/yarn/pnpm wrapper — the CLI itself is a standalone binary.

> **Using [proto](https://moonrepo.dev/proto)?** Add the following to `~/.proto/config.toml` and your shell profile so globals persist across Node.js version switches:
>
> ```toml
> # ~/.proto/config.toml
> [tools.npm]
> shared-globals-dir = true
> ```
>
> ```sh
> # ~/.zshrc or ~/.bashrc
> export PATH="$HOME/.proto/tools/node/globals/bin:$PATH"
> ```

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

`archgate init` creates the `.archgate/adrs/` directory with an example ADR and rules file, and configures editor settings. No account or login is needed — the CLI is fully functional without plugins.

**Want AI agent integration?** See [Editor plugins](#editor-plugins) to add the optional paid plugin for Claude Code or Cursor.

## Writing rules

A companion `.rules.ts` file exports checks using `defineRules()` from the `archgate` package:

```typescript
// .archgate/adrs/ARCH-002-error-handling.rules.ts
import { defineRules } from "archgate/rules";

export default defineRules([
  {
    id: "use-log-error",
    description:
      "Use logError() instead of console.error() for user-facing errors",
    severity: "error",
    async check({ files }) {
      const violations = [];
      for (const file of files) {
        const content = await Bun.file(file).text();
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (line.includes("console.error(")) {
            violations.push({
              file,
              line: i + 1,
              message: "Use logError() instead",
            });
          }
        });
      }
      return violations;
    },
  },
]);
```

Rules receive the list of files to check (filtered by the ADR's `files` glob if set), and return an array of violations with file paths and line numbers.

## Commands

### `archgate login`

Authenticate with GitHub to access the optional paid editor plugins.

```bash
archgate login           # authenticate via GitHub Device Flow
archgate login status    # show current auth status
archgate login logout    # remove stored credentials
archgate login refresh   # re-authenticate and claim a new token
```

Opens a browser-based GitHub Device Flow. Once authorized, an archgate plugin token is stored in `~/.archgate/credentials`. This token is used by `archgate init` to install the editor plugin. Not required for CLI-only usage.

### `archgate init`

Initialize governance in the current project.

```bash
archgate init                    # Claude Code (default)
archgate init --editor cursor    # Cursor
archgate init --install-plugin   # force plugin install attempt
```

Creates `.archgate/adrs/` with an example ADR and rules file and configures editor settings. Works without an account — plugin installation only happens when you are logged in.

**Plugin install behavior** (optional — requires `archgate login`):

- If you are logged in, init auto-detects your credentials and installs the plugin.
- For **Claude Code**: if the `claude` CLI is on PATH, the plugin is installed automatically via `claude plugin marketplace add` and `claude plugin install`. If not, the manual commands are printed.
- For **Cursor**: the plugin bundle is downloaded from [plugins.archgate.dev](https://plugins.archgate.dev) and extracted into `.cursor/`.
- Use `--install-plugin` to explicitly request plugin installation (useful if auto-detection is skipped).

### `archgate check`

Run all automated ADR checks against your codebase.

```bash
archgate check            # check all files
archgate check --staged   # check only git-staged files (for pre-commit hooks)
archgate check --json     # machine-readable JSON output
```

Exits with code 0 if all checks pass, 1 if any violations are found.

### `archgate adr create`

Create a new ADR interactively.

```bash
archgate adr create
```

Prompts for a title, domain, and optional file glob. Generates a sequential ID (`ARCH-001`, `ARCH-002`, ...) and writes the markdown file.

### `archgate adr list`

List all ADRs in the project.

```bash
archgate adr list                  # table output
archgate adr list --json           # JSON output
archgate adr list --domain backend # filter by domain
```

### `archgate adr show <id>`

Print a specific ADR.

```bash
archgate adr show ARCH-001
```

### `archgate adr update`

Update an existing ADR's frontmatter.

```bash
archgate adr update ARCH-001 --title "New Title" --domain backend
```

### `archgate mcp`

Start the MCP server for AI agent integration.

```bash
archgate mcp
```

Exposes five tools to MCP-compatible clients (Claude Code, Cursor, etc.):

| Tool                          | Description                                                       |
| ----------------------------- | ----------------------------------------------------------------- |
| `check`                       | Run ADR compliance checks, optionally on staged files only        |
| `list_adrs`                   | List all ADRs with metadata                                       |
| `review_context`              | Get changed files grouped by domain with applicable ADR briefings |
| `claude_code_session_context` | Read the current Claude Code session transcript                   |
| `cursor_session_context`      | Read Cursor agent session transcripts                             |

Also exposes `adr://{id}` resources for reading individual ADRs by ID.

### `archgate upgrade`

Upgrade to the latest release.

```bash
npm update -g archgate
```

### `archgate clean`

Remove the CLI cache directory (`~/.archgate/`).

```bash
archgate clean
```

## CI integration

Add a check step to your pipeline:

```yaml
# GitHub Actions example
- name: ADR compliance check
  run: archgate check
```

For pre-commit hooks (using [lefthook](https://github.com/evilmartians/lefthook) or similar):

```yaml
pre-commit:
  commands:
    adr-check:
      run: archgate check --staged
```

## Editor plugins

> **Plugins are an optional paid add-on.** The CLI works fully without them. Plugins add AI agent integration — your AI coding agent reads ADRs before writing code, validates changes after implementation, and captures new patterns back into ADRs.

Plugins are distributed from [plugins.archgate.dev](https://plugins.archgate.dev).

### Setup

```bash
# 1. Log in (one-time) — links your GitHub account and issues a plugin token
archgate login

# 2. Initialize a project with the plugin
archgate init                  # Claude Code (default)
archgate init --editor cursor  # or Cursor
```

If you are logged in, `archgate init` auto-detects your credentials and installs the plugin. You can also pass `--install-plugin` explicitly.

### Claude Code

If the `claude` CLI is on your PATH, the plugin is installed automatically. Otherwise, run the printed commands manually:

```bash
claude plugin marketplace add https://<user>:<token>@plugins.archgate.dev/archgate.git
claude plugin install archgate@archgate
```

Once installed, run `archgate:onboard` in Claude Code to initialize governance for your project.

### Cursor

The Cursor plugin bundle is downloaded from [plugins.archgate.dev](https://plugins.archgate.dev) and extracted into `.cursor/` automatically.

Once installed, run the `ag-onboard` skill in Cursor to initialize governance for your project.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

[FSL-1.1-ALv2](LICENSE.md) — free to use, cannot be used to build a competing product.
