import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerReviewContextTool } from "../../../src/mcp/tools/review-context";

describe("registerReviewContextTool", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-review-context-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerReviewContextTool(server, tempDir)).not.toThrow();
  });

  test("registers exactly one tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const registerSpy = spyOn(server, "registerTool");
    registerReviewContextTool(server, tempDir);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    registerSpy.mockRestore();
  });
});
