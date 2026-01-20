import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpServer } from "../../src/mcp/server";

describe("createMcpServer", () => {
  let tempDir: string;
  let server: McpServer;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-mcp-server-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    server = createMcpServer(tempDir);
  });

  afterEach(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns an McpServer instance", () => {
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  test("server has tool and resource registration methods", () => {
    expect(typeof server.registerTool).toBe("function");
    expect(typeof server.registerResource).toBe("function");
  });
});

describe("createMcpServer with null projectRoot", () => {
  let server: McpServer;

  beforeEach(() => {
    server = createMcpServer(null);
  });

  afterEach(async () => {
    await server.close();
  });

  test("starts successfully without a project root", () => {
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });
});
