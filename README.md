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

**Requirements:** macOS (arm64), Linux (x86_64), or Windows (x86_64). Node.js is only needed to run the wrapper — the CLI itself is a standalone binary.

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

# 2. Log in to enable plugin access (one-time)
archgate login

# 3. Initialize governance in your project
cd my-project
archgate init                  # Claude Code (default)
archgate init --editor cursor  # or Cursor

# 4. Edit the generated ADR to document a real decision
# .archgate/adrs/ARCH-001-*.md

# 5. Add a companion .rules.ts to enforce it automatically
# .archgate/adrs/ARCH-001-*.rules.ts

# 6. Run checks
archgate check
```

`archgate init` creates the `.archgate/adrs/` directory with an example ADR and rules file, configures editor settings (`.claude/` or `.cursor/`), and installs the archgate plugin if you are logged in. If the `claude` CLI is on your PATH, the plugin is installed automatically; otherwise the command prints the manual install steps.

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

Authenticate with GitHub to access archgate plugins.

```bash
archgate login           # authenticate via GitHub Device Flow
archgate login status    # show current auth status
archgate login logout    # remove stored credentials
archgate login refresh   # re-authenticate and claim a new token
```

Opens a browser-based GitHub Device Flow. Once authorized, an archgate plugin token is stored in `~/.archgate/credentials`. This token is used by `archgate init` to install the editor plugin.

### `archgate init`

Initialize governance in the current project.

```bash
archgate init                    # Claude Code (default)
archgate init --editor cursor    # Cursor
archgate init --install-plugin   # force plugin install attempt
```

Creates `.archgate/adrs/` with an example ADR and rules file, configures editor settings, and installs the archgate plugin when credentials are available.

**Plugin install behavior:**

- If you are logged in (`archgate login`), init auto-detects your credentials and installs the plugin.
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

Archgate ships editor plugins that give AI agents a full governance workflow — reading applicable ADRs before writing code, validating changes after implementation, and capturing new patterns back into ADRs.

Plugins are distributed from [plugins.archgate.dev](https://plugins.archgate.dev). Run `archgate login` once to authenticate, then `archgate init` handles installation.

### Claude Code

```bash
archgate login
archgate init
```

If the `claude` CLI is on your PATH, the plugin is installed automatically. Otherwise, run the printed commands manually:

```bash
claude plugin marketplace add https://<user>:<token>@plugins.archgate.dev/archgate.git
claude plugin install archgate@archgate
```

Once installed, run `archgate:onboard` in Claude Code to initialize governance for your project.

### Cursor

```bash
archgate login
archgate init --editor cursor
```

The Cursor plugin bundle is downloaded and extracted into `.cursor/` automatically.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and workflow.

## License

[FSL-1.1-ALv2](LICENSE.md) — free to use, cannot be used to build a competing product.
