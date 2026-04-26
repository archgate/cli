# Security Assurance Case

This document provides an assurance case for the Archgate CLI, justifying why the project's security requirements are met. It covers the threat model, trust boundaries, application of secure design principles, and countermeasures against common implementation weaknesses.

> **Scope:** This assurance case covers the Archgate CLI (`archgate` npm package and standalone binary) as of v0.30.x. The plugin distribution service and marketing website are out of scope.

## 1. Threat Model

### 1.1 What Archgate Does

Archgate is a CLI tool that enforces Architecture Decision Records (ADRs) as executable TypeScript rules. It:

- **Reads** `.rules.ts` files from the project directory and executes them to validate code compliance
- **Reads** project source files through a sandboxed `RuleContext` API
- **Outputs** violation reports to stdout/stderr (console, JSON, or GitHub Actions annotations)
- **Downloads** platform binaries from GitHub Releases (during install/upgrade)
- **Authenticates** users via the operating system's credential manager for plugin installation (optional)

Archgate does **not**:

- Modify source code or project files during checks
- Store credentials on disk — authentication tokens are managed by the OS credential manager (macOS Keychain, Windows Credential Manager, Linux secret service)
- Send telemetry or source code to external servers (telemetry is opt-in, anonymized, and contains only usage counts — see [Telemetry docs](https://cli.archgate.dev/reference/telemetry/))
- Require network access for core functionality (`archgate check` is fully offline)

### 1.2 Threat Categories

| ID | Threat | Severity | Likelihood | Description |
|----|--------|----------|------------|-------------|
| T1 | Malicious `.rules.ts` files | High | Medium | A rule file could attempt to access the filesystem, network, or execute arbitrary commands |
| T2 | Supply chain attack via dependencies | High | Low | A compromised dependency could inject malicious code into the CLI binary |
| T3 | Tampered binary during install/upgrade | High | Low | A man-in-the-middle attack could serve a modified binary |
| T4 | Credential theft | Medium | Low | An attacker with local access could attempt to extract the authentication token from the OS credential manager |
| T5 | Path traversal in rule context | Medium | Medium | A rule could attempt to read files outside the project directory |
| T6 | Denial of service via rules | Low | Medium | A rule could consume excessive resources (CPU, memory, time) |
| T7 | Injection via ADR content | Low | Low | Malformed ADR frontmatter could cause unexpected behavior during parsing |

### 1.3 Threat Actors

- **Untrusted contributors** submitting pull requests with malicious `.rules.ts` files (most likely)
- **Compromised upstream dependencies** in the npm/Bun ecosystem
- **Network attackers** intercepting binary downloads or plugin installations

## 2. Trust Boundaries

```
┌──────────────────────────────────────────────────────────┐
│                    USER'S MACHINE                         │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              ARCHGATE CLI PROCESS                   │  │
│  │                                                     │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │         RULE EXECUTION SANDBOX               │   │  │
│  │  │                                              │   │  │
│  │  │  .rules.ts files execute here with:          │   │  │
│  │  │  - RuleContext API (read-only, path-scoped)  │   │  │
│  │  │  - 30-second timeout                         │   │  │
│  │  │  - Static analysis pre-scan                  │   │  │
│  │  │  - No fs/net/child_process/eval access       │   │  │
│  │  │                                              │   │  │
│  │  └──────────────── BOUNDARY 1 ─────────────────┘   │  │
│  │                                                     │  │
│  │  CLI core (commands, engine, helpers)               │  │
│  │  - Full Bun runtime access                          │  │
│  │  - Reads/writes ~/.archgate/ (cache)                │  │
│  │  - Credentials via OS credential manager            │  │
│  │  - Reads .archgate/adrs/ (project ADRs)             │  │
│  │                                                     │  │
│  └──────────────────── BOUNDARY 2 ────────────────────┘  │
│                                                          │
│  Project files (source code, configs)                    │
│  - Read by rules via RuleContext                         │
│  - Never modified by archgate check                      │
│                                                          │
└────────────────────── BOUNDARY 3 ────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │   NETWORK    │
                    │              │
                    │ GitHub Releases (binary downloads)
                    │ plugins.archgate.dev (plugin auth)
                    └─────────────┘
```

**Boundary 1 — Rule Sandbox:** `.rules.ts` files are untrusted code. They execute within a restricted context that blocks dangerous APIs and scopes file access to the project root.

**Boundary 2 — CLI Process:** The CLI itself runs with the user's permissions. It reads project files and manages its own cache directory (`~/.archgate/`). Authentication tokens are delegated to the OS credential manager. It does not require elevated privileges.

**Boundary 3 — Network:** Network access is only used for binary downloads (install/upgrade), plugin installation (authenticated), and optional anonymized telemetry. No analytics services are contacted. Core functionality (`archgate check`) is fully offline.

## 3. Secure Design Principles Applied

### 3.1 Least Privilege

- **Rule sandbox is read-only.** The `RuleContext` API exposes `readFile`, `readJSON`, `grep`, `grepFiles`, and `glob` — all read-only operations. Rules cannot write files, spawn processes, or access the network.
- **CI jobs use minimal permissions.** The documented CI configuration requests only `contents: read` — no secrets, deployment keys, or write permissions ([Security guide](https://cli.archgate.dev/guides/security/)).
- **Credentials are delegated to the OS.** Authentication tokens are stored in the operating system's credential manager (macOS Keychain, Windows Credential Manager, Linux secret service) — never written to disk as plain-text files.

### 3.2 Defense in Depth

Two independent layers protect against malicious rules:

1. **Static analysis security scanner** — Before any `.rules.ts` file is executed, the CLI parses its AST and rejects files containing dangerous patterns:
   - Imports of `node:fs`, `child_process`, `net`, `http`, `vm`, and other system modules
   - Bun-specific APIs: `Bun.spawn()`, `Bun.write()`, `Bun.file()`, `Bun.$`
   - Network access: `fetch()`
   - Code generation: `eval()`, `new Function()`
   - Obfuscation patterns: computed property access (`Bun[variable]`), `globalThis` assignment, dynamic `import()`

2. **Runtime sandbox** — Even if a pattern bypasses the static scanner, the `RuleContext` API enforces path scoping (blocks `../`, absolute paths, and symlinks) and a 30-second timeout per rule.

### 3.3 Input Validation

- **ADR frontmatter** is validated using [Zod](https://zod.dev/) schemas (`src/formats/adr.ts`). Malformed YAML is rejected with structured error messages.
- **CLI arguments** are validated by Commander.js with strict type checking (`@commander-js/extra-typings`).
- **File paths** in the `RuleContext` API are validated against path traversal before any read operation.

### 3.4 Fail-Safe Defaults

- **Telemetry is opt-in.** The `ARCHGATE_TELEMETRY` environment variable must be explicitly set to enable it. CI templates set it to `"0"` (disabled).
- **Strict TypeScript.** The project compiles with `strict: true`, catching null/undefined errors at compile time.
- **Exit codes are meaningful.** `0` = success, `1` = violations found, `2` = internal error. CI pipelines fail on any non-zero exit.

### 3.5 Minimal Attack Surface

- **Minimal dependencies.** The project follows [ARCH-006 (Dependency Policy)](/.archgate/adrs/ARCH-006-dependency-policy.md): prefer Bun built-ins over third-party packages. All runtime dependencies are bundled into the compiled binary — the npm package has zero runtime `dependencies`.
- **No daemon or server mode.** The CLI runs as a short-lived process. The MCP server uses stdio transport (no network listener).
- **No shell execution.** The CLI never spawns shell commands. Git operations use `git ls-files` via Bun's process API with explicit arguments (no shell interpolation).

## 4. Common Implementation Weaknesses Countered

### 4.1 Injection Attacks

| Vector | Countermeasure |
|--------|---------------|
| Command injection | No shell execution. Process spawning uses explicit argument arrays, not string concatenation. |
| Path traversal | `RuleContext` rejects `../`, absolute paths, and symlinks before any file read. |
| YAML injection | ADR frontmatter is parsed by a YAML library and validated through Zod schemas. No `eval` or template interpolation on YAML content. |
| Regex denial of service (ReDoS) | User-provided patterns in `grep`/`grepFiles` are passed to Bun's native regex engine with the 30-second rule timeout as a backstop. |

### 4.2 Supply Chain Risks

| Risk | Countermeasure |
|------|---------------|
| Compromised npm dependency | Minimal dependency tree. All dependencies are `devDependencies` bundled at build time. `bun.lock` pinned. |
| Tampered binary download | `archgate upgrade` verifies SHA256 checksums of downloaded binaries before extraction. Mismatches abort the upgrade. |
| Malicious GitHub Actions | All Actions in CI workflows use pinned commit SHAs (not floating tags). OpenSSF Scorecard runs weekly. |
| Typosquatting | The `archgate` npm package name is registered and controlled by the project. |

### 4.3 Information Disclosure

| Risk | Countermeasure |
|------|---------------|
| Credential leakage | Authentication tokens are stored in the OS credential manager (macOS Keychain, Windows Credential Manager, Linux secret service) — never written to disk as plain text. Tokens are never logged. Plugin install passes credentials via authenticated git URLs (not command-line arguments visible in `ps`). |
| Source code exposure | Rules are read-only. `archgate check` output contains only violation messages (file paths and line numbers), not file contents. |
| Error messages | Error output uses `logError()` (ARCH-002) which writes structured messages to stderr. Stack traces are only shown with `--verbose`. |

### 4.4 Availability

| Risk | Countermeasure |
|------|---------------|
| Runaway rules | 30-second wall-clock timeout per rule. Rules from different ADRs run in parallel but share no mutable state. |
| Large file processing | `RuleContext.readFile()` operates on individual files within the project scope. Glob patterns respect `.gitignore`. |
| Binary download failures | The npm thin shim retries downloads and falls back to cached binaries in `~/.archgate/bin/`. |

## 5. Verification

### 5.1 Automated Verification

- **CI pipeline** runs on every pull request: lint (Oxlint), typecheck (tsc --build), format check (Oxfmt), test suite (Bun test), ADR compliance check (`archgate check`), and build verification.
- **OpenSSF Scorecard** runs weekly via GitHub Actions, publishing results to the GitHub Security tab.
- **GitHub Security Advisories** are enabled for responsible vulnerability disclosure.
- **Pinned dependencies** — all GitHub Actions use commit SHA pins, not mutable tags.

### 5.2 Manual Verification

- All pull requests require review before merging.
- `.rules.ts` file changes are treated as security-sensitive in code review.
- The security guide at [cli.archgate.dev/guides/security](https://cli.archgate.dev/guides/security/) documents the trust model for contributors and users.

## 6. References

- [SECURITY.md](SECURITY.md) — Vulnerability reporting policy
- [Security Guide](https://cli.archgate.dev/guides/security/) — Full trust model and CI best practices
- [OpenSSF Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/archgate/cli) — Automated security analysis
- [ARCH-006: Dependency Policy](/.archgate/adrs/ARCH-006-dependency-policy.md) — Minimal dependency governance
- [CII Best Practices Badge](https://www.bestpractices.dev/projects/9981) — OpenSSF Best Practices compliance
