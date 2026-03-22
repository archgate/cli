import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cli.archgate.dev",
  integrations: [
    starlight({
      title: "Archgate",
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        "pt-br": { label: "Português (Brasil)", lang: "pt-BR" },
      },
      description:
        "Enforce Architecture Decision Records as executable rules — for both humans and AI agents.",
      customCss: ["./src/styles/custom.css"],
      expressiveCode: {
        // Use the pure-JS regex engine instead of the WASM-based oniguruma
        // engine. Bun's WASM support on Cloudflare Pages triggers a
        // "call_indirect to a null table entry" crash in oniguruma.
        shiki: { engine: "javascript" },
        // Disable Starlight's automatic UI color overrides so our
        // hand-picked colors from archgate.dev take full effect.
        useStarlightUiThemeColors: false,
        styleOverrides: {
          // ── Frame chrome — matches archgate.dev marketing site ───
          borderRadius: "0.75rem",
          borderColor: "#333",
          borderWidth: "1px",

          // ── Code area ───────────────────────────────────────────
          codeBackground: "#0f0f0f",
          codeFontFamily:
            '"SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
          codeFontSize: "0.85rem",
          codeLineHeight: "1.7",
          codePaddingBlock: "1.25rem",
          codePaddingInline: "1.35rem",

          // ── Scrollbar ───────────────────────────────────────────
          scrollbarThumbColor: "#333",
          scrollbarThumbHoverColor: "#555",

          // ── Frame-specific overrides ────────────────────────────
          frames: {
            // Editor tabs (file names)
            editorTabBarBackground: "#1a1a1a",
            editorTabBarBorderColor: "transparent",
            editorTabBarBorderBottomColor: "#333",
            editorActiveTabBackground: "#1a1a1a",
            editorActiveTabForeground: "#999",
            editorActiveTabBorderColor: "transparent",
            editorActiveTabIndicatorTopColor: "transparent",
            editorActiveTabIndicatorBottomColor: "transparent",
            editorBackground: "#0f0f0f",

            // Terminal title bar
            terminalTitlebarBackground: "#1a1a1a",
            terminalTitlebarForeground: "#555",
            terminalTitlebarBorderBottomColor: "#333",
            terminalTitlebarDotsForeground: "#555",
            terminalTitlebarDotsOpacity: "0.8",
            terminalBackground: "#0f0f0f",

            // Buttons (copy, etc.)
            inlineButtonBackground: "#333",
            inlineButtonForeground: "#999",
            inlineButtonBorder: "#555",

            // No shadow — flat design like the website
            frameBoxShadowCssValue: "none",

            // Tooltip
            tooltipSuccessBackground: "#4ade80",
            tooltipSuccessForeground: "#0f0f0f",
          },
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/archgate/cli",
        },
      ],
      components: { Head: "./src/components/HeadSEO.astro" },
      editLink: { baseUrl: "https://github.com/archgate/cli/edit/main/docs/" },
      favicon: "/favicon.svg",
      head: [
        // ── Favicon ───────────────────────────────────────────────
        {
          tag: "link",
          attrs: { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        },
        // ── Analytics ─────────────────────────────────────────────
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://static.cloudflareinsights.com/beacon.min.js",
            "data-cf-beacon": '{"token": "cee359c05ecc496aabc4f40f05302a03"}',
          },
        },
        // ── Open Graph ────────────────────────────────────────────
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        {
          tag: "meta",
          attrs: { property: "og:site_name", content: "Archgate" },
        },
        { tag: "meta", attrs: { property: "og:locale", content: "en_US" } },
        {
          tag: "meta",
          attrs: { property: "og:locale:alternate", content: "pt_BR" },
        },
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: "https://cli.archgate.dev/og-image.png",
          },
        },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content:
              "Archgate — Architecture Decision Records as Executable Rules",
          },
        },
        // ── Twitter / X card ──────────────────────────────────────
        {
          tag: "meta",
          attrs: { name: "twitter:card", content: "summary_large_image" },
        },
        {
          tag: "meta",
          attrs: {
            name: "twitter:image",
            content: "https://cli.archgate.dev/og-image.png",
          },
        },
        // ── Additional meta ───────────────────────────────────────
        { tag: "meta", attrs: { name: "author", content: "Archgate" } },
        { tag: "meta", attrs: { name: "theme-color", content: "#6366f1" } },
        {
          tag: "meta",
          attrs: {
            name: "keywords",
            content:
              "archgate, architecture decision records, ADR, executable rules, code governance, AI governance, TypeScript rules, CLI, compliance automation, MCP server",
          },
        },
        // ── JSON-LD: WebSite ──────────────────────────────────────
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: "Archgate CLI Documentation",
            url: "https://cli.archgate.dev",
            description:
              "Documentation for Archgate — enforce Architecture Decision Records as executable TypeScript rules for automated code governance.",
            inLanguage: ["en", "pt-BR"],
          }),
        },
        // ── JSON-LD: SoftwareApplication ──────────────────────────
        {
          tag: "script",
          attrs: { type: "application/ld+json" },
          content: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Archgate CLI",
            applicationCategory: "DeveloperApplication",
            applicationSubCategory: "Code Governance",
            operatingSystem: "macOS, Linux, Windows",
            softwareVersion: "0.20.0",
            license: "https://github.com/archgate/cli/blob/main/LICENSE",
            offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
            url: "https://cli.archgate.dev",
            downloadUrl: "https://www.npmjs.com/package/archgate",
            description:
              "CLI tool that enforces Architecture Decision Records (ADRs) as executable TypeScript rules for automated code governance.",
            author: {
              "@type": "Organization",
              name: "Archgate",
              url: "https://archgate.dev",
            },
          }),
        },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
          ],
        },
        {
          label: "Core Concepts",
          items: [
            { label: "Architecture Decision Records", slug: "concepts/adrs" },
            { label: "Rules", slug: "concepts/rules" },
            { label: "Domains", slug: "concepts/domains" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Writing ADRs", slug: "guides/writing-adrs" },
            { label: "Writing Rules", slug: "guides/writing-rules" },
            { label: "CI Integration", slug: "guides/ci-integration" },
            { label: "Claude Code Plugin", slug: "guides/claude-code-plugin" },
            { label: "VS Code Plugin", slug: "guides/vscode-plugin" },
            { label: "Copilot CLI Plugin", slug: "guides/copilot-cli-plugin" },
            { label: "Cursor Integration", slug: "guides/cursor-integration" },
            { label: "Pre-commit Hooks", slug: "guides/pre-commit-hooks" },
            { label: "Security", slug: "guides/security" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Commands", slug: "reference/cli-commands" },
            { label: "Rule API", slug: "reference/rule-api" },
            { label: "ADR Schema", slug: "reference/adr-schema" },
            { label: "Telemetry", slug: "reference/telemetry" },
          ],
        },
        {
          label: "Examples",
          collapsed: true,
          autogenerate: { directory: "examples" },
        },
      ],
    }),
  ],
});
