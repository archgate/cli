# Linter Rules

This directory hosts linter-specific rules that enforce your ADRs at the linter level.

## Convention

Place linter plugin files here, named by tool:

- `oxlint.js` — Custom oxlint rules (JavaScript plugin)
- `eslint.js` — Custom ESLint rules
- `biome.js` — Custom Biome rules

## Usage with oxlint

1. Create `.archgate/lint/oxlint.js` exporting your plugin rules.
2. Load it with `jsPlugins` in your oxlint config, and turn its rules on under `rules`, prefixed with the plugin's `meta.name`:

```json
{
  "jsPlugins": ["./.archgate/lint/oxlint.js"],
  "rules": {
    "<plugin name>/<rule name>": "error"
  }
}
```

## Why here?

Archgate standardizes `.archgate/lint/` as the location for linter rules that complement ADR checks. This keeps governance artifacts together — ADRs in `adrs/`, linter rules in `lint/`.
