import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckTool } from "./check";
import { registerListAdrsTool } from "./list-adrs";
import { registerReviewContextTool } from "./review-context";
import { registerSessionContextTool } from "./session-context";

export function registerTools(server: McpServer, projectRoot: string) {
  registerCheckTool(server, projectRoot);
  registerListAdrsTool(server, projectRoot);
  registerReviewContextTool(server, projectRoot);
  registerSessionContextTool(server, projectRoot);
}
