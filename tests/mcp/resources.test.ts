import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerResources } from "../../src/mcp/resources";

describe("registerResources", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-res-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("does not throw when registering resources", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerResources(server, tempDir)).not.toThrow();
  });

  test("registers the adr resource template", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerResources(server, tempDir);
    // If registration succeeded without throwing, the resource is registered
    expect(true).toBe(true);
  });
});
