import type { Command } from "@commander-js/extra-typings";
import { registerClaudeCodeSessionContextCommand } from "./claude-code";
import { registerCursorSessionContextCommand } from "./cursor";

export function registerSessionContextCommand(program: Command) {
  const sessionContext = program
    .command("session-context")
    .description("Read AI editor session transcripts");

  registerClaudeCodeSessionContextCommand(sessionContext);
  registerCursorSessionContextCommand(sessionContext);
}
