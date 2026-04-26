# Contributing to Archgate CLI

Thank you for your interest in contributing to Archgate CLI! We welcome all kinds of contributions.

> **Note:** Development is supported on macOS, Linux, and Windows.

## Architecture Decision Records (ADRs)

Archgate dogfoods itself — the CLI is governed by its own ADRs in `.archgate/adrs/`. **Before writing any code, read the ADRs that apply to the area you're changing.**

### Quick reference

| ADR                                                       | Scope    | Summary                                                              |
| --------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| [ARCH-001](/.archgate/adrs/ARCH-001-command-structure.md) | Commands | `register*Command(program)` pattern, no business logic in commands   |
| [ARCH-002](/.archgate/adrs/ARCH-002-error-handling.md)    | Errors   | Exit codes (0/1/2), `logError()` for stderr                          |
| [ARCH-003](/.archgate/adrs/ARCH-003-output-formatting.md) | Output   | `styleText` from `node:util`, `--json` flag, no emoji                |
| [ARCH-004](/.archgate/adrs/ARCH-004-no-barrel-files.md)   | Imports  | Direct imports only, no `index.ts` barrel re-exports                 |
| [ARCH-005](/.archgate/adrs/ARCH-005-testing-standards.md) | Tests    | Bun test runner, fixtures in `tests/fixtures/`, 80 % coverage target |
| [ARCH-006](/.archgate/adrs/ARCH-006-dependency-policy.md) | Deps     | Minimal dependencies, prefer Bun built-ins                           |

To browse ADRs locally after cloning:

```bash
# List all ADRs
bun run src/cli.ts adr list

# Show a specific ADR
bun run src/cli.ts adr show ARCH-001
```

ADR compliance is enforced automatically — `bun run validate` includes an ADR check step that verifies your changes against every rule. **Pull requests that violate an ADR will not pass CI.**

## Quick Start

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

## Development

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
│   └── rules.ts            # Rule types (RuleSet, RuleConfig)
├── helpers/
│   ├── paths.ts            # Path helpers (~/.archgate/, .archgate/)
│   ├── log.ts              # Logging utilities (logDebug, logInfo, etc.)
│   ├── adr-templates.ts    # ADR markdown templates
│   ├── adr-writer.ts       # ADR file write/update
│   ├── init-project.ts     # Project initialization logic
│   ├── claude-settings.ts  # Claude plugin settings
│   ├── git.ts              # Git availability checks
│   └── getParentFolderName.ts  # Project name extraction
tests/                      # Mirrors src/ structure
.archgate/adrs/             # Self-governance ADRs
```

## Contribution Workflow

1. **Fork the repository** on GitHub
2. **Create a feature branch** from `main`:

```bash
git checkout -b feature/your-feature-name
```

3. **Read the ADRs** relevant to the area you're changing (see table above)

4. **Make your changes** and commit them using [Conventional Commits](https://www.conventionalcommits.org/):

```bash
git add .
git commit -m "feat: your feature description"
```

5. **Run the full validation suite** (includes ADR compliance checks):

```bash
bun run validate
```

6. **Push to your fork**:

```bash
git push origin feature/your-feature-name
```

7. **Submit a pull request** to the main repository

## Developer Certificate of Origin (DCO)

This project uses the [Developer Certificate of Origin (DCO)](https://developercertificate.org/) to ensure that contributors have the right to submit their contributions under the project's [Apache 2.0 license](LICENSE.md).

**All commits must include a `Signed-off-by` line** with your real name and email address, certifying that you have the right to submit the work under the project's license:

```
Signed-off-by: Your Name <your.email@example.com>
```

### How to sign off

Add the `-s` (or `--signoff`) flag to your `git commit` command:

```bash
git commit -s -m "feat: your feature description"
```

This automatically appends the `Signed-off-by` line using the name and email from your git configuration. To set these:

```bash
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

### Fixing unsigned commits

If you forget to sign off, you can amend your most recent commit:

```bash
git commit --amend -s --no-edit
```

For multiple unsigned commits, use an interactive rebase:

```bash
git rebase --signoff HEAD~N  # where N is the number of commits to sign
```

**Pull requests with unsigned commits will fail the DCO check in CI and cannot be merged.**

## Guidelines

- **Read the ADRs first** — all code changes must comply with the project's Architecture Decision Records
- **Sign your commits** — all commits must include a `Signed-off-by` line (see DCO section above)
- Follow the existing code style and conventions
- Write clear, descriptive commit messages using [Conventional Commits](https://www.conventionalcommits.org/)
- Add tests for new functionality when applicable
- Update documentation as needed
- Ensure `bun run validate` passes before submitting

---

For more information, see the main [README](README.md) or [open an issue](https://github.com/archgate/cli/issues) if you have questions.
