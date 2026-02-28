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
