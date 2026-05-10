// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs, parseAllAdrs } from "../../src/engine/loader";
import { saveProjectConfig } from "../../src/helpers/project-config";

describe("loadRuleAdrs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-loader-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const fixturesDir = join(import.meta.dir, "..", "fixtures", "rules");

  function writeRulesTs(adrsDir: string, baseName: string) {
    writeFileSync(
      join(adrsDir, `${baseName}.rules.ts`),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {},
    },
  },
} satisfies RuleSet;
`
    );
  }

  test("loads ADR with valid companion .rules.ts", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
    writeRulesTs(adrsDir, "TEST-001-sample");

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].type).toBe("loaded");
    const first = loaded[0] as Extract<(typeof loaded)[0], { type: "loaded" }>;
    expect(first.value.adr.frontmatter.id).toBe("TEST-001");
    expect(Object.keys(first.value.ruleSet.rules)).toEqual(["sample-rule"]);
  });

  test("skips ADR with rules: false", async () => {
    copyFileSync(
      join(fixturesDir, "TEST-002-no-rules.md"),
      join(tempDir, ".archgate", "adrs", "TEST-002-no-rules.md")
    );

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(0);
  });

  test("returns blocked result when companion file is missing", async () => {
    copyFileSync(
      join(fixturesDir, "TEST-004-missing-companion.md"),
      join(tempDir, ".archgate", "adrs", "TEST-004-missing-companion.md")
    );

    const results = await loadRuleAdrs(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const blocked = results[0] as Extract<
      (typeof results)[0],
      { type: "blocked" }
    >;
    expect(blocked.value.error).toContain("no companion file found");
    expect(blocked.value.violations).toHaveLength(1);
  });

  test("filters by ADR ID", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
    writeRulesTs(adrsDir, "TEST-001-sample");

    const loaded = await loadRuleAdrs(tempDir, "NONEXISTENT");
    expect(loaded).toHaveLength(0);

    const loaded2 = await loadRuleAdrs(tempDir, "TEST-001");
    expect(loaded2).toHaveLength(1);
  });

  test("returns empty array when no adrs directory exists", async () => {
    rmSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(0);
  });

  test("returns blocked result when triple-slash reference is missing", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
    writeFileSync(
      join(adrsDir, "TEST-001-sample.rules.ts"),
      `export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {},
    },
  },
} satisfies RuleSet;
`
    );

    const results = await loadRuleAdrs(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const blocked = results[0] as Extract<
      (typeof results)[0],
      { type: "blocked" }
    >;
    expect(blocked.value.error).toContain("syntax convention");
    expect(blocked.value.violations).toHaveLength(1);
    expect(blocked.value.violations[0].message).toContain(
      "triple-slash reference"
    );
  });

  test("returns blocked result when satisfies RuleSet is missing", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
    writeFileSync(
      join(adrsDir, "TEST-001-sample.rules.ts"),
      `/// <reference path="../rules.d.ts" />

export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {},
    },
  },
};
`
    );

    const results = await loadRuleAdrs(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const blocked = results[0] as Extract<
      (typeof results)[0],
      { type: "blocked" }
    >;
    expect(blocked.value.error).toContain("syntax convention");
    expect(blocked.value.violations).toHaveLength(1);
    expect(blocked.value.violations[0].message).toContain("satisfies RuleSet");
  });

  test("returns blocked with two violations when both conventions are missing", async () => {
    const adrsDir = join(tempDir, ".archgate", "adrs");
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(adrsDir, "TEST-001-sample.md")
    );
    writeFileSync(
      join(adrsDir, "TEST-001-sample.rules.ts"),
      `export default {
  rules: {
    "sample-rule": {
      description: "Sample rule",
      async check(ctx) {},
    },
  },
};
`
    );

    const results = await loadRuleAdrs(tempDir);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const blocked = results[0] as Extract<
      (typeof results)[0],
      { type: "blocked" }
    >;
    expect(blocked.value.error).toContain("2 violations");
    expect(blocked.value.violations).toHaveLength(2);
  });

  test("loads ADRs from custom directory configured in config.json", async () => {
    // Create a custom ADR directory outside .archgate/
    const customAdrsDir = join(tempDir, "docs", "adrs");
    mkdirSync(customAdrsDir, { recursive: true });

    // Configure the custom path
    await saveProjectConfig(tempDir, {
      domains: {},
      paths: { adrs: "docs/adrs" },
    });

    // Place ADR + rules in the custom directory
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(customAdrsDir, "TEST-001-sample.md")
    );
    writeRulesTs(customAdrsDir, "TEST-001-sample");

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].type).toBe("loaded");
    const first = loaded[0] as Extract<(typeof loaded)[0], { type: "loaded" }>;
    expect(first.value.adr.frontmatter.id).toBe("TEST-001");
  });

  test("parseAllAdrs reads from custom directory", async () => {
    // Configure custom path
    const customAdrsDir = join(tempDir, "governance");
    mkdirSync(customAdrsDir, { recursive: true });

    await saveProjectConfig(tempDir, {
      domains: {},
      paths: { adrs: "governance" },
    });

    // Place ADR in custom dir, NOT in .archgate/adrs/
    copyFileSync(
      join(fixturesDir, "TEST-001-sample.md"),
      join(customAdrsDir, "TEST-001-sample.md")
    );

    const parsed = await parseAllAdrs(tempDir);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].adr.frontmatter.id).toBe("TEST-001");
  });
});
