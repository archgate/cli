import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListAdrsTool } from "../../../src/mcp/tools/list-adrs";

describe("registerListAdrsTool", () => {
  let tempDir: string;
  let server: McpServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-list-adrs-test-"));
    server = new McpServer({ name: "test", version: "0.0.0" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering", () => {
    expect(() => registerListAdrsTool(server, tempDir)).not.toThrow();
  });

  test("registers exactly one tool", () => {
    const registerSpy = spyOn(server, "registerTool");
    registerListAdrsTool(server, tempDir);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    registerSpy.mockRestore();
  });
});
