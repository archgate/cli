import type { Command } from "@commander-js/extra-typings";
import { logError } from "../helpers/log";
import { findProjectRoot } from "../helpers/paths";
import { startStdioServer } from "../mcp/server";

export function registerMcpCommand(program: Command) {
  program
    .command("mcp")
    .description("Start MCP server for AI tool integration")
    .action(async () => {
      const projectRoot = findProjectRoot();
      if (!projectRoot) {
        logError(
          "No archgate project found. Run 'archgate init' to create one."
        );
        process.exit(1);
      }

      await startStdioServer(projectRoot);
    });
}
