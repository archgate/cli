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

  test("exits non-zero when no .archgate project found", async () => {
    const { exitCode, stderr } = await runCli(["review-context"], dir);
    expect(exitCode).not.toBe(0);
    expect(stderr.toLowerCase()).toContain("error");
  });
});
