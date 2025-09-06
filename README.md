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

**The AI integration layer** is a Claude Code plugin that gives AI agents live access to your ADRs through the MCP server (`archgate mcp`). Agents read the decisions before writing code, validate changes after, and capture new patterns into the governance base. Archgate ships as its own governance subject — its own development is governed by the ADRs in `.archgate/adrs/`.

## Installation

```bash
npm install -g archgate
```

**Requirements:** macOS (arm64) or Linux (x86_64). Node.js is only needed to run the wrapper — the CLI itself is a standalone binary.

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
# 1. Install
npm install -g archgate

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

`archgate init` creates the `.archgate/adrs/` directory, an example ADR with a companion rules file to show the pattern, and configures the Claude Code plugin if you use it.

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

### `archgate init`

Initialize governance in the current project.

```bash
archgate init
```

Creates `.archgate/adrs/` with an example ADR and rules file, and optionally wires up the Claude Code plugin.

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

Exposes four tools to MCP-compatible clients (Claude Code, Cursor, etc.):

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `check`           | Run ADR compliance checks, optionally on staged files only        |
| `list_adrs`       | List all ADRs with metadata                                       |
| `review_context`  | Get changed files grouped by domain with applicable ADR briefings |
| `session_context` | Read the current Claude Code session transcript                   |

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

## Claude Code plugin

The Claude Code plugin (`archgate:developer`) gives AI agents a full governance workflow:

- Reads applicable ADRs before writing code
- Validates changes after implementation
- Captures new patterns back into ADRs

Install the plugin from [archgate/claude-code-plugin](https://github.com/archgate/claude-code-plugin), then run `archgate:onboard` once in your project to initialize governance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

[FSL-1.1-ALv2](LICENSE.md) — free to use, cannot be used to build a competing product.
