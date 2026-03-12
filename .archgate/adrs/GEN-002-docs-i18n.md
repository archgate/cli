---
id: GEN-002
title: Documentation Internationalization
domain: general
rules: true
files: ["docs/**"]
---

## Context

Archgate targets a global developer audience, but the documentation site ([GEN-001](./GEN-001-documentation-site.md)) is English-only. Without internationalization:

1. **Non-English speakers are excluded** -- Developers who are more comfortable in other languages cannot fully benefit from guides, reference pages, and examples
2. **Community growth is limited** -- Open-source adoption in non-English markets depends on accessible documentation
3. **Translation efforts lack governance** -- Without structure, translations drift from the source language, pages get added without corresponding translations, and stale translations mislead users

Brazilian Portuguese is the first translation target. The Starlight documentation framework already provides built-in i18n support with locale-based routing, automatic language switching, and fallback behavior.

**Alternatives considered:**

- **No i18n** -- Keeps maintenance simple but excludes non-English speakers entirely. As Archgate grows internationally, this becomes a significant barrier to adoption.
- **External translation platform (Crowdin, Weblate)** -- Provides a translation management workflow with contributor UI, change detection, and automated PR creation. However, it adds an external service dependency, requires account setup, and is overkill when the team can manage translations directly in the repository.
- **Runtime translation (i18next / Paraglide)** -- Key-based translation systems designed for application strings. Poor fit for long-form MDX documentation where content is authored as prose, not message keys. Would require a complete rewrite of the content authoring approach.
- **Starlight built-in i18n** -- Uses file-based locale directories under `docs/src/content/docs/<locale>/`. Starlight automatically handles routing (`/pt-br/guides/...`), language switching, sidebar resolution, and fallback to the default locale for untranslated pages. No additional dependencies required.

Starlight's built-in i18n is the natural choice: zero new dependencies, file-based workflow that fits the existing PR review process, and automatic UI features (language switcher, locale-aware routing) with minimal configuration.

## Decision

The documentation site MUST use Starlight's built-in i18n with English as the root locale and additional languages in subdirectories under `docs/src/content/docs/<locale>/`. The `docs/astro.config.mjs` MUST declare `defaultLocale: "root"` with a `locales` configuration object.

**Root locale pattern:**

English content stays at `docs/src/content/docs/` (no subdirectory) and serves URLs without a language prefix (e.g., `/getting-started/installation/`). This preserves all existing English URLs with zero breaking changes. Each additional locale gets a subdirectory (e.g., `docs/src/content/docs/pt-br/`) and a URL prefix (e.g., `/pt-br/getting-started/installation/`).

**1:1 page parity:**

Every MDX file in the root content directory MUST have a corresponding translation file in each configured locale directory, with the same relative path and filename. Conversely, every locale file MUST correspond to an existing root file -- orphan translations are violations. This ensures complete coverage and prevents stale or dangling pages.

**Same-PR updates:**

When adding or modifying English content, the corresponding locale files MUST be updated in the same pull request. This prevents translation drift at the source.

**Translation scope:**

- **Translate:** Page titles, descriptions, hero taglines, prose, headings, list items, table descriptions, admonition content, and user-visible text props in Starlight components (`<Card title="...">`, `<LinkCard description="...">`)
- **Keep in English:** Code blocks, CLI commands, file paths, TypeScript identifiers, technical terms (ADR, CLI, MCP, CI/CD, glob, frontmatter), import statements, component names, `link`/`href`/`slug` attribute values

**Sidebar configuration:**

The sidebar in `docs/astro.config.mjs` does NOT need per-locale duplication. Starlight resolves sidebar `slug` entries to the appropriate locale automatically. A single sidebar configuration serves all languages.

**Configured locales:**

| Locale key | Label              | BCP 47 tag | URL prefix |
| ---------- | ------------------ | ---------- | ---------- |
| `root`     | English            | `en`       | _(none)_   |
| `pt-br`    | Portugues (Brasil) | `pt-BR`    | `/pt-br/`  |

## Do's and Don'ts

### Do

- **DO** use Starlight's `defaultLocale: "root"` pattern so English URLs have no language prefix
- **DO** create translated files with the exact same relative path and filename as the English source (e.g., `pt-br/guides/writing-adrs.mdx` for `guides/writing-adrs.mdx`)
- **DO** translate all user-facing prose: titles, descriptions, headings, paragraphs, list items, table text, and admonition content
- **DO** translate text props in Starlight components (`title`, `description` in `<Card>` and `<LinkCard>`)
- **DO** keep code blocks, CLI commands, file paths, and technical identifiers in English
- **DO** keep internal link paths unchanged -- Starlight handles locale-aware routing automatically (e.g., `/getting-started/installation/` resolves correctly in both English and Portuguese)
- **DO** preserve MDX curly-brace escaping (`\{\}`) in translations, following [GEN-001](./GEN-001-documentation-site.md)
- **DO** preserve Starlight component import statements identically in translated files
- **DO** update translations in the same PR that modifies the English source content
- **DO** update the `LOCALES` constant in the companion rules file when adding a new language

### Don't

- **DON'T** leave pages untranslated without a tracking issue explaining when the translation will be added
- **DON'T** use machine translation without human review for technical accuracy
- **DON'T** translate code examples, TypeScript identifiers, CLI command names, or file paths
- **DON'T** create locale-specific sidebar configurations -- Starlight handles sidebar resolution per locale automatically
- **DON'T** add locale prefixes in internal links (e.g., don't use `/pt-br/guides/...` -- use `/guides/...` and let Starlight resolve it)
- **DON'T** modify the root locale content directory structure to accommodate translations -- translations mirror the root structure
- **DON'T** add translation-only dependencies to `docs/package.json` -- Starlight's built-in i18n requires no additional packages

## Consequences

### Positive

- **Broader international audience** -- Brazilian Portuguese speakers can read documentation in their language, lowering the barrier to adoption
- **Zero breaking changes** -- The root locale pattern preserves all existing English URLs; no redirects or link updates needed
- **Automatic language switching** -- Starlight renders a language switcher in the navigation with no custom code
- **Automated parity enforcement** -- The companion rule catches missing translations and orphan files before they reach production
- **Extensible to more languages** -- Adding a new locale requires only a config entry, a constant update in the rules file, and the translated content files

### Negative

- **Doubled content maintenance** -- Every content PR must update both English and Portuguese files, increasing review scope
- **Translation quality depends on reviewers** -- The automated rule only checks file existence, not translation accuracy or completeness
- **Contributor friction** -- Contributors who only speak English must still account for the Portuguese translation (even if they only add a placeholder file)

### Risks

- **Translation drift** -- Portuguese content may fall behind after significant English rewrites.
  - **Mitigation:** The same-PR policy catches most drift at review time. The 1:1 parity rule catches structural drift (added/removed pages). Periodic manual audits can catch semantic drift within existing files.
- **Stale technical content** -- Reference pages (CLI Commands, Rule API) change frequently and translations may lag.
  - **Mitigation:** Reference pages contain mostly code blocks and tables with technical values that remain in English. Only surrounding prose needs translation, reducing the update surface.
- **Incorrect translations misleading users** -- Machine-translated or poorly reviewed content may contain errors.
  - **Mitigation:** The ADR explicitly requires human review for all translations. Code blocks stay in English, eliminating the highest-risk translation errors (wrong commands, wrong API calls).

## Compliance and Enforcement

### Automated Enforcement

The companion rules file (`GEN-002-docs-i18n.rules.ts`) defines one rule:

- **`i18n-page-parity`** (severity: `error`) -- Verifies that every root MDX file has a corresponding translation in each configured locale directory, and that no orphan translations exist without a root source file. Runs as part of `archgate check`.

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
