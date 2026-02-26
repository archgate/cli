import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckTool } from "./check";
import { registerListAdrsTool } from "./list-adrs";
import { registerReviewContextTool } from "./review-context";
import { registerClaudeCodeSessionContextTool } from "./claude-code-session-context";
import { registerCursorSessionContextTool } from "./cursor-session-context";

export function registerTools(server: McpServer, projectRoot: string | null) {
  registerCheckTool(server, projectRoot);
  registerListAdrsTool(server, projectRoot);
  registerReviewContextTool(server, projectRoot);
  registerClaudeCodeSessionContextTool(server, projectRoot);
  registerCursorSessionContextTool(server, projectRoot);
}
