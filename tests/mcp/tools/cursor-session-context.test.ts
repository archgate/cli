import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCursorSessionContextTool } from "../../../src/mcp/tools/cursor-session-context";

describe("registerCursorSessionContextTool", () => {
  let tempDir: string;
  let server: McpServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-cursor-session-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    server = new McpServer({ name: "test", version: "0.0.0" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering", () => {
    expect(() =>
      registerCursorSessionContextTool(server, tempDir)
    ).not.toThrow();
  });

  test("registers exactly one tool", () => {
    const registerSpy = spyOn(server, "registerTool");
    registerCursorSessionContextTool(server, tempDir);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    registerSpy.mockRestore();
  });
});
