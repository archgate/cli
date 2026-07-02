// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { Command } from "@commander-js/extra-typings";

import { registerClaudeCodeSessionContextCommand } from "./claude-code";
import { registerCopilotSessionContextCommand } from "./copilot";
import { registerCursorSessionContextCommand } from "./cursor";
import { registerOpencodeSessionContextCommand } from "./opencode";

export function registerSessionContextCommand(program: Command) {
  const sessionContext = program
    .command("session-context")
    .description("Read AI editor session transcripts");

  registerClaudeCodeSessionContextCommand(sessionContext);
  registerCopilotSessionContextCommand(sessionContext);
  registerCursorSessionContextCommand(sessionContext);
  registerOpencodeSessionContextCommand(sessionContext);
}
