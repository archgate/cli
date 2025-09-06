# Contributing to Archgate CLI

Thank you for your interest in contributing to Archgate CLI! We welcome all kinds of contributions.

> **Note:** Development is only supported on macOS, Linux, or Windows via WSL2. Native Windows development is not supported.

## 🚀 Quick Start

### Prerequisites

- Git
- [proto](https://moonrepo.dev/docs/proto) (for toolchain management)

### Setup

1. **Install proto** (if not already installed):

```bash
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

After installation, restart your terminal or run `source ~/.zshrc` (or the appropriate file for your shell).

2. **Clone and setup the project**:

```bash
# Clone the repository
git clone https://github.com/archgate/cli.git
cd cli

# Install the toolchain (Bun, npm, Node, etc.)
proto use

# Install dependencies
bun install
```

3. **Verify the setup**:

```bash
bun run cli
```

## 🛠️ Development

### Available Scripts

```bash
# Run the CLI locally
bun run src/cli.ts <command>

# Full repo validation (MANDATORY before submitting PRs)
bun run validate        # lint + typecheck + format:check + test + ADR check

# Individual steps
bun run lint            # oxlint
bun run typecheck       # tsc --build
bun run format:check    # prettier --check
bun run format          # prettier --write (fix)
bun test                # all tests
```

### Project Structure

```
src/
├── cli.ts                  # Main CLI entry point
├── commands/
│   ├── init.ts             # Project initialization
│   ├── check.ts            # ADR compliance checks
│   ├── mcp.ts              # MCP server
│   ├── upgrade.ts          # CLI upgrade
│   ├── clean.ts            # Clean cache
│   └── adr/
│       ├── index.ts        # ADR subcommand registration
│       ├── create.ts       # Create new ADR
│       ├── list.ts         # List ADRs
│       ├── show.ts         # Show ADR by ID
│       └── update.ts       # Update existing ADR
├── engine/
│   ├── context.ts          # Review context (file-to-ADR matching)
│   ├── loader.ts           # Dynamic rule loading
│   ├── reporter.ts         # Check result formatting
│   └── runner.ts           # Rule execution engine
├── formats/
│   ├── adr.ts              # ADR frontmatter schema and parsing
│   └── rules.ts            # Rule types and defineRules()
├── helpers/
│   ├── paths.ts            # Path helpers (~/.archgate/, .archgate/)
│   ├── log.ts              # Logging utilities (logDebug, logInfo, etc.)
│   ├── adr-templates.ts    # ADR markdown templates
│   ├── adr-writer.ts       # ADR file write/update
│   ├── init-project.ts     # Project initialization logic
│   ├── claude-settings.ts  # Claude plugin settings
│   ├── git.ts              # Git availability checks
│   └── getParentFolderName.ts  # Project name extraction
└── mcp/
    ├── server.ts           # MCP server setup
    ├── resources.ts        # adr://{id} resource template
    └── tools/
        ├── index.ts        # Tool registration
        ├── check.ts        # check tool
        ├── list-adrs.ts    # list_adrs tool
        ├── review-context.ts   # review_context tool
        └── session-context.ts  # session_context tool
tests/                      # Mirrors src/ structure
.archgate/adrs/             # Self-governance ADRs
```

## 🔄 Contribution Workflow

1. **Fork the repository** on GitHub
2. **Create a feature branch** from `main`:

```bash
git checkout -b feature/your-feature-name
```

3. **Make your changes** and commit them:

```bash
git add .
git commit -m "feat: your feature description"
```

4. **Run the full validation suite**:

```bash
bun run validate
```

5. **Push to your fork**:

```bash
git push origin feature/your-feature-name
```

6. **Submit a pull request** to the main repository

## 📝 Guidelines

- Follow the existing code style and conventions
- Write clear, descriptive commit messages
- Add tests for new functionality when applicable
- Update documentation as needed
- Ensure all checks pass before submitting

---

For more information, see the main [README](README.md) or [open an issue](https://github.com/archgate/cli/issues) if you have questions.
