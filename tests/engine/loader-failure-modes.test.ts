// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Sibling of loader.test.ts, covering the failure paths: blockedToRuleResult
// projection, unreadable/unparseable ADR sources, and rule files that clear
// both gates yet still fail at import or schema validation.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as nodeFs from "node:fs";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LoadResult } from "../../src/engine/loader";
import {
  blockedToRuleResult,
  getSkippedAdrs,
  loadRuleAdrs,
  parseAllAdrs,
} from "../../src/engine/loader";

type BlockedResult = Extract<LoadResult, { type: "blocked" }>;

function assertBlocked(result: LoadResult): asserts result is BlockedResult {
  if (result.type !== "blocked") throw new Error("expected a blocked ADR");
}

const fixturesDir = join(import.meta.dir, "..", "fixtures", "rules");

describe("loader failure modes", () => {
  let tempDir: string;
  let adrsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-loader-fail-"));
    adrsDir = join(tempDir, ".archgate", "adrs");
    mkdirSync(adrsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /** Copy the shared sample ADR (rules: true) into the temp ADR directory. */
  function writeSampleAdr(): void {
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
  }

  /** Write the companion rule file for the sample ADR. */
  function writeRulesTs(body: string): void {
    writeFileSync(join(adrsDir, "TEST-001-sample.rules.ts"), body);
  }

  /** Load the sample ADR and return its single blocked result. */
  async function loadBlocked(): Promise<BlockedResult> {
    const results = await loadRuleAdrs(tempDir);
    expect(results).toHaveLength(1);
    const [first] = results;
    assertBlocked(first);
    return first;
  }

  // -- blockedToRuleResult -------------------------------------------------

  test("projects a syntax-gate block onto a syntax-check rule result", async () => {
    writeSampleAdr();
    writeRulesTs(`export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {},
    },
  },
} satisfies RuleSet;
`);

    const blocked = await loadBlocked();
    const projected = blockedToRuleResult(tempDir, blocked.value);

    expect(projected.ruleId).toBe("syntax-check");
    expect(projected.adrId).toBe("TEST-001");
    expect(projected.description).toBe("Rule file syntax conventions");
    expect(projected.durationMs).toBe(0);
    expect(projected.error).toContain("syntax convention");
    expect(projected.violations).toHaveLength(1);
    expect(projected.violations[0].file).toBe(
      ".archgate/adrs/TEST-001-sample.rules.ts"
    );
    expect(projected.violations[0].severity).toBe("error");
    expect(projected.violations[0].adrId).toBe("TEST-001");
    expect(projected.violations[0].ruleId).toBe("syntax-check");
  });

  test("projects a security-gate block onto a security-scan rule result", async () => {
    writeSampleAdr();
    writeRulesTs(`/// <reference path="../rules.d.ts" />
import { readFileSync } from "node:fs";

export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {
        readFileSync("/etc/passwd", "utf8");
      },
    },
  },
} satisfies RuleSet;
`);

    const blocked = await loadBlocked();
    const projected = blockedToRuleResult(tempDir, blocked.value);

    expect(projected.ruleId).toBe("security-scan");
    expect(projected.description).toBe("Rule file security scan");
    expect(projected.violations.length).toBeGreaterThanOrEqual(1);
    expect(projected.violations[0].file).toBe(
      ".archgate/adrs/TEST-001-sample.rules.ts"
    );
  });

  test("projects a missing-companion block with no violations lost", async () => {
    copyFileSync(
      join(fixturesDir, "TEST-004-missing-companion.md"),
      join(adrsDir, "TEST-004-missing-companion.md")
    );

    const blocked = await loadBlocked();
    const projected = blockedToRuleResult(tempDir, blocked.value);

    expect(projected.ruleId).toBe("security-scan");
    expect(projected.violations).toHaveLength(1);
    expect(projected.violations[0].file).toBe(
      ".archgate/adrs/TEST-004-missing-companion.md"
    );
  });

  // -- Unreadable / unparseable ADR sources --------------------------------

  test("records the ADR directory as skipped when it cannot be read", async () => {
    const readdirSpy = spyOn(nodeFs, "readdirSync").mockImplementation(() => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const entries = await parseAllAdrs(tempDir).finally(() => {
      readdirSpy.mockRestore();
    });
    expect(entries).toHaveLength(0);

    const skipped = getSkippedAdrs(tempDir);
    expect(skipped).toHaveLength(1);
    // Project-relative even on this branch — an absolute path here would leak
    // the runner's filesystem layout into GitHub annotations and SARIF.
    expect(skipped[0]).toBe(".archgate/adrs (unreadable: EACCES)");
  });

  test("falls back to the raw error when the failure carries no errno code", async () => {
    const readdirSpy = spyOn(nodeFs, "readdirSync").mockImplementation(() => {
      throw new Error("something went wrong");
    });
    const entries = await parseAllAdrs(tempDir).finally(() => {
      readdirSpy.mockRestore();
    });
    expect(entries).toHaveLength(0);

    expect(getSkippedAdrs(tempDir)[0]).toContain(
      "unreadable: Error: something went wrong"
    );
  });

  test("treats a missing ADR directory as a clean, non-skipped corpus", async () => {
    rmSync(adrsDir, { recursive: true });

    expect(await parseAllAdrs(tempDir)).toHaveLength(0);

    expect(getSkippedAdrs(tempDir)).toHaveLength(0);
    expect(getSkippedAdrs(join(tempDir, "never-parsed"))).toHaveLength(0);
  });

  test("skips an ADR file that fails to parse", async () => {
    writeFileSync(join(adrsDir, "BROKEN-001-invalid.md"), "no frontmatter\n");

    expect(await parseAllAdrs(tempDir)).toHaveLength(0);

    expect(getSkippedAdrs(tempDir)).toEqual([
      ".archgate/adrs/BROKEN-001-invalid.md",
    ]);
  });

  // -- Rule files that clear both gates but still fail ----------------------

  test("blocks a rule file that throws while being imported", async () => {
    writeSampleAdr();
    writeRulesTs(`/// <reference path="../rules.d.ts" />

throw new Error("rule module init failed");

export default {
  rules: {},
} satisfies RuleSet;
`);

    const blocked = await loadBlocked();

    expect(blocked.value.error).toContain(
      "failed to import companion rule file"
    );
    expect(blocked.value.error).toContain("rule module init failed");
    expect(blocked.value.violations).toHaveLength(1);
    expect(blocked.value.violations[0].message).toContain(
      "rule module init failed"
    );
    expect(blocked.value.violations[0].line).toBe(1);
  });

  test("blocks a rule file that rejects a non-Error value at import time", async () => {
    writeSampleAdr();
    writeRulesTs(`/// <reference path="../rules.d.ts" />

throw "plain string failure";

export default {
  rules: {},
} satisfies RuleSet;
`);

    const blocked = await loadBlocked();

    expect(blocked.value.error).toContain("plain string failure");
  });

  const INVALID_EXPORTS = [
    [
      "a default export with no rules record",
      `export default { notRules: true } satisfies RuleSet;`,
    ],
    [
      "no default export at all",
      `export const ruleSet = { rules: {} } satisfies RuleSet;`,
    ],
    [
      "a rule entry missing its description",
      `export default {
  rules: { "sample-rule": { async check(ctx) {} } },
} satisfies RuleSet;`,
    ],
    [
      "a rule entry whose check is not a function",
      `export default {
  rules: { "sample-rule": { description: "Sample", check: "nope" } },
} satisfies RuleSet;`,
    ],
  ] as const;

  test.each(INVALID_EXPORTS)("blocks %s", async (_label, body) => {
    writeSampleAdr();
    writeRulesTs(`/// <reference path="../rules.d.ts" />

${body}
`);

    const blocked = await loadBlocked();

    expect(blocked.value.error).toContain(
      "companion file does not export a valid RuleSet as default"
    );
    expect(blocked.value.violations).toHaveLength(0);
  });
});
