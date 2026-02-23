import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../../src/mcp/tools/index";

describe("registerTools", () => {
  let tempDir: string;
  let server: McpServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-tools-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    server = new McpServer({ name: "test", version: "0.0.0" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering tools", () => {
    expect(() => registerTools(server, tempDir)).not.toThrow();
  });

  test("registers all expected tools", () => {
    const registerSpy = spyOn(server, "registerTool");
    registerTools(server, tempDir);
    // The tools module registers 4 tools: check, list_adrs, review_context, session_context
    expect(registerSpy).toHaveBeenCalledTimes(4);
    registerSpy.mockRestore();
  });
});
