# Archgate Distribution Plan

## Overview

Archgate is distributed as **two separate artifacts** through distinct channels:

| Artifact           | What it is                                        | Distribution                    | Requires Bun?        |
| ------------------ | ------------------------------------------------- | ------------------------------- | -------------------- |
| **`archgate` CLI** | Standalone binary — the governance engine         | Shell script, Homebrew          | No                   |
| **`archgate` npm** | Rules authoring library — `defineRules()` + types | npm (`bun add -d` / `npm i -D`) | Yes (authoring only) |

The **CLI** is a Bun single-file executable compiled with `bun build --compile`. It embeds the full Bun runtime (~55-60MB) so users install a single file with no runtime dependency. It is **not** distributed via npm.

The **npm package** is a library for architects and agents to author ADR rules. It provides `defineRules()`, `RuleContext`, `RuleConfig`, and other TypeScript types. It has no `bin` field — it is not a CLI.

The **Claude Code plugin** lives in a separate repository (`archgate/claude-code-plugin`) with its own distribution service and closed beta access control. See that repo for plugin distribution details.

---

## 1. Binary Compilation

### Targets

| Platform     | Target flag        | Binary name             | Users               |
| ------------ | ------------------ | ----------------------- | ------------------- |
| macOS ARM    | `bun-darwin-arm64` | `archgate-darwin-arm64` | macOS Apple Silicon |
| Linux x86_64 | `bun-linux-x64`    | `archgate-linux-x64`    | Linux, WSL2         |

### Build command

```bash
bun build --compile --bytecode --minify \
  --target=bun-darwin-arm64 \
  src/cli.ts \
  --outfile=dist/archgate-darwin-arm64

bun build --compile --bytecode --minify \
  --target=bun-linux-x64 \
  src/cli.ts \
  --outfile=dist/archgate-linux-x64
```

- `--bytecode`: Moves parsing to build-time for ~1.38x faster startup
- `--minify`: Reduces bundle size slightly
- Binary includes: Bun runtime + all `src/` code + all production deps (Commander, Zod, MCP SDK, inquirer)

### Size expectations

~55-60MB per binary. Acceptable for a governance tool downloaded once. For context: Bun itself is ~55MB, Deno is ~60-80MB.

---

## 2. npm Package (Rules Authoring Library)

### Purpose

The `archgate` npm package is a **library** — not a CLI. It provides everything architects and AI agents need to author `.rules.ts` files:

- `defineRules()` function (type-safe rule definition)
- `RuleContext`, `RuleConfig`, `RuleReport`, `Severity` TypeScript types
- Full autocompletion and type checking in editors

### Install

```bash
bun add -d archgate     # or: npm install -D archgate
```

### What ships on npm

```
archgate (npm)
├── src/
│   └── formats/
│       └── rules.ts     # Source: defineRules() + type definitions
├── dist/
│   └── types/           # Type declarations (.d.ts)
└── package.json
```

No CLI code ships. No `bin` field. No bundled JS. Just the rules authoring surface.

### Package.json for publishing

```json
{
  "exports": {
    "./rules": "./src/formats/rules.ts"
  },
  "files": ["src/formats/rules.ts", "dist/types/"]
}
```

- `exports` → the rules SDK entry point
- `files` → allowlist ensures only the library ships (no CLI source, no commands, no engine)
- No `bin` field — the CLI is distributed as a standalone binary, not via npm

### How it works with the binary

Users author `.rules.ts` files that import from the npm package:

```typescript
// .archgate/adrs/ARCH-001-command-structure.rules.ts
import { defineRules } from "archgate/rules";

export default defineRules({
  "my-rule": {
    description: "...",
    check: async (ctx) => {
      /* ... */
    },
  },
});
```

When the `archgate` binary runs `archgate check`, it dynamically imports the `.rules.ts` file. The embedded Bun runtime resolves `archgate/rules` by walking up from the file's directory → finds `node_modules/archgate/` → resolves the export. **No special handling needed — standard module resolution.**

### Why this works

1. The compiled binary's embedded Bun runtime handles TypeScript transpilation of external files
2. Module resolution walks `node_modules/` from the imported file's location — standard behavior
3. The `archgate` npm package exports `./rules` pointing to the source TypeScript
4. The existing `import()` call with cache-busting in `loader.ts` keeps working as-is

### Release pipeline

The existing `release.yml` workflow handles npm publishing via `@simple-release/npm`. The npm package version is kept in sync with the binary version (same repo, same conventional commits, same semver).

### Self-dogfooding

The project's own `.rules.ts` files currently use relative imports (`../../src/formats/rules`). This works in development. For consistency, we could switch to `archgate/rules` via `bun link`. Not a blocker — both resolve to the same module.

### Relationship between artifacts

| User scenario                | npm package (devDep) | Binary (CLI) |
| ---------------------------- | -------------------- | ------------ |
| Author `.rules.ts` files     | Required             | Not needed   |
| Run `archgate check`         | Not needed           | Required     |
| Run `archgate init`          | Not needed           | Required     |
| Full workflow (author + run) | Required             | Required     |

---

## 3. Install Script

### URL

```
https://archgate.dev/install
```

Redirects to the raw script from GitHub (or served directly from archgate.dev).

### Behavior

```bash
curl -fsSL https://archgate.dev/install | sh
```

The script:

1. Detects OS (`uname -s`): Darwin or Linux
2. Detects architecture (`uname -m`): arm64/aarch64 or x86_64
3. Resolves to the correct binary name (`archgate-darwin-arm64` or `archgate-linux-x64`)
4. Fetches latest release tag from GitHub API (`https://api.github.com/repos/archgate/cli/releases/latest`)
5. Downloads the binary from GitHub Releases
6. Installs to `~/.archgate/bin/archgate` (creates dir if needed)
7. Makes executable (`chmod +x`)
8. Adds `~/.archgate/bin` to PATH via shell profile (`.bashrc`, `.zshrc`)
9. Prints success message with version

### Version pinning

```bash
curl -fsSL https://archgate.dev/install | sh -s -- --version 1.0.0
```

### Uninstall

```bash
rm -rf ~/.archgate/bin/archgate
# Remove the PATH line from shell profile
```

---

## 4. Homebrew Tap

### Repository

`archgate/homebrew-tap` on GitHub.

### Formula

```ruby
class Archgate < Formula
  desc "AI governance for software development"
  homepage "https://archgate.dev"
  version "X.Y.Z"

  on_macos do
    on_arm do
      url "https://github.com/archgate/cli/releases/download/vX.Y.Z/archgate-darwin-arm64"
      sha256 "..."
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/archgate/cli/releases/download/vX.Y.Z/archgate-linux-x64"
      sha256 "..."
    end
  end

  def install
    binary_name = if OS.mac? && Hardware::CPU.arm?
      "archgate-darwin-arm64"
    else
      "archgate-linux-x64"
    end
    bin.install binary_name => "archgate"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/archgate --version")
  end
end
```

### Usage

```bash
brew install archgate/tap/archgate
brew upgrade archgate/tap/archgate
```

### Auto-update

The release CI updates the Homebrew formula automatically when a new version is published.

---

## 5. Self-Update (`archgate upgrade`)

### Behavior

The `upgrade` command downloads the latest binary from GitHub Releases:

1. Detect current platform from runtime (`process.platform` + `process.arch`)
2. Fetch latest release info from GitHub API (`https://api.github.com/repos/archgate/cli/releases/latest`)
3. Compare current version with latest
4. If newer version available:
   a. Download the correct binary to a temp file
   b. Verify the download (size check, optional checksum)
   c. Replace the current binary with the new one
   d. Print success message with old → new version

### Version check on startup

On every CLI invocation, check for updates in the background (non-blocking):

- Cache the last check timestamp in `~/.archgate/last-update-check`
- Only check once per 24 hours
- If a newer version exists, print a one-line notice after command output

---

## 6. CI/CD Pipeline

### New workflow: `.github/workflows/release-binaries.yml`

Triggered when the existing release workflow publishes a new version (or triggered manually).

```yaml
name: Release Binaries

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "Release tag (e.g., v1.0.0)"
        required: true

jobs:
  build:
    strategy:
      matrix:
        include:
          - target: bun-darwin-arm64
            artifact: archgate-darwin-arm64
            os: macos-latest
          - target: bun-linux-x64
            artifact: archgate-linux-x64
            os: ubuntu-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: moonrepo/setup-toolchain@v0
        with:
          auto-install: true
      - run: bun install --frozen-lockfile
      - run: bun run validate
      - name: Compile binary
        run: |
          bun build --compile --bytecode --minify \
            --target=${{ matrix.target }} \
            src/cli.ts \
            --outfile=dist/${{ matrix.artifact }}
      - name: Upload to release
        uses: softprops/action-gh-release@v2
        with:
          files: dist/${{ matrix.artifact }}

  update-homebrew:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Update Homebrew formula
        # Update sha256 hashes and version in archgate/homebrew-tap
        run: |
          # Fetch binary checksums and update formula
          # Push to archgate/homebrew-tap repo
```

### Build matrix notes

- macOS binary MUST be built on `macos-latest` for code signing compatibility
- Linux binary can be built on `ubuntu-latest`
- Cross-compilation (building linux binary from macOS) is possible but native builds are preferred for CI reliability

---

## 7. Build Scripts

### New scripts

```json
{
  "scripts": {
    "build": "bun run scripts/build.ts",
    "build:darwin": "bun build --compile --bytecode --minify --target=bun-darwin-arm64 src/cli.ts --outfile=dist/archgate-darwin-arm64",
    "build:linux": "bun build --compile --bytecode --minify --target=bun-linux-x64 src/cli.ts --outfile=dist/archgate-linux-x64"
  }
}
```

### Build script (`scripts/build.ts`)

A TypeScript build script that:

1. Cleans `dist/`
2. Compiles both binary targets
3. Generates checksums (`sha256`)
4. Prints binary sizes

### .gitignore

Add `dist/` to `.gitignore` (compiled binaries should never be committed).

---

## 8. Plugin Separation (`archgate/claude-code-plugin`)

The Claude Code plugin has moved to a separate repository: `archgate/claude-code-plugin`. That repo contains:

- Plugin files (agents, skills, settings, MCP config)
- Distribution service (Bun + Hono virtual git server for closed beta)
- Its own release pipeline and versioning

### What stays in this repo (`archgate/cli`)

- `src/helpers/claude-settings.ts` — configures `.claude/settings.local.json` to enable plugin permissions during `archgate init`. This is project-level configuration, not the plugin itself.
- `src/mcp/` — the MCP server that the plugin connects to. The plugin's `.mcp.json` references the `archgate` binary.

### What moves out

- `plugin/` directory (agents, skills, settings, .mcp.json, plugin.json)
- `docs/05-plugin-distribution-plan.md` (lives in the new repo)

### CLI repo cleanup (when new repo is ready)

- [ ] Remove `plugin/` directory
- [ ] Update `CLAUDE.md`: remove plugin directory references, note separate repo
- [ ] Update `docs/01-strategic-plan.md`: reference `archgate/claude-code-plugin`
- [ ] Update `docs/02-tactical-plan.md`: reference `archgate/claude-code-plugin`
- [ ] Update `docs/03-technical-plan.md`: remove plugin directory layout, reference separate repo
- [ ] Update `CONTRIBUTING.md`: remove plugin from project structure
- [ ] Update `.archgate/adrs/ARCH-004`: remove `plugin/` exclusion clause

---

## 9. Implementation Phases

### Phase 0: POC (Validate assumptions)

- [ ] Compile archgate binary with `bun build --compile`
- [ ] In a test project with `archgate` as devDependency, create a `.rules.ts` file
- [ ] Run the compiled binary's `check` command — confirm dynamic `import()` resolves `archgate/rules` from `node_modules/`
- [ ] Verify on macOS ARM and Linux x64
- [ ] Measure binary size

### Phase 1: Build infrastructure

- [ ] Add `scripts/build.ts` build script
- [ ] Add build scripts to `package.json`
- [ ] Add `dist/` to `.gitignore`
- [ ] Update `package.json`: remove `bin`, update `files` to library-only allowlist

### Phase 2: Plugin separation

- [ ] Create `archgate/claude-code-plugin` repository
- [ ] Move `plugin/` directory to new repo
- [ ] Clean up CLI repo references (see section 8 checklist)

### Phase 3: Self-update

- [ ] Rewrite `src/commands/upgrade.ts` for binary self-update via GitHub Releases
- [ ] Add GitHub Release API integration
- [ ] Add version check on startup (background, 24h cache)

### Phase 4: Install script

- [ ] Write `scripts/install.sh`
- [ ] Host at `https://archgate.dev/install`
- [ ] Test on macOS ARM, Ubuntu x64, WSL2

### Phase 5: Homebrew

- [ ] Create `archgate/homebrew-tap` repository
- [ ] Write Homebrew formula
- [ ] Add CI step to auto-update formula on release

### Phase 6: CI pipeline

- [ ] Create `.github/workflows/release-binaries.yml`
- [ ] Integrate with existing release workflow
- [ ] Verify end-to-end: commit → release → binary + npm library publish

---

## Open Questions

1. **Code signing**: Should macOS binaries be signed and notarized? (Unsigned binaries trigger Gatekeeper warnings)
2. **Linux musl**: Should we also produce a `linux-x64-musl` binary for Alpine/Docker?
3. **Checksums**: SHA-256 file alongside binaries on GitHub Releases?
