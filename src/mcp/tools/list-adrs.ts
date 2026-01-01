import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAdr } from "../../formats/adr";

export function registerListAdrsTool(server: McpServer, projectRoot: string) {
  server.registerTool(
    "list_adrs",
    {
      description: "List all ADRs in the project",
      inputSchema: {
        domain: z
          .string()
          .optional()
          .describe(
            "Filter by domain (backend, frontend, data, architecture, general)"
          ),
      },
    },
    async ({ domain }) => {
      const adrsDir = join(projectRoot, ".archgate", "adrs");
      const adrs: Array<{
        id: string;
        title: string;
        domain: string;
        rules: boolean;
      }> = [];

      let files: string[];
      try {
        files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
      } catch {
        return {
          content: [{ type: "text" as const, text: JSON.stringify([]) }],
        };
      }

      for (const file of files) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- sequential file discovery
          const content = await Bun.file(join(adrsDir, file)).text();
          const adr = parseAdr(content, join(adrsDir, file));
          if (domain && adr.frontmatter.domain !== domain) continue;
          adrs.push({
            id: adr.frontmatter.id,
            title: adr.frontmatter.title,
            domain: adr.frontmatter.domain,
            rules: adr.frontmatter.rules,
          });
        } catch {
          // Skip unparseable
        }
      }

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(adrs, null, 2) },
        ],
      };
    }
  );
}
