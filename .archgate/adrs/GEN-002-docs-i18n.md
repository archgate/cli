---
id: GEN-002
title: Documentation Internationalization
domain: general
rules: true
files: ["docs/**"]
---

## Context

Archgate targets a global developer audience, but the documentation site ([GEN-001](./GEN-001-documentation-site.md)) is English-only. Without internationalization:

1. **Non-English speakers are excluded** -- Developers more comfortable in other languages cannot fully benefit from guides, reference pages, and examples
2. **Community growth is limited** -- Open-source adoption in non-English markets depends on accessible documentation
3. **Translation efforts lack governance** -- Without structure, translations drift from the source language, pages get added without translations, and stale translations mislead users

Brazilian Portuguese and Norwegian Bokmål are translation targets.

**Alternatives considered:**

- **No i18n** -- Simplest to maintain, but excludes non-English speakers and becomes a barrier to international adoption.
- **External translation platform (Crowdin, Weblate)** -- Contributor UI, change detection, and automated PRs, but adds an external service dependency and account setup that is overkill when translations can be managed in-repo.
- **Runtime translation (i18next / Paraglide)** -- Key-based systems for application strings; a poor fit for long-form MDX prose and would require rewriting the content authoring approach.
- **Starlight built-in i18n** -- File-based locale directories under `docs/src/content/docs/<locale>/`, with automatic routing (`/pt-br/guides/...`), language switching, sidebar resolution, and fallback to the default locale. No additional dependencies.

Starlight's built-in i18n is the natural choice: zero new dependencies, a file-based workflow that fits the existing PR review process, and automatic UI features with minimal configuration.

## Decision

The documentation site MUST use Starlight's built-in i18n: `docs/astro.config.mjs` MUST declare `defaultLocale: "root"` with a `locales` configuration object.

**Root locale pattern:** English content stays at `docs/src/content/docs/` (no subdirectory) and serves URLs with no language prefix (`/getting-started/installation/`), preserving all existing English URLs. Each additional locale gets a subdirectory (`docs/src/content/docs/<locale>/`, e.g. `pt-br/`) and a URL prefix (`/pt-br/getting-started/installation/`).

**1:1 page parity:** Every MDX file in the root content directory MUST have a translation in each configured locale directory at the same relative path and filename, and every locale file MUST correspond to an existing root file -- orphan translations are violations.

**Same-PR updates:** Adding or modifying English content MUST update the corresponding locale files in the same pull request, preventing drift at the source.

**Translation scope:**

- **Translate:** page titles, descriptions, hero taglines, prose, headings, list items, table descriptions, admonition content, and user-visible text props in Starlight components (`<Card title>`, `<LinkCard description>`)
- **Keep in English:** code blocks, CLI commands, file paths, TypeScript identifiers, technical terms (ADR, CLI, MCP, CI/CD, glob, frontmatter), import statements, component names, `link`/`href`/`slug` attribute values

**Sidebar configuration:** The sidebar in `docs/astro.config.mjs` does NOT need per-locale duplication -- Starlight resolves sidebar `slug` entries per locale, so one configuration serves all languages.

**Configured locales:**

| Locale key | Label              | BCP 47 tag | URL prefix |
| ---------- | ------------------ | ---------- | ---------- |
| `root`     | English            | `en`       | _(none)_   |
| `pt-br`    | Portugues (Brasil) | `pt-BR`    | `/pt-br/`  |
| `nb`       | Norsk (Bokmål)     | `nb`       | `/nb/`     |

## Do's and Don'ts

### Do

- **DO** use Starlight's `defaultLocale: "root"` so English URLs have no language prefix
- **DO** name translated files with the same relative path as the English source (`pt-br/guides/writing-adrs.mdx` for `guides/writing-adrs.mdx`)
- **DO** translate all user-facing prose -- titles, descriptions, headings, paragraphs, list items, table text, admonition content -- and Starlight component text props
- **DO** keep code blocks, CLI commands, file paths, and technical identifiers in English
- **DO** keep internal link paths unchanged -- Starlight resolves locale-aware routing automatically
- **DO** preserve MDX curly-brace escaping (`\{\}`) per [GEN-001](./GEN-001-documentation-site.md) and keep component imports identical
- **DO** update translations in the same PR that modifies the English source
- **DO** use correct diacritical marks in Portuguese -- ã, ç, é, í, ó, ú, â, ê, ô, à are mandatory (`não` not `nao`, `código` not `codigo`)
- **DO** use Norwegian Bokmål (not Nynorsk), informal "du" form, and correct characters (æ, ø, å)
- **DO** update the `LOCALES` constant in the companion rules file when adding a new language

### Don't

- **DON'T** write Portuguese without diacritical marks -- unaccented Portuguese is grammatically incorrect and unprofessional (`execução` not `execucao`)
- **DON'T** leave pages untranslated without a tracking issue for the pending translation
- **DON'T** use machine translation without human review for technical accuracy
- **DON'T** translate code examples, TypeScript identifiers, CLI command names, or file paths
- **DON'T** create locale-specific sidebar configurations -- Starlight resolves the sidebar per locale
- **DON'T** add locale prefixes in internal links (use `/guides/...`, not `/pt-br/guides/...`)
- **DON'T** restructure the root locale content directory for translations -- translations mirror root
- **DON'T** add translation-only dependencies to `docs/package.json` -- Starlight's i18n needs none

## Consequences

### Positive

- **Broader international audience** -- Brazilian Portuguese and Norwegian speakers can read documentation in their language, lowering the barrier to adoption
- **Zero breaking changes** -- The root locale pattern preserves all existing English URLs; no redirects or link updates needed
- **Automatic language switching** -- Starlight renders a language switcher in the navigation with no custom code
- **Automated parity enforcement** -- The companion rules catch missing translations and orphan files before they reach production
- **Extensible to more languages** -- Adding a locale requires only a config entry, a constant update in the rules file, and the translated content files

### Negative

- **Multiplied content maintenance** -- Every content PR must update all locale files, increasing review scope
- **Translation quality depends on reviewers** -- The automated rules only check file existence and modification, not translation accuracy
- **Contributor friction** -- English-only contributors must still account for every locale, even if they add only a placeholder file

### Risks

- **Translation drift** -- Locale content may fall behind after significant English rewrites.
  - **Mitigation:** The same-PR policy catches most drift at review time, the 1:1 parity rule catches structural drift (added/removed pages), and periodic manual audits catch semantic drift within existing files.
- **Stale technical content** -- Reference pages (CLI Commands, Rule API) change frequently and translations may lag.
  - **Mitigation:** Reference pages are mostly code blocks and tables whose values stay in English, so only surrounding prose needs translation.
- **Incorrect translations misleading users** -- Machine-translated or poorly reviewed content may contain errors.
  - **Mitigation:** This ADR requires human review for all translations, and code blocks stay in English, eliminating the highest-risk errors (wrong commands, wrong API calls).

## Compliance and Enforcement

### Automated Enforcement

The companion rules file (`GEN-002-docs-i18n.rules.ts`) defines three rules:

- **`i18n-page-parity`** (severity: `error`) -- Verifies that every root MDX file has a corresponding translation in each configured locale directory, and that no orphan translations exist without a root source file. Runs as part of `archgate check`.
- **`i18n-translation-drift`** (severity: `error`) -- When running against a changeset (PR, staged files), verifies that a modified English docs file also has its corresponding locale file modified. Catches content drift within existing files that page-parity alone would miss.
- **`no-locale-prefix-in-links`** (severity: `error`) -- Verifies that locale pages do not use locale-prefixed internal links (e.g., `/pt-br/guides/...`). Starlight resolves locale routes automatically.

### Manual Enforcement

Code reviewers MUST verify during docs PRs:

1. Translated prose is accurate and reads naturally in the target language
2. Code blocks, CLI commands, and technical identifiers remain in English
3. Starlight component imports and structural MDX elements are preserved identically
4. Internal links do not include locale prefixes
5. New English pages include corresponding translations (or a tracking issue is linked)

## References

- [Starlight Internationalization Guide](https://starlight.astro.build/guides/i18n/) -- Official Starlight i18n documentation
- [GEN-001 -- Documentation Site](./GEN-001-documentation-site.md) -- Docs site structure, tooling, and content organization
- [ARCH-006 -- Dependency Policy](./ARCH-006-dependency-policy.md) -- No additional dependencies for i18n (Starlight built-in)
