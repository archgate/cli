# Linter Rules

This directory hosts linter-specific rules that enforce your ADRs at the linter level.

## Convention

Place linter plugin files here, named by tool:

- `oxlint.js` — Custom oxlint rules (JavaScript plugin)
- `eslint.js` — Custom ESLint rules
- `biome.js` — Custom Biome rules

## Usage with oxlint

1. Create `.archgate/lint/oxlint.js` exporting your plugin rules.
2. Reference it in your oxlint config:

```json
{
  "plugins": [".archgate/lint/oxlint.js"]
}
```

## Why here?

Archgate standardizes `.archgate/lint/` as the location for linter rules that complement ADR checks. This keeps governance artifacts together — ADRs in `adrs/`, linter rules in `lint/`.
