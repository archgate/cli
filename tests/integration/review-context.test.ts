// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git, safeRmSync } from "../test-utils";
import {
  runCli,
  scaffoldProject,
  writeAdr,
  writeRules,
  makeAdr,
} from "./cli-harness";

async function initGitRepo(dir: string): Promise<void> {
  await git(["init"], dir);
  await git(["config", "user.email", "test@test.com"], dir);
  await git(["config", "user.name", "Test"], dir);
}

async function commitAll(dir: string, message: string): Promise<void> {
  await git(["add", "."], dir);
  await git(["commit", "-m", message], dir);
}

describe("review-context integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-rc-integ-"));
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("outputs JSON review context with allChangedFiles and domains", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-001.md",
      makeAdr({
        id: "ARCH-001",
        title: "Architecture ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nUse a layered architecture.\n\n## Do's and Don'ts\nDo keep layers separate.",
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const { exitCode, stdout, stderr } = await runCli(["review-context"], dir);
    expect(exitCode).toBe(0);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error(`stdout is not valid JSON: ${stdout}\nstderr: ${stderr}`);
    }

    const ctx = parsed as Record<string, unknown>;
    expect(Array.isArray(ctx.allChangedFiles)).toBe(true);
    expect(Array.isArray(ctx.domains)).toBe(true);
  });

  test("filters output by --domain flag", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-010.md",
      makeAdr({
        id: "ARCH-010",
        title: "Arch ADR",
        domain: "architecture",
        rules: false,
      })
    );
    writeAdr(
      dir,
      "BE-010.md",
      makeAdr({
        id: "BE-010",
        title: "Backend ADR",
        domain: "backend",
        rules: false,
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");

    writeFileSync(join(dir, "changed.ts"), "export {};\n");

    const { exitCode, stdout } = await runCli(
      ["review-context", "--domain", "architecture"],
      dir
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as { domains: Array<{ domain: string }> };
    const domainNames = ctx.domains.map((d) => d.domain);
    // Assert non-empty first: `.every()` is vacuously true on an empty array, so
    // without this the test passes even when no domains are returned at all.
    expect(domainNames.length).toBeGreaterThan(0);
    expect(domainNames.every((d) => d === "architecture")).toBe(true);
    expect(domainNames).not.toContain("backend");
  });

  test("includes checkSummary with --run-checks", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "GEN-001.md",
      makeAdr({
        id: "GEN-001",
        title: "General Rule",
        domain: "general",
        rules: true,
      })
    );
    writeRules(
      dir,
      "GEN-001.rules.ts",
      `export default { rules: { "always-pass": { description: "Always passes", async check() {} } } };`
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");

    writeFileSync(join(dir, "modified.ts"), "export const y = 2;\n");

    const { exitCode, stdout } = await runCli(
      ["review-context", "--run-checks"],
      dir
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as Record<string, unknown>;
    expect(ctx.checkSummary).not.toBeNull();
    expect(typeof ctx.checkSummary).toBe("object");
  }, 60000);

  // ARCH-003 §7 end-to-end: these exercise the option plumbing through the real
  // CLI. The briefAdr/matchFilesToAdrs unit tests cover the leaf behavior, but
  // only these would catch buildReviewContext dropping the option on the floor.
  test("--run-checks omits cleanly-passing rules from checkSummary.results", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "GEN-001.md",
      makeAdr({
        id: "GEN-001",
        title: "General Rule",
        domain: "general",
        rules: true,
      })
    );
    writeRules(
      dir,
      "GEN-001.rules.ts",
      `export default { rules: { "always-pass": { description: "Always passes", async check() {} } } };`
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    writeFileSync(join(dir, "modified.ts"), "export const y = 2;\n");

    const { exitCode, stdout } = await runCli(
      ["review-context", "--run-checks"],
      dir
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as {
      checkSummary: { total: number; passed: number; results: unknown[] };
    };
    // The rule ran and passed — the counts say so, but it carries no findings,
    // so it must not occupy an entry in results.
    expect(ctx.checkSummary.total).toBe(1);
    expect(ctx.checkSummary.passed).toBe(1);
    expect(ctx.checkSummary.results).toEqual([]);
  }, 60000);

  test("omits ADR prose by default and includes it with --verbose", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-010.md",
      makeAdr({
        id: "ARCH-010",
        title: "Arch ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nUse the sentinel pattern.\n\n## Do's and Don'ts\n\n### Do\n- Follow it",
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    writeFileSync(join(dir, "changed.ts"), "export {};\n");

    type Ctx = {
      domains: Array<{ adrs: Array<{ id: string; decision?: string }> }>;
    };

    const lean = JSON.parse(
      (await runCli(["review-context"], dir)).stdout
    ) as Ctx;
    expect(lean.domains[0].adrs[0].id).toBe("ARCH-010");
    expect(lean.domains[0].adrs[0].decision).toBeUndefined();

    const full = JSON.parse(
      (await runCli(["review-context", "--verbose"], dir)).stdout
    ) as Ctx;
    expect(full.domains[0].adrs[0].decision).toContain("sentinel pattern");
  }, 60000);

  test("exits non-zero when no .archgate project found", async () => {
    const { exitCode, stderr } = await runCli(["review-context"], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("error");
  });

  test("--base populates allChangedFiles from branch diff", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-020.md",
      makeAdr({
        id: "ARCH-020",
        title: "Base Test ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nTest.\n\n## Do's and Don'ts\nDo test.",
      })
    );
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const x = 1;\n");
    await commitAll(dir, "initial commit");

    // Create feature branch and add a file
    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "src", "new-feature.ts"), "export const y = 2;\n");
    await commitAll(dir, "add feature");

    const { exitCode, stdout } = await runCli(
      ["review-context", "--base", "main"],
      dir,
      { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_GLOBAL: "" }
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as {
      allChangedFiles: string[];
      domains: Array<{ domain: string; changedFiles: string[] }>;
    };
    expect(ctx.allChangedFiles).toContain("src/new-feature.ts");
    expect(ctx.allChangedFiles).not.toContain("src/base.ts");
  }, 30_000);

  // Regression: archgate/cli#403 — with a base ref detected, review-context
  // only listed committed branch changes and silently omitted uncommitted
  // working-tree edits (the files actually under review in an agent session).
  test("--base includes uncommitted working-tree changes (regression archgate/cli#403)", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-022.md",
      makeAdr({
        id: "ARCH-022",
        title: "Working Tree ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nTest.\n\n## Do's and Don'ts\nDo test.",
      })
    );
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const x = 1;\n");
    await commitAll(dir, "initial commit");

    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "src", "committed.ts"), "export const c = 3;\n");
    await commitAll(dir, "committed change");

    // Uncommitted edit to a tracked file + a brand-new untracked file —
    // the typical state of an AI-agent dev session before any commit.
    writeFileSync(join(dir, "src", "base.ts"), "export const x = 99;\n");
    writeFileSync(join(dir, "src", "untracked.ts"), "export const u = 5;\n");

    const { exitCode, stdout } = await runCli(
      ["review-context", "--base", "main"],
      dir,
      { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_GLOBAL: "" }
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as { allChangedFiles: string[] };
    expect(ctx.allChangedFiles).toContain("src/committed.ts");
    expect(ctx.allChangedFiles).toContain("src/base.ts");
    expect(ctx.allChangedFiles).toContain("src/untracked.ts");
  }, 30_000);

  test("--staged takes precedence over --base for review-context", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-021.md",
      makeAdr({
        id: "ARCH-021",
        title: "Staged Test ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nTest.\n\n## Do's and Don'ts\nDo test.",
      })
    );
    await git(["init", "--initial-branch=main"], dir);
    await git(["config", "user.email", "test@test.com"], dir);
    await git(["config", "user.name", "Test"], dir);

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "base.ts"), "export const x = 1;\n");
    await commitAll(dir, "initial commit");

    await git(["checkout", "-b", "feature"], dir);
    writeFileSync(join(dir, "src", "committed.ts"), "export const c = 3;\n");
    await commitAll(dir, "committed change");

    // Stage a different file (not committed yet)
    writeFileSync(join(dir, "src", "staged.ts"), "export const s = 4;\n");
    await git(["add", "src/staged.ts"], dir);

    // --staged should only show staged.ts, not committed.ts
    const { exitCode, stdout } = await runCli(
      ["review-context", "--staged"],
      dir,
      { GIT_CONFIG_NOSYSTEM: "", GIT_CONFIG_GLOBAL: "" }
    );
    expect(exitCode).toBe(0);

    const ctx = JSON.parse(stdout) as { allChangedFiles: string[] };
    expect(ctx.allChangedFiles).toContain("src/staged.ts");
    expect(ctx.allChangedFiles).not.toContain("src/committed.ts");
  }, 30_000);
});
