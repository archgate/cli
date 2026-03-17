import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configureCopilotSettings } from "../../src/helpers/copilot-settings";

describe("configureCopilotSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-copilot-settings-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates .github/copilot/ dir when nothing exists", async () => {
    await configureCopilotSettings(tempDir);

    expect(existsSync(join(tempDir, ".github", "copilot"))).toBe(true);
  });

  test("does not create mcp.json", async () => {
    await configureCopilotSettings(tempDir);

    expect(existsSync(join(tempDir, ".github", "copilot", "mcp.json"))).toBe(
      false
    );
  });

  test("returns path to .github/copilot/ directory", async () => {
    const result = await configureCopilotSettings(tempDir);

    expect(result).toBe(join(tempDir, ".github", "copilot"));
  });
});
