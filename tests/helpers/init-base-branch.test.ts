// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initProject } from "../../src/helpers/init-project";
import { loadProjectConfig } from "../../src/helpers/project-config";
import { git, safeRmSync } from "../test-utils";

async function initGitRepoWithCommit(dir: string): Promise<void> {
  await git(["init", "--initial-branch=main"], dir);
  await git(["config", "user.email", "test@test.com"], dir);
  await git(["config", "user.name", "Test"], dir);
  writeFileSync(join(dir, "file.ts"), "export const x = 1;");
  await git(["add", "file.ts"], dir);
  await git(["commit", "-m", "init"], dir);
}

describe("initProject — baseBranch auto-detection", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initbase-test-"));
  });

  afterEach(() => {
    safeRmSync(tempDir);
  });

  test("saves detected baseBranch in config.json during init in a git repo", async () => {
    await initGitRepoWithCommit(tempDir);

    await initProject(tempDir);

    const configPath = join(tempDir, ".archgate", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = loadProjectConfig(tempDir);
    expect(config.baseBranch).toBe("main");
  }, 15_000);

  test("does not overwrite existing baseBranch on re-init", async () => {
    await initGitRepoWithCommit(tempDir);

    await initProject(tempDir);

    const configPath = join(tempDir, ".archgate", "config.json");
    const config = loadProjectConfig(tempDir);
    config.baseBranch = "develop";
    await Bun.write(configPath, JSON.stringify(config, null, 2) + "\n");

    await initProject(tempDir);

    const updatedConfig = loadProjectConfig(tempDir);
    expect(updatedConfig.baseBranch).toBe("develop");
  }, 15_000);

  test("does not save baseBranch when not in a git repo", async () => {
    await initProject(tempDir);

    const configPath = join(tempDir, ".archgate", "config.json");
    if (existsSync(configPath)) {
      const config = loadProjectConfig(tempDir);
      expect(config.baseBranch).toBeUndefined();
    }
  });
});
