---
id: GEN-001
title: Documentation Site
domain: general
rules: false
---

## Context

The Archgate CLI needs a public documentation site for users, contributors, and AI agents. A README and inline code comments are insufficient for a project with multiple commands, an MCP server, a rule API, and editor integrations. Without a dedicated docs site:

1. **Discoverability is poor** — New users cannot browse guides, reference pages, or examples without reading source code
2. **Onboarding is slow** — Contributors must reverse-engineer conventions from existing code rather than reading a structured guide
3. **AI agents lack context** — AI coding assistants benefit from well-structured reference documentation when generating Archgate-compatible rules and configurations
4. **Information is scattered** — Installation instructions, API reference, and integration guides live in different places (README, source comments, planning docs) with no unified navigation

**Alternatives considered:**

- **README-only documentation** — Keeping all documentation in `README.md` is simple and requires no build tooling. However, README files become unwieldy beyond 500 lines, lack navigation, and cannot provide the structured multi-page experience users expect from a CLI tool. The Archgate README would need to cover 9 CLI commands, 5 MCP tools, a full Rule API, 3 editor integrations, and multiple guides — far too much for a single file.
- **Docusaurus (React-based)** — A mature documentation framework with a large ecosystem. However, Docusaurus is built on React and requires Node.js, adding a heavyweight runtime and dependency tree that conflicts with the project's Bun-first philosophy. Its configuration is more complex than needed for a documentation site of this scope.
- **VitePress (Vue-based)** — A fast, Vue-powered documentation generator. While lighter than Docusaurus, it still requires a framework runtime (Vue) and has less flexibility for custom content than Astro. Its Markdown extensions are proprietary rather than standard MDX.
- **Starlight (Astro-based)** — An Astro integration purpose-built for documentation sites. It uses standard MDX, runs under Bun via `bunx --bun astro`, produces static HTML with zero client-side JavaScript by default, and provides built-in search (Pagefind), sidebar navigation, and dark mode. Its component-based architecture allows embedding interactive elements without framework lock-in.

For Archgate, Starlight is the natural choice: it aligns with the project's Bun-first toolchain ([ARCH-006](./ARCH-006-dependency-policy.md)), produces a fast static site suitable for GitHub Pages, and its MDX format is familiar to TypeScript developers who already write Archgate rules.

## Decision

The documentation site MUST be an Astro 5 / Starlight project in the `docs/` directory, deployed to `cli.archgate.dev` via GitHub Pages. The docs site is a **separate concern** from the CLI codebase — it has its own `package.json`, `tsconfig.json`, `bun.lock`, and build pipeline. It does NOT participate in the CLI's `bun run validate` pipeline.

**Scope:** This ADR covers the documentation site's structure, tooling, content organization, and deployment. It does NOT cover the content itself (what to document) — that is an editorial decision, not an architectural one.

**Technical stack:**

- **Framework:** Astro 5 with `@astrojs/starlight` integration
- **Content format:** MDX files in `docs/src/content/docs/`
- **Content API:** Astro 5 Content Layer with `docsLoader()` and `docsSchema()` in `docs/src/content.config.ts`
- **Build runtime:** Bun (`bunx --bun astro build`)
- **Deployment:** GitHub Actions → GitHub Pages (custom domain via `CNAME` in `docs/public/`)
- **TypeScript:** Extends `astro/tsconfigs/strict` (separate from CLI tsconfig)

**Sidebar structure** follows five categories:

| Category        | Path prefix        | Purpose                                 |
| --------------- | ------------------ | --------------------------------------- |
| Getting Started | `getting-started/` | Installation and first-use walkthrough  |
| Core Concepts   | `concepts/`        | ADRs, rules, and domains explained      |
| Guides          | `guides/`          | How-to articles for specific tasks      |
| Reference       | `reference/`       | Exhaustive API and schema documentation |
| Examples        | `examples/`        | Copy-pasteable code patterns            |

Every content page MUST appear in both the file system (`docs/src/content/docs/<category>/<slug>.mdx`) and the sidebar configuration in `docs/astro.config.mjs`.

**Dependencies** are intentionally minimal:

| Package              | Purpose                   |
| -------------------- | ------------------------- |
| `astro`              | Static site generator     |
| `@astrojs/starlight` | Documentation integration |
| `sharp`              | Image optimization        |

No CLI source dependencies (commander, zod, etc.) are permitted in `docs/package.json`.

## Do's and Don'ts

### Do

- **DO** use MDX format (`.mdx`) for all content pages in `docs/src/content/docs/`
- **DO** follow the 5-category sidebar structure: Getting Started, Core Concepts, Guides, Reference, Examples
- **DO** use the Astro 5 Content Layer API with `docsLoader()` and `docsSchema()` in `docs/src/content.config.ts`
- **DO** keep `docs/package.json` private with only `astro`, `@astrojs/starlight`, and `sharp` as dependencies
- **DO** use `bunx --bun astro` for all Astro commands (`dev`, `build`, `preview`) to run under the Bun runtime
- **DO** place the `CNAME` file in `docs/public/` for GitHub Pages custom domain resolution
- **DO** use root convenience scripts (`docs:dev`, `docs:build`, `docs:preview`) when running docs commands from the repository root
- **DO** escape curly braces in MDX when showing template syntax (e.g., `adr://\{id\}`) — MDX interprets bare `{}` as JavaScript expressions
- **DO** add new pages to both the file system AND the sidebar configuration in `docs/astro.config.mjs`
- **DO** keep reference pages accurate to CLI source code — when CLI APIs change, update the corresponding reference docs in the same PR

### Don't

- **DON'T** add the docs build to the CLI `validate` pipeline — docs build failures MUST NOT block CLI development or CI
- **DON'T** share `tsconfig.json` with the CLI project — the docs site uses `astro/tsconfigs/strict`, the CLI uses its own TypeScript configuration
- **DON'T** use bare `{}` in MDX content — always escape as `\{\}` when showing literal curly braces in prose or code fence labels
- **DON'T** add CLI source dependencies (`@commander-js/extra-typings`, `zod`, `@modelcontextprotocol/sdk`, `inquirer`) to `docs/package.json`
- **DON'T** modify the `deploy-docs.yml` workflow to use Node instead of Bun — the project standardizes on Bun for all build tooling
- **DON'T** create content files outside `docs/src/content/docs/` — Starlight expects this exact directory structure via `docsLoader()`
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
    CNAME                   # cli.archgate.dev
  src/
    content.config.ts       # Astro 5 Content Layer registration
    content/
      docs/
        index.mdx           # Landing page (template: splash)
        getting-started/
          installation.mdx
          quick-start.mdx
        concepts/
          adrs.mdx
          rules.mdx
          domains.mdx
        guides/
          writing-adrs.mdx
          writing-rules.mdx
          ci-integration.mdx
          claude-code-plugin.mdx
          cursor-integration.mdx
          mcp-server.mdx
          pre-commit-hooks.mdx
        reference/
          cli-commands.mdx
          mcp-tools.mdx
          rule-api.mdx
          adr-schema.mdx
        examples/
          common-rule-patterns.mdx
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

When adding a new documentation page, two changes are always required:

1. Create the MDX file at `docs/src/content/docs/<category>/<slug>.mdx` with frontmatter:

```mdx
---
title: Page Title
description: Brief description for search engines and social cards.
---

Content here...
```

2. Add the page to the sidebar in `docs/astro.config.mjs`:

```javascript
{
  label: "Category Name",
  items: [
    // existing items...
    { label: "Page Title", slug: "category/slug" },
  ],
}
```

### MDX Curly Brace Escaping

MDX treats `{}` as JavaScript expressions. When documenting template-style syntax, escape the braces:

```mdx
<!-- BAD: causes "id is not defined" runtime error -->

The resource URI format is `adr://{id}`.

<!-- GOOD: renders literal curly braces -->

The resource URI format is `adr://\{id\}`.
```

## Consequences

### Positive

- **Single source of truth** — All user-facing documentation lives in one structured, navigable site rather than scattered across README, source comments, and planning docs
- **Search built-in** — Starlight integrates Pagefind for full-text search across all documentation pages with zero configuration
- **Consistent with CLI toolchain** — Built with Bun (`bunx --bun astro`), aligning with the project's Bun-first philosophy established in [ARCH-006](./ARCH-006-dependency-policy.md)
- **AI-friendly structure** — AI agents can reference well-structured MDX pages for accurate code generation; the MCP server guide documents how agents interact with Archgate
- **Zero client-side JavaScript** — Astro renders static HTML by default; the docs site loads instantly without framework hydration overhead
- **Automatic deployment** — The `deploy-docs.yml` workflow deploys on every merge to `main` that touches `docs/`, with no manual steps

### Negative

- **Separate dependency tree** — The `docs/` directory has its own `node_modules`, `bun.lock`, and package versions that must be maintained independently from the CLI
- **Astro/Starlight learning curve** — Contributors editing documentation must understand MDX syntax, Astro's Content Layer API, and Starlight's component library (CardGrid, Tabs, etc.)
- **Manual sidebar synchronization** — Adding a new page requires updating both the file system and `astro.config.mjs`; forgetting either results in a broken or invisible page

### Risks

- **Astro/Starlight breaking changes** — Major version upgrades to Astro or Starlight may change the Content Layer API, configuration format, or component interfaces.
  - **Mitigation:** Dependencies are pinned to major versions (`astro@^5`, `@astrojs/starlight@^0.34`). Upgrades are performed explicitly with full build verification. Astro follows semver and publishes migration guides for major releases.
- **Documentation drift from source code** — Reference pages (CLI Commands, Rule API, MCP Tools, ADR Schema) may fall out of sync as the CLI evolves.
  - **Mitigation:** The "DO keep reference pages accurate to CLI source code" rule requires docs updates in the same PR that changes CLI APIs. Code reviewers MUST verify this during review.
- **GitHub Pages deployment failures** — Build or deployment failures in `deploy-docs.yml` may leave stale documentation live.
  - **Mitigation:** The workflow uses `workflow_dispatch` for manual re-deployment. Build failures are visible in the Actions tab. The docs build is isolated from CLI CI, so docs failures never block CLI releases.

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

### Deployment

The `deploy-docs.yml` GitHub Actions workflow handles deployment:

- **Trigger:** Push to `main` with changes in `docs/**`, or manual `workflow_dispatch`
- **Build:** `moonrepo/setup-toolchain@v0` → `bun install --frozen-lockfile` → `bunx --bun astro build`
- **Deploy:** `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` to GitHub Pages
- **Custom domain:** `docs/public/CNAME` contains `cli.archgate.dev`

## References

- [Astro documentation](https://docs.astro.build) — Framework reference
- [Starlight documentation](https://starlight.astro.build) — Documentation integration reference
- [ARCH-006 — Dependency Policy](./ARCH-006-dependency-policy.md) — Bun-first toolchain philosophy that extends to the docs build
- [GEN-002 — Documentation Internationalization](./GEN-002-docs-i18n.md) — i18n governance and 1:1 page parity rules
- [deploy-docs.yml](../../.github/workflows/deploy-docs.yml) — GitHub Actions deployment workflow
