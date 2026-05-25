// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initProject } from "../../src/helpers/init-project";
import { git, safeRmSync } from "../test-utils";

describe("initProject — baseBranch auto-detection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initbase-test-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("saves detected baseBranch in config.json during init in a git repo", async () => {
    await git(["init", "--initial-branch=main"], tempDir);
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
    await git(["add", "file.ts"], tempDir);
    await git(["commit", "-m", "init"], tempDir);

    await initProject(tempDir);

    const configPath = join(tempDir, ".archgate", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(await Bun.file(configPath).text());
    expect(config.baseBranch).toBe("main");
  }, 15_000);

  test("does not overwrite existing baseBranch on re-init", async () => {
    await git(["init", "--initial-branch=main"], tempDir);
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    writeFileSync(join(tempDir, "file.ts"), "export const x = 1;");
    await git(["add", "file.ts"], tempDir);
    await git(["commit", "-m", "init"], tempDir);

    // First init saves baseBranch
    await initProject(tempDir);

    // Manually change baseBranch to a custom value
    const configPath = join(tempDir, ".archgate", "config.json");
    const config = JSON.parse(await Bun.file(configPath).text());
    config.baseBranch = "develop";
    await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");

    // Re-init should not overwrite the custom baseBranch
    await initProject(tempDir);

    const updatedConfig = JSON.parse(await Bun.file(configPath).text());
    expect(updatedConfig.baseBranch).toBe("develop");
  }, 15_000);

  test("does not save baseBranch when not in a git repo", async () => {
    await initProject(tempDir);

    const configPath = join(tempDir, ".archgate", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(await Bun.file(configPath).text());
      expect(config.baseBranch).toBeUndefined();
    }
  });
});
