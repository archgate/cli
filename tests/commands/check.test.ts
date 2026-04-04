import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs } from "../../src/engine/loader";
import { getExitCode } from "../../src/engine/reporter";
import { runChecks } from "../../src/engine/runner";

describe("check command integration", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-check-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("exits 0 when no rules to check", async () => {
    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(0);
  });

  test("exits 0 when all rules pass", async () => {
    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-001-passing.md"),
      `---
id: TEST-001
title: Passing Rule
domain: general
rules: true
---

# Passing Rule
`
    );
    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-001-passing.rules.ts"),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "always-pass": {
      description: "Always passes",
      async check() {},
    },
  },
} satisfies RuleSet;
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(getExitCode(result)).toBe(0);
  });

  test("exits 1 when violations found", async () => {
    writeFileSync(join(tempDir, "src", "bad.ts"), 'console.log("bad");\n');

    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-002-failing.md"),
      `---
id: TEST-002
title: Failing Rule
domain: general
rules: true
files: ["src/**/*.ts"]
---

# Failing Rule
`
    );
    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-002-failing.rules.ts"),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "no-console": {
      description: "No console.log",
      async check(ctx) {
        for (const file of ctx.scopedFiles) {
          const matches = await ctx.grep(file, /console\\.log/);
          for (const m of matches) {
            ctx.report.violation({
              message: "Found console.log",
              file: m.file,
              line: m.line,
            });
          }
        }
      },
    },
  },
} satisfies RuleSet;
`
    );

    const loaded = await loadRuleAdrs(tempDir);
    const result = await runChecks(tempDir, loaded);
    expect(getExitCode(result)).toBe(1);
    expect(result.results[0].violations).toHaveLength(1);
  });

  test("filters by ADR ID", async () => {
    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-003-filter.md"),
      `---
id: TEST-003
title: Filtered Rule
domain: general
rules: true
---

# Filtered Rule
`
    );
    writeFileSync(
      join(tempDir, ".archgate", "adrs", "TEST-003-filter.rules.ts"),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "filtered": {
      description: "Filtered rule",
      async check() {},
    },
  },
} satisfies RuleSet;
`
    );

    const loaded = await loadRuleAdrs(tempDir, "TEST-003");
    expect(loaded).toHaveLength(1);

    const loaded2 = await loadRuleAdrs(tempDir, "NONEXISTENT");
    expect(loaded2).toHaveLength(0);
  });
});
