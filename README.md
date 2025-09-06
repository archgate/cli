# Archgate CLI

<div align="center">

🚀 **The CLI for managing Archgate projects**

[![License: FSL-1.1-ALv2](https://img.shields.io/badge/License-FSL--1.1--ALv2-blue.svg)](LICENSE.md)
[![Release](https://github.com/archgate/cli/actions/workflows/release.yml/badge.svg)](https://github.com/archgate/cli/actions/workflows/release.yml)
[![npm version](https://badge.fury.io/js/archgate.svg)](https://www.npmjs.com/package/archgate)

</div>

## ✨ Features

- **Project Initialization**: Quickly scaffold new Archgate projects with best practices
- **Template Management**: Automatically downloads and applies project templates
- **Interactive Setup**: Guided project configuration with smart defaults
- **Bun-Powered**: Built for speed and modern JavaScript/TypeScript development

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (required)
- macOS or Linux (Windows only supported through WSL2)

### Installation

```bash
# Run directly with bunx (recommended)
bunx archgate [command]

# Or install globally
bun add -g archgate
```

### Initialize a New Project

```bash
# Navigate to your project directory
cd my-new-project

# Initialize with interactive prompts
bunx archgate init
```

The CLI will guide you through:

- Project name configuration
- Description setup
- Template application with smart defaults

## 📖 Commands

### `archgate init`

Initialize a new Archgate project in the current directory.

```bash
archgate init
```

**What it does:**

- Creates the `.archgate/adrs/` governance directory
- Generates an example ADR to get you started
- Configures Claude Code plugin settings (`.claude/settings.local.json`)

### `archgate check`

Run automated ADR compliance checks against your codebase.

```bash
archgate check          # check all files
archgate check --staged # check only git-staged files
archgate check --ci     # CI mode (machine-readable output)
```

**What it does:**

- Loads all ADRs with companion `.rules.ts` files
- Executes rule checks against matching files
- Reports violations with file paths and line numbers
- Exits with code 1 if any violations are found

### `archgate adr create`

Create a new ADR interactively.

```bash
archgate adr create
```

**What it does:**

- Prompts for ADR title, domain, and optional file globs
- Generates a unique sequential ID (e.g., `ARCH-007`)
- Creates the ADR markdown file in `.archgate/adrs/`

### `archgate adr list`

List all ADRs in the project.

```bash
archgate adr list             # table output
archgate adr list --json      # JSON output
archgate adr list --domain X  # filter by domain
```

### `archgate adr show <id>`

Display a specific ADR by its ID.

```bash
archgate adr show ARCH-001
```

### `archgate adr update`

Update an existing ADR by ID.

```bash
archgate adr update ARCH-001 --title "New Title" --domain backend
```

### `archgate mcp`

Start the MCP (Model Context Protocol) server for AI tool integration.

```bash
archgate mcp
```

**What it does:**

- Exposes tools (`check`, `list_adrs`, `review_context`, `session_context`) to MCP-compatible AI clients
- Provides `adr://{id}` resources for reading ADR content

### `archgate clean`

Remove the CLI cache directory (`~/.archgate/`).

```bash
archgate clean
```

### `archgate upgrade`

Upgrade the Archgate CLI to the latest version.

```bash
archgate upgrade
```

## 🤝 Contributing to the project

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for development setup, workflow, and project structure.

## 📄 License

This project is licensed under the [FSL-1.1-ALv2](LICENSE) license.

## 🔗 Links

- [Archgate Website](https://archgate.dev)
- [GitHub Repository](https://github.com/archgate/cli)
- [Issue Tracker](https://github.com/archgate/cli/issues)
- [Templates Repository](https://github.com/archgate/templates)

---

<div align="center">
Made with ❤️ by the Archgate team
</div>
