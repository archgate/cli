import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildReviewContext } from "../../engine/context";
import { AdrFrontmatterSchema } from "../../formats/adr";

export function registerReviewContextTool(
  server: McpServer,
  projectRoot: string
) {
  server.registerTool(
    "review_context",
    {
      description:
        "Pre-compute review context for architecture validation. Returns changed files grouped by domain with applicable ADR briefings (Decision + Do's/Don'ts sections only) and optional check results. Use this instead of manually calling list_adrs + reading each ADR file.",
      inputSchema: {
        staged: z
          .boolean()
          .optional()
          .describe(
            "When true, only include git-staged files. When false (default), include all changed files (staged + unstaged)."
          ),
        runChecks: z
          .boolean()
          .optional()
          .describe(
            "When true, run automated ADR compliance checks and include results in the response."
          ),
        domain: AdrFrontmatterSchema.shape.domain
          .optional()
          .describe(
            "Filter results to a single domain (backend, frontend, data, architecture, general). When set, only briefings for that domain are returned."
          ),
      },
    },
    async ({ staged, runChecks, domain }) => {
      const context = await buildReviewContext(projectRoot, {
        staged: staged ?? false,
        runChecks: runChecks ?? false,
        domain: domain ?? undefined,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    }
  );
}
