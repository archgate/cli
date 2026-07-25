---
id: ARCH-006
title: Dependency Policy
domain: architecture
rules: true
files: ["package.json"]
---

## Context

Minimizing dependencies reduces supply chain risk, install size, and maintenance burden. Every production dependency is a trust relationship — with the package's maintainers, their CI/CD pipeline, and every transitive dependency in the tree. Supply chain attacks on popular npm packages (event-stream, ua-parser-js, colors.js) show that this trust is frequently exploited.

Bun provides built-ins that eliminate the need for external packages: file I/O (`Bun.file`, `Bun.write`), HTTP server, subprocess execution (`Bun.spawn`), glob (`Bun.Glob`), TOML/YAML parsing, and testing. Fewer external packages means a smaller attack surface and a faster install.

> **Note on `Bun.$` (Bun shell):** The `Bun.$` template literal API hangs on Windows because the shell subprocess does not properly close stdin/stdout pipes, deadlocking the process. This project uses `Bun.spawn` (array-based, no shell) exclusively for subprocess execution — see [ARCH-007 — Cross-Platform Subprocess Execution](./ARCH-007-cross-platform-subprocess-execution.md).

**Alternatives considered:**

- **Vendoring dependencies** — Removes the supply chain risk but shifts manual updates and license compliance onto the project; workable for a few critical, stable packages, not for the whole tree.
- **Lockfile auditing only** — `npm audit`/`bun audit` catch known vulnerabilities but not zero-day supply chain attacks; a complement to minimization, not a replacement.
- **Aggressive dependency adoption** — Best-of-breed packages for every capability (chalk, glob, etc.) maximize ergonomics but balloon the tree, and any transitive package can be compromised.

The project balances these: Bun built-ins wherever possible, a short explicit approved list for capabilities Bun does not provide, and justification required for any addition.

## Decision

Keep production dependencies minimal. Prefer Bun built-ins over external packages. The approved production dependency list is:

| Package                       | Purpose             | Why Not Built-in                                                   |
| ----------------------------- | ------------------- | ------------------------------------------------------------------ |
| `@commander-js/extra-typings` | CLI framework       | Bun has no built-in CLI argument parsing with subcommand support   |
| `inquirer`                    | Interactive prompts | Bun has no built-in interactive prompt library                     |
| `zod`                         | Schema validation   | Used for ADR frontmatter validation; no built-in schema validation |

**Adding a new dependency requires:**

1. Explicit justification in the PR description explaining why a Bun built-in cannot serve the purpose
2. Review of the package's dependency tree size, maintenance status, and download count
3. Approval by the project maintainer

Development dependencies (`devDependencies`) are less restricted but should still be minimal: linting (oxlint), formatting (oxfmt), commit conventions (commitlint), and type declarations only.

## Do's and Don'ts

### Do

- **DO** use Bun built-ins for file I/O (`Bun.file`, `Bun.write`), HTTP, subprocess execution (`Bun.spawn`), glob (`Bun.Glob`), testing (`bun:test`)
- **DO** use `Bun.spawn` with array-based arguments for all subprocess execution — it works correctly on macOS, Linux, and Windows
- **DO** justify any new production dependency in a PR description
- **DO** keep `devDependencies` for tooling only (linting, formatting, commitlint)
- **DO** review the transitive dependency tree before adding a package
- **DO** prefer `node:` built-in modules (e.g., `node:util`, `node:path`, `node:fs`) over npm alternatives

### Don't

- **DON'T** use `Bun.$` (Bun shell template literals) for subprocess execution — it hangs on Windows due to pipe handling issues
- **DON'T** add dependencies for functionality Bun provides natively
- **DON'T** use Node.js-specific APIs when Bun alternatives exist (e.g., `Bun.file()` not `fs.readFile()` for simple reads)
- **DON'T** add utility libraries for single functions (e.g., no lodash for `_.pick`)
- **DON'T** use path aliases (`tsconfig paths`) — use relative imports with Bun's native module resolution
- **DON'T** install packages globally in development — use `bunx` for one-off tools

## Implementation Pattern

### Good Example

```typescript
// File I/O — use Bun built-in
const content = await Bun.file("data.json").text();
await Bun.write("output.json", JSON.stringify(data));

// Glob — use Bun built-in
const glob = new Bun.Glob("src/**/*.ts");
const files = Array.from(glob.scanSync({ cwd: projectRoot }));

// Subprocess execution — use Bun.spawn (cross-platform, no shell)
const proc = Bun.spawn(["git", "ls-files"], { stdout: "pipe", stderr: "pipe" });
const result = await new Response(proc.stdout).text();
await proc.exited;

// Colors — use node:util built-in (not chalk)
import { styleText } from "node:util";
console.log(styleText("red", "Error: something failed"));
```

### Bad Example

```typescript
// BAD: using fs when Bun.file is available
import { readFile } from "node:fs/promises";
const content = await readFile("data.json", "utf-8");

// BAD: installing glob package when Bun.Glob exists
import { glob } from "glob";
const files = await glob("src/**/*.ts");

// BAD: using chalk when styleText is available
import chalk from "chalk";
console.log(chalk.red("Error"));

// BAD: lodash for a single utility
import { pick } from "lodash";
const subset = pick(obj, ["a", "b"]);
```

## Consequences

### Positive

- **Smaller install footprint** — Fewer packages mean faster `bun install` and smaller `node_modules`
- **Fewer supply chain attack vectors** — Each avoided dependency removes an entire trust chain; the approved list is vetted for maintenance quality and security posture
- **Faster startup** — Fewer modules to resolve and load; Bun built-ins ship inside the runtime binary
- **Simpler upgrades** — `bun update` has fewer potential breaking changes to audit

### Negative

- **Bun built-in documentation is less comprehensive** — `Bun.Glob` and `Bun.spawn` have fewer docs and community examples than `glob` or `execa`, so contributors may need Bun's source or test files.
- **Bun API surface may change** — Bun develops actively and APIs can shift between minor versions. Pinning via `.prototools` mitigates but does not eliminate this.

### Risks

- **Bun API instability** — Newer built-ins (`Bun.Glob`, `Bun.spawn`) may introduce breaking changes or behavioral differences between versions; `Bun.$` is avoided outright for Windows pipe deadlocks.
  - **Mitigation:** The project pins the Bun version via `.prototools`; API changes surface during controlled upgrades with full test suite validation.
- **Bun built-in feature gaps** — A built-in may lack a critical feature (advanced glob options, streaming HTTP edge cases).
  - **Mitigation:** Add an approved dependency with full justification. The threshold is "Bun cannot do this," not "Bun can do this but an npm package is slightly more convenient."
- **New dependency pressure from contributors** — Packages get added out of habit without checking Bun alternatives.
  - **Mitigation:** The `ARCH-006/no-unapproved-deps` rule scans `package.json` and flags any production dependency not on the approved list. This blocks CI.

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** `ARCH-006/no-unapproved-deps`: Reads `package.json`, extracts `dependencies`, and flags any package not on the approved list. Severity: `error` (hard blocker).

### Manual Enforcement

Code reviewers MUST verify:

1. No new production dependencies are added without justification
2. Bun built-ins are preferred over npm packages where available
3. `devDependencies` additions are for tooling only

## References

- [Bun built-in APIs documentation](https://bun.sh/docs)
- [ARCH-003 — Output Formatting](./ARCH-003-output-formatting.md) — Applies this policy to color libraries (no chalk, use `node:util`)
- [ARCH-004 — No Barrel Files](./ARCH-004-no-barrel-files.md) — Aligns with minimal-dependency philosophy; direct imports reduce hidden coupling
