import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

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
      editLink: {
        baseUrl: "https://github.com/archgate/cli/edit/main/docs/",
      },
      head: [
        {
          tag: "script",
          attrs: {
            defer: true,
            src: "https://static.cloudflareinsights.com/beacon.min.js",
            "data-cf-beacon": '{"token": "cee359c05ecc496aabc4f40f05302a03"}',
          },
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
            {
              label: "Architecture Decision Records",
              slug: "concepts/adrs",
            },
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
            {
              label: "Claude Code Plugin",
              slug: "guides/claude-code-plugin",
            },
            {
              label: "Cursor Integration",
              slug: "guides/cursor-integration",
            },
            { label: "MCP Server", slug: "guides/mcp-server" },
            {
              label: "Pre-commit Hooks",
              slug: "guides/pre-commit-hooks",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "CLI Commands", slug: "reference/cli-commands" },
            { label: "MCP Tools", slug: "reference/mcp-tools" },
            { label: "Rule API", slug: "reference/rule-api" },
            { label: "ADR Schema", slug: "reference/adr-schema" },
          ],
        },
        {
          label: "Examples",
          items: [
            {
              label: "Common Rule Patterns",
              slug: "examples/common-rule-patterns",
            },
          ],
        },
      ],
    }),
  ],
});
