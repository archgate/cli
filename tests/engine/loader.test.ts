import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRuleAdrs } from "../../src/engine/loader";

// Absolute path to the real defineRules module
const RULES_MODULE_PATH = join(
  import.meta.dir,
  "..",
  "..",
  "src",
  "formats",
  "rules.ts"
);

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
      `import { defineRules } from "${RULES_MODULE_PATH}";
export default defineRules({
  "sample-rule": {
    description: "Sample rule",
    async check(ctx) {},
  },
});
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
    expect(loaded[0].adr.frontmatter.id).toBe("TEST-001");
    expect(Object.keys(loaded[0].ruleSet.rules)).toEqual(["sample-rule"]);
  });

  test("skips ADR with rules: false", async () => {
    copyFileSync(
      join(fixturesDir, "TEST-002-no-rules.md"),
      join(tempDir, ".archgate", "adrs", "TEST-002-no-rules.md")
    );

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(0);
  });

  test("warns and skips when companion file is missing", async () => {
    copyFileSync(
      join(fixturesDir, "TEST-004-missing-companion.md"),
      join(tempDir, ".archgate", "adrs", "TEST-004-missing-companion.md")
    );

    const loaded = await loadRuleAdrs(tempDir);
    expect(loaded).toHaveLength(0);
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
});
