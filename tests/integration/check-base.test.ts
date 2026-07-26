// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { git, safeRmSync } from "../test-utils";
import {
  runCli,
  createTempProject,
  scaffoldProject,
  writeAdr,
  writeRules,
  makeAdr,
} from "./cli-harness";

describe("check --base integration", () => {
  let dir: string;

  // Parallel tests (auth.test.ts, credential-store.test.ts) modify
  // Bun.env.HOME / GIT_CONFIG_GLOBAL which leaks into process.env.
  // Explicitly reset git env vars so the CLI subprocess sees a clean env.
  const gitCleanEnv = { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_GLOBAL: "" };

  beforeEach(() => {
    dir = createTempProject();
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("--base populates changedFiles for cross-file rules", async () => {
    scaffoldProject(dir);
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    // Write a cross-file rule: if config.yml changes, manifest.yml must also change
    mkdirSync(join(dir, "config"), { recursive: true });
    mkdirSync(join(dir, "deploy"), { recursive: true });
    writeFileSync(join(dir, "config", "database.yml"), "db: postgres\n");
    writeFileSync(join(dir, "deploy", "manifest.yml"), "version: 1\n");

    writeAdr(
      dir,
      "CROSS-001.md",
      makeAdr({ id: "CROSS-001", title: "Cross File Check", rules: true })
    );
    writeRules(
      dir,
      "CROSS-001.rules.ts",
      `export default {
  rules: {
    "config-requires-manifest": {
      description: "config change requires manifest bump",
      async check(ctx) {
        if (!ctx.changedFiles.includes("config/database.yml")) return;
        if (!ctx.changedFiles.includes("deploy/manifest.yml")) {
          ctx.report.violation({
            message: "config/database.yml changed but deploy/manifest.yml was not updated",
            file: "config/database.yml",
          });
        }
      },
    },
  },
};`
    );

    await git(["add", "."], dir);
    await git(["commit", "-m", "initial"], dir);

    // Create feature branch, change only config (not manifest)
    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "config", "database.yml"), "db: mysql\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "change config"], dir);

    // With --base main, the rule should fire (config changed, manifest didn't)
    const result = await runCli(
      ["check", "--base", "main", "--output", "json"],
      dir,
      gitCleanEnv
    );
    expect(result.exitCode).toBe(1);
    const json = JSON.parse(result.stdout);
    expect(json.pass).toBe(false);
    const violations = json.results.flatMap(
      (r: { violations: unknown[] }) => r.violations
    );
    expect(violations.length).toBeGreaterThan(0);
  }, 30_000);

  test("--base with no violations when both files change", async () => {
    scaffoldProject(dir);
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    mkdirSync(join(dir, "config"), { recursive: true });
    mkdirSync(join(dir, "deploy"), { recursive: true });
    writeFileSync(join(dir, "config", "database.yml"), "db: postgres\n");
    writeFileSync(join(dir, "deploy", "manifest.yml"), "version: 1\n");

    writeAdr(
      dir,
      "CROSS-002.md",
      makeAdr({ id: "CROSS-002", title: "Cross File Pass", rules: true })
    );
    writeRules(
      dir,
      "CROSS-002.rules.ts",
      `export default {
  rules: {
    "config-requires-manifest": {
      description: "config change requires manifest bump",
      async check(ctx) {
        if (!ctx.changedFiles.includes("config/database.yml")) return;
        if (!ctx.changedFiles.includes("deploy/manifest.yml")) {
          ctx.report.violation({
            message: "config/database.yml changed but deploy/manifest.yml was not updated",
            file: "config/database.yml",
          });
        }
      },
    },
  },
};`
    );

    await git(["add", "."], dir);
    await git(["commit", "-m", "initial"], dir);

    // Both files change on the feature branch — rule should pass
    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "config", "database.yml"), "db: mysql\n");
    writeFileSync(join(dir, "deploy", "manifest.yml"), "version: 2\n");
    await git(["add", "."], dir);
    await git(["commit", "-m", "change both"], dir);

    const result = await runCli(
      ["check", "--base", "main", "--output", "json"],
      dir,
      gitCleanEnv
    );
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.pass).toBe(true);
  }, 30_000);

  test("--staged takes precedence over auto-detection", async () => {
    scaffoldProject(dir);
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(join(dir, "config", "database.yml"), "db: postgres\n");

    writeAdr(
      dir,
      "STAGE-001.md",
      makeAdr({ id: "STAGE-001", title: "Stage Test", rules: true })
    );
    writeRules(
      dir,
      "STAGE-001.rules.ts",
      `export default {
  rules: {
    "check-changed": {
      description: "reports changedFiles count",
      async check(ctx) {
        if (ctx.changedFiles.length === 0) return;
        ctx.report.violation({
          message: "changedFiles has " + ctx.changedFiles.length + " file(s): " + ctx.changedFiles.join(", "),
          file: ctx.changedFiles[0],
        });
      },
    },
  },
};`
    );

    await git(["add", "."], dir);
    await git(["commit", "-m", "initial"], dir);
    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "config", "database.yml"), "db: mysql\n");

    // With --staged, only staged files are in changedFiles (none staged yet)
    const result = await runCli(
      ["check", "--staged", "--output", "json"],
      dir,
      gitCleanEnv
    );
    expect(result.exitCode).toBe(0);
    const json = JSON.parse(result.stdout);
    expect(json.pass).toBe(true);
  }, 30_000);
});
