import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";

import { safeRmSync } from "../test-utils";
import {
  runCli,
  createTempProject,
  scaffoldProject,
  writeAdr,
  makeAdr,
} from "./cli-harness";

let tempDir: string;

beforeEach(() => {
  tempDir = createTempProject("archgate-adr-su-integ-");
});

afterEach(() => {
  safeRmSync(tempDir);
});

describe("adr show integration", () => {
  test("shows ADR content", async () => {
    scaffoldProject(tempDir);
    writeAdr(
      tempDir,
      "GEN-001-conventions.md",
      makeAdr({
        id: "GEN-001",
        title: "Conventions",
        domain: "general",
        body: "## Context\nSome context.",
      })
    );
    const result = await runCli(["adr", "show", "GEN-001"], tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GEN-001");
  });

  test("fails for non-existent ID", async () => {
    scaffoldProject(tempDir);
    const result = await runCli(["adr", "show", "MISSING-999"], tempDir);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("adr update integration", () => {
  test("updates ADR body", async () => {
    scaffoldProject(tempDir);
    writeAdr(
      tempDir,
      "GEN-001-conventions.md",
      makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
    );
    const result = await runCli(
      ["adr", "update", "--id", "GEN-001", "--body", "## New\nUpdated"],
      tempDir
    );
    expect(result.exitCode).toBe(0);
    const content = await Bun.file(
      join(tempDir, ".archgate", "adrs", "GEN-001-conventions.md")
    ).text();
    expect(content).toContain("Updated");
  });

  test("update with --json", async () => {
    scaffoldProject(tempDir);
    writeAdr(
      tempDir,
      "GEN-001-conventions.md",
      makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
    );
    const result = await runCli(
      [
        "adr",
        "update",
        "--id",
        "GEN-001",
        "--body",
        "## New\nUpdated",
        "--json",
      ],
      tempDir
    );
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.id).toBe("GEN-001");
    expect(parsed.filePath).toBeTruthy();
  });

  test("update preserves frontmatter", async () => {
    scaffoldProject(tempDir);
    writeAdr(
      tempDir,
      "GEN-001-conventions.md",
      makeAdr({ id: "GEN-001", title: "Conventions", domain: "general" })
    );
    const result = await runCli(
      ["adr", "update", "--id", "GEN-001", "--body", "## New\nBody only"],
      tempDir
    );
    expect(result.exitCode).toBe(0);
    const content = await Bun.file(
      join(tempDir, ".archgate", "adrs", "GEN-001-conventions.md")
    ).text();
    expect(content).toContain("title: Conventions");
    expect(content).toContain("domain: general");
  });

  test("fails for non-existent ID", async () => {
    scaffoldProject(tempDir);
    const result = await runCli(
      ["adr", "update", "--id", "MISSING-999", "--body", "## New\nBody"],
      tempDir
    );
    expect(result.exitCode).not.toBe(0);
  });
});
