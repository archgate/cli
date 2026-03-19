---
id: ARCH-010
title: Prefer Bun built-in JSON parsing
domain: architecture
rules: true
files: ["src/**/*.ts"]
---

## Context

Bun provides built-in JSON parsing via \`Bun.file(path).json()\` that is more ergonomic and consistent with other Bun file APIs (\`.text()\`, \`.arrayBuffer()\`, etc.) than the standard \`JSON.parse(await Bun.file(path).text())\` two-step pattern.

Using \`Bun.file().json()\` keeps the codebase consistent with ARCH-006 (prefer Bun built-ins) and avoids the intermediate string allocation.

**Alternatives considered:**

- **\`JSON.parse()\` with \`fs.readFileSync()\`** — Node.js pattern, not idiomatic Bun. Also synchronous.
- **\`JSON.parse(await Bun.file().text())\`** — Works but unnecessarily verbose. The \`.json()\` method does the same thing in one step.
- **\`Bun.JSONC.parse()\`** — For JSONC (JSON with comments) only. Use when the file may contain comments (e.g., \`tsconfig.json\`).

## Decision

Use \`Bun.file(path).json()\` for reading JSON files. Reserve \`JSON.parse()\` for parsing JSON from non-file sources (API responses, string variables, etc.).

## Do's and Don'ts

### Do

- Use \`await Bun.file("config.json").json()\` for reading JSON files
- Use \`Bun.JSONC.parse()\` when the file may contain comments (tsconfig, etc.)
- Use \`JSON.parse()\` for parsing JSON strings from non-file sources

### Don't

- Don't use \`JSON.parse(await Bun.file(path).text())\` — use \`.json()\` directly
- Don't use \`JSON.parse(fs.readFileSync(path, "utf-8"))\` — use Bun.file instead

## Consequences

### Positive

- Consistent with Bun idioms and ARCH-006 dependency policy
- Slightly less code per JSON read operation
- Avoids intermediate string allocation

### Negative

- Contributors familiar with Node.js may default to \`JSON.parse()\` out of habit

## Compliance and Enforcement

### Automated Enforcement

- **Archgate rule** \`ARCH-010/prefer-bun-json\`: Scans for \`JSON.parse(await Bun.file\` patterns in source files and flags them. Severity: \`warning\`.

### Manual Enforcement

Code reviewers should prefer \`Bun.file().json()\` over \`JSON.parse()\` for file reads during review.

## References

- [Bun.file() API](https://bun.sh/docs/api/file-io)
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Parent policy on preferring Bun built-ins
