import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMcpServer } from "../../src/mcp/server";

describe("createMcpServer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-server-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns an McpServer instance", () => {
    const server = createMcpServer(tempDir);
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  test("server has tool and resource registration methods", () => {
    const server = createMcpServer(tempDir);
    expect(typeof server.registerTool).toBe("function");
    expect(typeof server.registerResource).toBe("function");
  });
});
