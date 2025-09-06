import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadRuleAdrs } from "../../engine/loader";
import { runChecks } from "../../engine/runner";
import { buildSummary } from "../../engine/reporter";

export function registerCheckTool(server: McpServer, projectRoot: string) {
  server.registerTool(
    "check",
    {
      description: "Run ADR compliance checks against the codebase",
      inputSchema: {
        adrId: z
          .string()
          .optional()
          .describe("Only check a specific ADR by ID"),
        staged: z.boolean().optional().describe("Only check git-staged files"),
      },
    },
    async ({ adrId, staged }) => {
      const loadedAdrs = await loadRuleAdrs(projectRoot, adrId);

      if (loadedAdrs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                pass: true,
                total: 0,
                results: [],
                message: "No rules to check",
              }),
            },
          ],
        };
      }

      const result = await runChecks(projectRoot, loadedAdrs, {
        staged,
      });
      const summary = buildSummary(result, {
        maxViolationsPerRule: 20,
      });

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    }
  );
}
