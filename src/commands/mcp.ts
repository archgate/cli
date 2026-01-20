import type { Command } from "@commander-js/extra-typings";
import { findProjectRoot } from "../helpers/paths";
import { startStdioServer } from "../mcp/server";

export function registerMcpCommand(program: Command) {
  program
    .command("mcp")
    .description("Start MCP server for AI tool integration")
    .action(async () => {
      // Pass null when no project is found — the MCP server still starts and
      // tools will return an actionable no-project guidance response so the
      // agent can invoke @archgate:onboard to initialize governance.
      await startStdioServer(findProjectRoot());
    });
}
