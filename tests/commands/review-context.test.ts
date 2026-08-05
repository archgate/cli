// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerReviewContextCommand } from "../../src/commands/review-context";
import * as logModule from "../../src/helpers/log";
import { expectKeys, git, safeRmSync } from "../test-utils";

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

  test("has --verbose option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--verbose");
  });

  test("has --strict option", () => {
    const program = new Command();
    registerReviewContextCommand(program);
    const sub = program.commands.find((c) => c.name() === "review-context")!;
    const opts = sub.options.map((o) => o.long);
    expect(opts).toContain("--strict");
  });
});

describe("review-context action handler", () => {
  let tempDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let errorSpy: Mock<typeof console.error>;
  let exitSpy: Mock<typeof process.exit>;

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

    expect(
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
    const parsed: unknown = JSON.parse(output);
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
    const parsed = expectKeys(JSON.parse(output), "domains", "allChangedFiles");
    // With no git changes, domains should still be populated but with no changed files
    expect(parsed.domains).toBeInstanceOf(Array);
    expect(parsed.allChangedFiles).toEqual([]);
  });

  /**
   * Domains are grouped from changed files, so the project needs a git repo
   * and a file the ADRs scope to before any domain reaches the output.
   */
  async function scaffoldTwoDomainProject(): Promise<void> {
    await git(["init", "--initial-branch=main"], tempDir);
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    await git(["config", "commit.gpgsign", "false"], tempDir);

    const adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(adrsDir, "ARCH-001-test.md"),
      `---\nid: ARCH-001\ntitle: Architecture ADR\ndomain: architecture\nrules: false\nfiles: ["**/*.ts"]\n---\n\n## Context\nTest.\n`
    );
    writeFileSync(
      join(adrsDir, "GEN-001-test.md"),
      `---\nid: GEN-001\ntitle: General ADR\ndomain: general\nrules: false\nfiles: ["**/*.ts"]\n---\n\n## Context\nTest.\n`
    );

    writeFileSync(join(tempDir, "seed.txt"), "seed\n");
    await git(["add", "."], tempDir);
    await git(["commit", "-m", "seed"], tempDir);
    writeFileSync(join(tempDir, "changed.ts"), "export const n = 1;\n");
    process.chdir(tempDir);
  }

  function reportedDomains(): string[] {
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("");
    const domains = expectKeys(JSON.parse(output), "domains").domains;
    if (!Array.isArray(domains)) {
      throw new TypeError("expected domains to be an array");
    }
    return domains.map((domain: unknown) =>
      String(expectKeys(domain, "domain").domain)
    );
  }

  test("reports every domain when no --domain filter is given", async () => {
    await scaffoldTwoDomainProject();

    await makeProgram().parseAsync([
      "node",
      "test",
      "review-context",
      "--base",
      "HEAD",
    ]);

    expect([...reportedDomains()].sort()).toEqual(["architecture", "general"]);
  });

  test("respects --domain filter", async () => {
    await scaffoldTwoDomainProject();

    await makeProgram().parseAsync([
      "node",
      "test",
      "review-context",
      "--base",
      "HEAD",
      "--domain",
      "architecture",
    ]);

    expect(reportedDomains()).toEqual(["architecture"]);
  });
});

/** Await a rejection and hand back its message for assertions. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the promise to reject");
}

/** Frontmatter + a Decision section far past the 2000-char briefing budget. */
function overBudgetAdr(id: string): string {
  return `---
id: ${id}
title: Very Long ADR
domain: architecture
rules: false
---

## Context
Short context.

## Decision
${"This decision sentence is repeated to blow past the briefing budget. ".repeat(50)}

## Do's and Don'ts
### Do
- Do something.
`;
}

describe("review-context truncation and strict exits", () => {
  let tempDir: string;
  let adrsDir: string;
  let originalCwd: string;
  let logSpy: Mock<typeof console.log>;
  let warnSpy: Mock<typeof logModule.logWarn>;
  let exitSpy: Mock<typeof process.exit>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-review-trunc-test-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    originalCwd = process.cwd();
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    warnSpy = spyOn(logModule, "logWarn").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    safeRmSync(tempDir);
    exitSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerReviewContextCommand(program);
    return program;
  }

  function warnings(): string {
    return warnSpy.mock.calls.flat().join(" ");
  }

  /** A committed git repo, so `--base HEAD` can diff against a real ref. */
  async function initGitProject(): Promise<void> {
    await git(["init", "--initial-branch=main"], tempDir);
    // CI has no global git identity, and a global signing config would
    // otherwise fail the commit below.
    await git(["config", "user.email", "test@test.com"], tempDir);
    await git(["config", "user.name", "Test"], tempDir);
    await git(["config", "commit.gpgsign", "false"], tempDir);
    writeFileSync(join(tempDir, "seed.txt"), "seed\n");
    await git(["add", "seed.txt"], tempDir);
    await git(["commit", "-m", "seed"], tempDir);
  }

  test("warns when the changed-file list exceeds the 200-file cap", async () => {
    await initGitProject();
    const srcDir = join(tempDir, "src");
    mkdirSync(srcDir);
    // 201 untracked files: `--base <ref>` unions them into changedFiles, so
    // the production 200-file cap trips without staging 200 edits.
    for (let i = 0; i < 201; i++) {
      writeFileSync(
        join(srcDir, `file-${i}.ts`),
        `export const n${i} = ${i};\n`
      );
    }
    process.chdir(tempDir);

    await makeProgram().parseAsync([
      "node",
      "test",
      "review-context",
      "--base",
      "HEAD",
    ]);

    expect(warnings()).toContain("Changed-file list truncated to 200 files");
    const parsed = expectKeys(
      JSON.parse(
        logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("")
      ),
      "truncatedFiles",
      "allChangedFiles"
    );
    expect(parsed.truncatedFiles).toBe(true);
    expect(parsed.allChangedFiles).toBeArrayOfSize(200);
  });

  test("warns when --verbose briefing prose is truncated", async () => {
    await initGitProject();
    writeFileSync(
      join(adrsDir, "LONG-001-verbose.md"),
      overBudgetAdr("LONG-001")
    );
    writeFileSync(join(tempDir, "changed.ts"), "export const a = 1;\n");
    process.chdir(tempDir);

    await makeProgram().parseAsync([
      "node",
      "test",
      "review-context",
      "--base",
      "HEAD",
      "--verbose",
    ]);

    expect(warnings()).toContain("ADR briefing prose truncated for LONG-001");
    const parsed = expectKeys(
      JSON.parse(
        logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("")
      ),
      "truncatedBriefings"
    );
    expect(parsed.truncatedBriefings).toEqual(["LONG-001"]);
  });

  test("--strict exits 1 when briefing prose was truncated", async () => {
    await initGitProject();
    writeFileSync(
      join(adrsDir, "LONG-001-verbose.md"),
      overBudgetAdr("LONG-001")
    );
    writeFileSync(join(tempDir, "changed.ts"), "export const a = 1;\n");
    process.chdir(tempDir);

    expect(
      await rejectionMessage(
        makeProgram().parseAsync([
          "node",
          "test",
          "review-context",
          "--base",
          "HEAD",
          "--verbose",
          "--strict",
        ])
      )
    ).toBe("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnings()).toContain(
      "--strict: failing because ADR briefing prose was truncated"
    );
  });

  test("--run-checks --strict reports capped violations and warning failures", async () => {
    writeFileSync(
      join(adrsDir, "TEST-002-noisy.md"),
      `---
id: TEST-002
title: Noisy Rule
domain: general
rules: true
---

## Context
Short context.
`
    );
    writeFileSync(
      join(adrsDir, "TEST-002-noisy.rules.ts"),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "many-warnings": {
      description: "Reports more warnings than the per-rule cap",
      async check(ctx) {
        for (let i = 0; i < 25; i++) {
          ctx.report.warning({ message: \`warning \${i}\` });
        }
      },
    },
  },
} satisfies RuleSet;
`
    );
    process.chdir(tempDir);

    expect(
      await rejectionMessage(
        makeProgram().parseAsync([
          "node",
          "test",
          "review-context",
          "--run-checks",
          "--strict",
        ])
      )
    ).toBe("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnings()).toContain(
      "Some rules reported more violations than the per-rule cap"
    );
    expect(warnings()).toContain(
      "25 check warning(s) are treated as failures under --strict"
    );
  });

  test("--run-checks --strict fails on advisory findings with no rule ADRs", async () => {
    writeFileSync(
      join(adrsDir, "LONG-001-verbose.md"),
      overBudgetAdr("LONG-001")
    );
    process.chdir(tempDir);

    expect(
      await rejectionMessage(
        makeProgram().parseAsync([
          "node",
          "test",
          "review-context",
          "--run-checks",
          "--strict",
        ])
      )
    ).toBe("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(warnings()).toContain(
      "check found advisory findings (briefing budget, suppression, or unparsed ADRs)"
    );
  });
});
