// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerReviewContextCommand } from "../../src/commands/review-context";
import { safeRmSync } from "../test-utils";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerReviewContextCommand", () => {
  test("registers 'review-context' as a subcommand", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    expect(sub.description()).toBeTruthy();
  });

  test("has --staged option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--staged");
  });

  test("has --run-checks option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--run-checks");
  });

  test("has --domain option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--domain");
  });
});

describe("review-context action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-review-ctx-test-"));
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerReviewContextCommand(program);
    return program;
  }

  test("exits 1 when no project found", async () => {
    // tempDir has no .archgate/ directory, so findProjectRoot returns null
    process.chdir(tempDir);

    await expect(
      makeProgram().parseAsync(["node", "test", "review-context"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join(" ");
    // Standardized message from requireProjectRoot() (helpers/paths.ts)
    expect(errorOutput).toContain("No .archgate/ directory found");
  });

  test("prints JSON on successful result", async () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    process.chdir(tempDir);

    await makeProgram().parseAsync(["node", "test", "review-context"]);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("domains");
    expect(parsed).toHaveProperty("allChangedFiles");
  });

  test("includes domain groupings for ADRs with file scopes", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(adrsDir, "ARCH-001-test.md"),
      `---
id: ARCH-001
title: Test ADR
domain: architecture
rules: false
files: ["src/**/*.ts"]
---

## Context
Test context.

## Decision
Test decision.

## Do's and Don'ts
### Do
- Do something.

### Don't
- Don't do something.
`
    );
    process.chdir(tempDir);

    await makeProgram().parseAsync(["node", "test", "review-context"]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    // With no git changes, domains should still be populated but with no changed files
    expect(Array.isArray(parsed.domains)).toBe(true);
    expect(parsed.allChangedFiles).toEqual([]);
  });

  test("respects --domain filter", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(adrsDir, "ARCH-001-test.md"),
      `---
id: ARCH-001
title: Architecture ADR
domain: architecture
rules: false
---

## Context
Test.
`
    );
    writeFileSync(
      join(adrsDir, "GEN-001-test.md"),
      `---
id: GEN-001
title: General ADR
domain: general
rules: false
---

## Context
Test.
`
    );
    process.chdir(tempDir);

    await makeProgram().parseAsync([
      "node",
      "test",
      "review-context",
      "--domain",
      "architecture",
    ]);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const parsed = JSON.parse(output);
    // All domains should only contain architecture entries
    for (const domain of parsed.domains) {
      expect(domain.domain).toBe("architecture");
    }
  });
});
