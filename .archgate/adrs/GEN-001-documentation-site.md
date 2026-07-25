---
id: GEN-001
title: Documentation Site
domain: general
rules: false
---

## Context

The Archgate CLI needs a public documentation site for users, contributors, and AI agents. A README and inline comments are insufficient for a project with multiple commands, a rule API, and editor integrations. Without a dedicated docs site:

1. **Discoverability is poor** — new users cannot browse guides, reference pages, or examples without reading source code
2. **Onboarding is slow** — contributors must reverse-engineer conventions from existing code rather than read a structured guide
3. **AI agents lack context** — coding assistants generate Archgate-compatible rules and configurations far better from well-structured reference documentation
4. **Information is scattered** — installation, API reference, and integration guides live across README, source comments, and planning docs with no unified navigation

**Alternatives considered:**

- **README-only** — no build tooling, but a single file cannot carry navigation or a structured multi-page experience across the CLI commands, Rule API, editor integrations, and guides Archgate must document
- **Docusaurus (React)** — mature and large ecosystem, but a React/Node.js runtime and dependency tree conflict with the project's Bun-first philosophy, and its configuration exceeds what this site needs
- **VitePress (Vue)** — lighter than Docusaurus, but still a framework runtime, less flexible for custom content, and its Markdown extensions are proprietary rather than standard MDX
- **Starlight (Astro)** — purpose-built for docs: standard MDX, runs under Bun via `bunx --bun astro`, static HTML with zero client-side JavaScript by default, built-in search (Pagefind), sidebar navigation, and dark mode, with components usable without framework lock-in

Starlight is the natural choice for Archgate: it aligns with the Bun-first toolchain ([ARCH-006](./ARCH-006-dependency-policy.md)), produces a fast static site, and its MDX format is familiar to the TypeScript developers who write Archgate rules.

## Decision

The documentation site MUST be an Astro 5 / Starlight project in the `docs/` directory. The docs site is a **separate concern** from the CLI codebase — it has its own `package.json`, `tsconfig.json`, `bun.lock`, and build pipeline. It does NOT participate in the CLI's `bun run validate` pipeline. Deployment is handled externally via Cloudflare Pages and is not managed by this repository.

**Scope:** the site's structure, tooling, and content organization. NOT the content itself (what to document) — that is editorial, not architectural.

**Technical stack:**

- **Framework:** Astro 5 with `@astrojs/starlight`
- **Content format:** MDX files in `docs/src/content/docs/`
- **Content API:** Astro 5 Content Layer with `docsLoader()` and `docsSchema()` in `docs/src/content.config.ts`
- **Build runtime:** Bun (`bunx --bun astro build`)
- **TypeScript:** extends `astro/tsconfigs/strict` (separate from the CLI tsconfig)

**Sidebar structure** follows five categories, each with its own path prefix:

- Getting Started (`getting-started/`) — installation and first-use walkthrough
- Core Concepts (`concepts/`) — ADRs, rules, and domains explained
- Guides (`guides/`) — how-to articles for specific tasks
- Reference (`reference/`) — exhaustive API and schema documentation
- Examples (`examples/`) — copy-pasteable code patterns

Every content page MUST appear both in the file system (`docs/src/content/docs/<category>/<slug>.mdx`) and in the sidebar configuration in `docs/astro.config.mjs`.

**Dependencies** are intentionally minimal: `astro` (static site generator), `@astrojs/starlight` (documentation integration), and `sharp` (image optimization). No CLI source dependencies (commander, zod, etc.) are permitted in `docs/package.json`.

## Do's and Don'ts

### Do

- **DO** use MDX format (`.mdx`) for all content pages in `docs/src/content/docs/`
- **DO** follow the 5-category sidebar structure: Getting Started, Core Concepts, Guides, Reference, Examples
- **DO** use the Astro 5 Content Layer API with `docsLoader()` and `docsSchema()` in `docs/src/content.config.ts`
- **DO** keep `docs/package.json` private with only `astro`, `@astrojs/starlight`, and `sharp` as dependencies
- **DO** use `bunx --bun astro` for all Astro commands (`dev`, `build`, `preview`) to run under Bun
- **DO** use root convenience scripts (`docs:dev`, `docs:build`, `docs:preview`) for docs commands run from the repository root
- **DO** escape curly braces in MDX template syntax (e.g. `adr://\{id\}`) — MDX interprets bare `{}` as JavaScript expressions
- **DO** add new pages to both the file system AND the sidebar in `docs/astro.config.mjs`
- **DO** keep reference pages accurate to CLI source code — update the corresponding reference docs in the same PR that changes a CLI API

### Don't

- **DON'T** add the docs build to the CLI `validate` pipeline — docs build failures MUST NOT block CLI development or CI
- **DON'T** share `tsconfig.json` with the CLI project — docs use `astro/tsconfigs/strict`, the CLI its own
- **DON'T** use bare `{}` in MDX content — always escape as `\{\}` for literal curly braces in prose or code fence labels
- **DON'T** add CLI source dependencies (`@commander-js/extra-typings`, `zod`, `@modelcontextprotocol/sdk`, `inquirer`) to `docs/package.json`
- **DON'T** create content files outside `docs/src/content/docs/` — `docsLoader()` expects exactly this directory structure
- **DON'T** use auto-generated content collections — Astro 5 requires an explicit `docs/src/content.config.ts` with `docsLoader()` and `docsSchema()`
- **DON'T** install `docs/` dependencies from the repository root — always `cd docs && bun install` or use the `docs:*` convenience scripts

## Implementation Pattern

### Directory Structure

```
docs/
  astro.config.mjs          # Starlight config, sidebar, site URL
  package.json              # Private, docs-only dependencies
  tsconfig.json             # Extends astro/tsconfigs/strict
  bun.lock                  # Docs-specific lockfile
  public/
  src/
    content.config.ts       # Astro 5 Content Layer registration
    content/
      docs/
        index.mdx           # Landing page (template: splash)
        getting-started/    # one directory per sidebar category:
        concepts/           # concepts, guides, reference, examples
        guides/
        reference/
        examples/
```

### Content Layer Configuration

```typescript
// docs/src/content.config.ts — Required for Astro 5
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

### Adding a New Page

Two changes are always required:

1. Create `docs/src/content/docs/<category>/<slug>.mdx` with `title` and `description` frontmatter.
2. Add it to the matching category's `items` array in `docs/astro.config.mjs`:

```javascript
{ label: "Page Title", slug: "category/slug" },
```

### MDX Curly Brace Escaping

MDX treats `{}` as JavaScript expressions, so `adr://{id}` fails at runtime with "id is not defined". Write `adr://\{id\}` to render literal braces.

## Consequences

### Positive

- **Single source of truth** — all user-facing documentation lives in one structured, navigable site rather than scattered across README, source comments, and planning docs
- **Search built-in** — Starlight integrates Pagefind for full-text search across all pages with zero configuration
- **Consistent with CLI toolchain** — built with Bun (`bunx --bun astro`), aligning with the Bun-first philosophy of [ARCH-006](./ARCH-006-dependency-policy.md)
- **AI-friendly structure** — agents can reference well-structured MDX pages for accurate code generation and understanding of how to interact with Archgate
- **Zero client-side JavaScript** — Astro renders static HTML by default; the site loads instantly without framework hydration
- **Portable output** — `bunx --bun astro build` produces a `docs/dist/` directory of static HTML deployable anywhere

### Negative

- **Separate dependency tree** — `docs/` has its own `node_modules`, `bun.lock`, and package versions to maintain independently from the CLI
- **Astro/Starlight learning curve** — documentation contributors must understand MDX syntax, Astro's Content Layer API, and Starlight's component library (CardGrid, Tabs, etc.)
- **Manual sidebar synchronization** — adding a page requires updating both the file system and `astro.config.mjs`; forgetting either yields a broken or invisible page

### Risks

- **Astro/Starlight breaking changes** — major version upgrades may change the Content Layer API, configuration format, or component interfaces.
  - **Mitigation:** `docs/package.json` pins both to major-version ranges, and upgrades are performed explicitly with full build verification. Astro follows semver and publishes migration guides for major releases.
- **Documentation drift from source code** — reference pages (CLI Commands, Rule API, ADR Schema) may fall out of sync as the CLI evolves.
  - **Mitigation:** The "DO keep reference pages accurate to CLI source code" rule requires docs updates in the same PR that changes CLI APIs. Code reviewers MUST verify this during review.

## Compliance and Enforcement

### Automated Enforcement

No automated rules are defined for this ADR (`rules: false`). Future opportunities include:

- A rule verifying that every MDX file in `docs/src/content/docs/` has a corresponding sidebar entry in `astro.config.mjs`
- A rule checking that `docs/package.json` does not contain CLI source dependencies
- i18n page parity checks are enforced by [GEN-002](./GEN-002-docs-i18n.md)

### Manual Enforcement

Code reviewers MUST verify during docs PRs:

1. New pages are added to both the file system and the sidebar configuration
2. MDX files use proper frontmatter (`title` and `description` fields)
3. Curly braces in prose are escaped (`\{\}`) when showing template syntax
4. Reference pages are updated when the corresponding CLI API changes
5. No CLI source dependencies are added to `docs/package.json`
6. The docs build succeeds locally (`bun run docs:build`) before merging

## References

- [Astro documentation](https://docs.astro.build) — Framework reference
- [Starlight documentation](https://starlight.astro.build) — Documentation integration reference
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Bun-first toolchain philosophy that extends to the docs build
- [GEN-002 — Documentation Internationalization](./GEN-002-docs-i18n.md) — i18n governance and 1:1 page parity rules
