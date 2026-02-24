import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerClaudeCodeSessionContextTool } from "../../../src/mcp/tools/claude-code-session-context";

describe("registerClaudeCodeSessionContextTool", () => {
  let tempDir: string;
  let server: McpServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-session-context-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    server = new McpServer({ name: "test", version: "0.0.0" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering", () => {
    expect(() =>
      registerClaudeCodeSessionContextTool(server, tempDir)
    ).not.toThrow();
  });

  test("registers exactly one tool", () => {
    const registerSpy = spyOn(server, "registerTool");
    registerClaudeCodeSessionContextTool(server, tempDir);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    registerSpy.mockRestore();
  });
});
