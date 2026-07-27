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

describe("review-context --strict integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-rc-strict-"));
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("fails when a briefing was truncated", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-001.md",
      makeAdr({
        id: "ARCH-001",
        title: "Architecture ADR",
        domain: "architecture",
        rules: false,
        body: `## Decision\n${"A".repeat(5000)}\n\n## Do's and Don'ts\nDo keep layers separate.`,
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const { exitCode, stderr } = await runCli(
      ["review-context", "--verbose", "--strict"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--strict");
  });

  test("passes when nothing was truncated and --run-checks was not used", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-001.md",
      makeAdr({
        id: "ARCH-001",
        title: "Architecture ADR",
        domain: "architecture",
        rules: false,
        body: "## Decision\nShort.\n\n## Do's and Don'ts\nDo it.",
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const { exitCode } = await runCli(
      ["review-context", "--verbose", "--strict"],
      dir
    );
    expect(exitCode).toBe(0);
  });

  test("fails via --run-checks when a rule warning is found", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "GEN-001.md",
      makeAdr({ id: "GEN-001", title: "Warns", domain: "general", rules: true })
    );
    writeRules(
      dir,
      "GEN-001.rules.ts",
      `export default { rules: { "soft-rule": { description: "Emits a warning", async check(ctx) { for (const file of ctx.scopedFiles) { ctx.report.warning({ message: "soft warning", file }); } } } } };`
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    writeFileSync(join(dir, "modified.ts"), "export const y = 2;\n");

    const { exitCode, stderr } = await runCli(
      ["review-context", "--run-checks", "--strict"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--strict");
  }, 60000);

  // Deliberate scope boundary: review-context is not a second full
  // compliance gate. Even under --strict, an ordinary rule violation
  // (error severity) must not fail this command — `check` remains the
  // gate for that.
  test("does not fail on an ordinary rule violation, even with --run-checks --strict", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "GEN-002.md",
      makeAdr({ id: "GEN-002", title: "Fails", domain: "general", rules: true })
    );
    writeRules(
      dir,
      "GEN-002.rules.ts",
      `export default { rules: { "hard-rule": { description: "Always fails", async check(ctx) { for (const file of ctx.scopedFiles) { ctx.report.violation({ message: "bad", file }); } } } } };`
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    writeFileSync(join(dir, "modified.ts"), "export const y = 2;\n");

    const { exitCode } = await runCli(
      ["review-context", "--run-checks", "--strict"],
      dir
    );
    expect(exitCode).toBe(0);
  }, 60000);

  test("fails via --run-checks on a briefing overrun when no rule ADR exists (zero-rules path)", async () => {
    // Prose-only corpus: without --verbose nothing is briefed (so
    // truncatedBriefings stays empty), but --run-checks must still mirror
    // check's zero-rules path and surface the corpus-wide advisory.
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-001.md",
      makeAdr({
        id: "ARCH-001",
        title: "Prose only",
        domain: "architecture",
        rules: false,
        body: `## Decision\n${"A".repeat(5000)}\n\n## Do's and Don'ts\nDo it.`,
      })
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const lenient = await runCli(["review-context", "--run-checks"], dir);
    expect(lenient.exitCode).toBe(0);

    const { exitCode, stderr } = await runCli(
      ["review-context", "--run-checks", "--strict"],
      dir
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--strict");
  }, 60000);

  test("strict: true in .archgate/config.json is honored when the flag is omitted", async () => {
    scaffoldProject(dir);
    writeAdr(
      dir,
      "ARCH-001.md",
      makeAdr({
        id: "ARCH-001",
        title: "Architecture ADR",
        domain: "architecture",
        rules: false,
        body: `## Decision\n${"A".repeat(5000)}\n\n## Do's and Don'ts\nDo keep layers separate.`,
      })
    );
    writeFileSync(
      join(dir, ".archgate", "config.json"),
      JSON.stringify({ domains: {}, strict: true }, null, 2)
    );
    await initGitRepo(dir);
    await commitAll(dir, "initial commit");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const { exitCode } = await runCli(["review-context", "--verbose"], dir);
    expect(exitCode).toBe(1);
  });
});
