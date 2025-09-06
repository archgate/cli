import {
  type McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAdr } from "../formats/adr";

export function registerResources(server: McpServer, projectRoot: string) {
  const adrsDir = join(projectRoot, ".archgate", "adrs");

  // Resource template: adr://{id} — returns full ADR markdown
  server.registerResource(
    "adr",
    new ResourceTemplate("adr://{id}", { list: undefined }),
    { description: "Get full ADR markdown by ID" },
    async (uri, variables) => {
      const requestedId = variables.id as string;

      let files: string[];
      try {
        files = readdirSync(adrsDir).filter((f) => f.endsWith(".md"));
      } catch {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/plain",
              text: `ADR directory not found`,
            },
          ],
        };
      }

      for (const file of files) {
        try {
          const filePath = join(adrsDir, file);
          // oxlint-disable-next-line no-await-in-loop -- sequential file search
          const content = await Bun.file(filePath).text();
          const adr = parseAdr(content, filePath);
          if (adr.frontmatter.id === requestedId) {
            return {
              contents: [
                {
                  uri: uri.href,
                  mimeType: "text/markdown",
                  text: content,
                },
              ],
            };
          }
        } catch {
          // Skip unparseable
        }
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `ADR ${requestedId} not found`,
          },
        ],
      };
    }
  );
}
