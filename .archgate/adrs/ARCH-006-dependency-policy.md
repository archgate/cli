---
id: ARCH-006
title: Dependency Policy
domain: architecture
rules: true
files: ["package.json"]
---

## Context

Minimizing dependencies reduces supply chain risk, install size, and maintenance burden. Every production dependency is a trust relationship: the project trusts the dependency's maintainers, their CI/CD pipeline, and every transitive dependency in the tree. Supply chain attacks targeting popular npm packages (event-stream, ua-parser-js, colors.js) have demonstrated that this trust is frequently exploited.

Bun provides many built-in capabilities that eliminate the need for external packages — file I/O (`Bun.file`, `Bun.write`), HTTP server, shell commands (`Bun.$`), glob (`Bun.Glob`), TOML/YAML parsing, and testing. The fewer external packages in the dependency tree, the smaller the attack surface and the faster the install.

**Alternatives considered:**

- **Vendoring dependencies** — Copying dependency source code directly into the repository removes the supply chain risk but creates a maintenance burden: vendored code must be manually updated, and license compliance becomes the project's responsibility. Vendoring is appropriate for critical, stable dependencies but does not scale for the entire tree.
- **Lockfile auditing only** — Running `npm audit` or `bun audit` on the lockfile catches known vulnerabilities but does not prevent new, zero-day supply chain attacks. Auditing is a complement to dependency minimization, not a replacement.
- **Aggressive dependency adoption** — Using best-of-breed packages for every capability (chalk for colors, glob for file matching, zod for validation, etc.) maximizes developer ergonomics but balloons the dependency tree. Each package brings its own transitive dependencies, and any one of them can be compromised.

The project strikes a balance: use Bun built-ins wherever possible, maintain a short, explicit approved list for essential capabilities that Bun does not provide, and require justification for any additions.

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

Development dependencies (`devDependencies`) are less restricted but should still be minimal: linting (oxlint), formatting (prettier), commit conventions (commitlint), and type declarations only.

## Do's and Don'ts

### Do

- Use Bun built-ins for file I/O (`Bun.file`, `Bun.write`), HTTP, shell commands (`Bun.$`), glob (`Bun.Glob`), testing (`bun:test`)
- Justify any new production dependency in a PR description
- Keep `devDependencies` for tooling only (linting, formatting, commitlint)
- Review the transitive dependency tree before adding a package
- Prefer `node:` built-in modules (e.g., `node:util`, `node:path`, `node:fs`) over npm alternatives

### Don't

- Don't add dependencies for functionality Bun provides natively
- Don't use Node.js-specific APIs when Bun alternatives exist (e.g., use `Bun.file()` not `fs.readFile()` for simple reads)
- Don't add utility libraries for single functions (e.g., no lodash for `_.pick`)
- Don't use path aliases (`tsconfig paths`) — use relative imports with Bun's native module resolution
- Don't install packages globally in development — use `bunx` for one-off tools

## Implementation Pattern

### Good Example

```typescript
// File I/O — use Bun built-in
const content = await Bun.file("data.json").text();
await Bun.write("output.json", JSON.stringify(data));

// Glob — use Bun built-in
const glob = new Bun.Glob("src/**/*.ts");
const files = Array.from(glob.scanSync({ cwd: projectRoot }));

// Shell commands — use Bun built-in
const result = await Bun.$`git ls-files`.text();

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

- **Smaller install footprint** — Fewer packages mean faster `bun install` and smaller `node_modules` (or no `node_modules` with Bun's module resolution)
- **Fewer supply chain attack vectors** — Each removed dependency eliminates an entire trust chain. The approved list has been vetted for maintenance quality and security posture.
- **Faster startup** — Fewer modules to resolve and load at startup. Bun built-ins are loaded from the runtime binary, not from disk.
- **Simpler upgrades** — With fewer dependencies, `bun update` has fewer potential breaking changes to audit

### Negative

- **Bun built-in documentation is less comprehensive** — Some Bun APIs (`Bun.Glob`, `Bun.$`) have less documentation and fewer community examples than their npm counterparts (`glob`, `execa`). Contributors may need to reference Bun's source or test files.
- **Bun API surface may change** — Bun is actively developing and some APIs may change between minor versions. Pinning via `.prototools` mitigates but does not eliminate this risk.

### Risks

- **Bun API instability** — Bun built-in APIs (especially newer ones like `Bun.Glob`, `Bun.$`) may introduce breaking changes or behavioral differences between versions.
  - **Mitigation:** The project pins Bun version via `.prototools` (currently 1.3.8). API changes are caught during controlled upgrades with full test suite validation.
- **Bun built-in feature gaps** — Some functionality may be missing from Bun built-ins (e.g., advanced glob options, streaming HTTP edge cases). If a Bun built-in lacks a critical feature, the fallback is to add an approved dependency with full justification.
  - **Mitigation:** The approved dependency list exists precisely for this case. The threshold is "Bun cannot do this," not "Bun can do this but an npm package is slightly more convenient."
- **New dependency pressure from contributors** — Contributors may add packages out of habit without checking Bun alternatives.
  - **Mitigation:** The `ARCH-006/no-unapproved-deps` automated rule scans `package.json` and flags any production dependency not on the approved list. This blocks CI.

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
