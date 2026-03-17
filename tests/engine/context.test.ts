import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractAdrSections,
  briefAdr,
  matchFilesToAdrs,
  buildReviewContext,
} from "../../src/engine/context";
import type { AdrDocument, AdrDomain } from "../../src/formats/adr";

function makeAdr(
  overrides: Partial<AdrDocument["frontmatter"]> = {},
  body = ""
): AdrDocument {
  return {
    frontmatter: {
      id: "TEST-001",
      title: "Test ADR",
      domain: "architecture" as AdrDomain,
      rules: false,
      ...overrides,
    },
    body,
    filePath: "/test.md",
  };
}

describe("extractAdrSections", () => {
  test("extracts Decision section from ADR body", () => {
    const body =
      "## Context\nSome context.\n\n## Decision\nWe decided X.\nIt applies to all.\n\n## Consequences\nWorks great.";
    const result = extractAdrSections(body, ["Decision"]);
    expect(result["Decision"]).toBe("We decided X.\nIt applies to all.");
  });

  test("extracts Do's and Don'ts section including subsections", () => {
    const body =
      "## Decision\nUse X.\n\n## Do's and Don'ts\n\n### Do\n- Pattern A\n- Pattern B\n\n### Don't\n- Not pattern C\n\n## Consequences\nGood.";
    const result = extractAdrSections(body, ["Do's and Don'ts"]);
    const section = result["Do's and Don'ts"];
    expect(section).toContain("### Do");
    expect(section).toContain("- Pattern A");
    expect(section).toContain("### Don't");
    expect(section).toContain("- Not pattern C");
  });

  test("returns empty string for missing sections", () => {
    const result = extractAdrSections("## Context\nSome context.\n", [
      "Decision",
      "Do's and Don'ts",
    ]);
    expect(result["Decision"]).toBe("");
    expect(result["Do's and Don'ts"]).toBe("");
  });

  test("handles section at end of file (no trailing heading)", () => {
    const body = "## Context\nText.\n\n## Decision\nFinal text.\nMore detail.";
    const result = extractAdrSections(body, ["Decision"]);
    expect(result["Decision"]).toBe("Final text.\nMore detail.");
  });

  test("matches section names case-insensitively", () => {
    const result = extractAdrSections("## decision\nLowercase content.", [
      "Decision",
    ]);
    expect(result["Decision"]).toBe("Lowercase content.");
  });
});

describe("briefAdr", () => {
  test("returns AdrBriefing with frontmatter + extracted sections", () => {
    const body =
      "## Decision\nUse pattern X.\n\n## Do's and Don'ts\n\n### Do\n- Follow X\n\n### Don't\n- Not Y";
    const adr = makeAdr(
      { id: "ARCH-001", title: "Test", domain: "architecture", rules: true },
      body
    );
    const briefing = briefAdr(adr);
    expect(briefing.id).toBe("ARCH-001");
    expect(briefing.domain).toBe("architecture");
    expect(briefing.rules).toBe(true);
    expect(briefing.decision).toContain("Use pattern X");
    expect(briefing.dosAndDonts).toContain("Follow X");
    expect(briefing.dosAndDonts).toContain("Not Y");
  });

  test("handles ADR with no matching sections", () => {
    const briefing = briefAdr(makeAdr({}, "## Context\nJust context.\n"));
    expect(briefing.decision).toBe("");
    expect(briefing.dosAndDonts).toBe("");
  });

  test("preserves files array from frontmatter", () => {
    const briefing = briefAdr(
      makeAdr({ files: ["src/**/*.ts"] }, "## Decision\nX.")
    );
    expect(briefing.files).toEqual(["src/**/*.ts"]);
    expect(briefAdr(makeAdr({}, "## Decision\nX.")).files).toBeUndefined();
  });

  test("truncates decision section when it exceeds maxSectionChars", () => {
    const longDecision = "A".repeat(3000);
    const body = `## Decision\n${longDecision}\n\n## Do's and Don'ts\nShort.`;
    const adr = makeAdr({ id: "ARCH-010" }, body);
    const briefing = briefAdr(adr, { maxSectionChars: 100 });
    expect(briefing.decision.length).toBeLessThan(3000);
    expect(briefing.decision).toContain("[... truncated");
    expect(briefing.decision).toContain("adr://ARCH-010");
    // Do's and Don'ts is short, should not be truncated
    expect(briefing.dosAndDonts).toBe("Short.");
  });

  test("truncates dosAndDonts section when it exceeds maxSectionChars", () => {
    const longDos = "B".repeat(5000);
    const body = `## Decision\nShort.\n\n## Do's and Don'ts\n${longDos}`;
    const adr = makeAdr({ id: "ARCH-020" }, body);
    const briefing = briefAdr(adr, { maxSectionChars: 200 });
    expect(briefing.decision).toBe("Short.");
    expect(briefing.dosAndDonts).toContain("[... truncated");
    expect(briefing.dosAndDonts).toContain("adr://ARCH-020");
  });

  test("does not truncate when content equals maxSectionChars", () => {
    const exactContent = "C".repeat(100);
    const body = `## Decision\n${exactContent}`;
    const adr = makeAdr({ id: "ARCH-030" }, body);
    const briefing = briefAdr(adr, { maxSectionChars: 100 });
    expect(briefing.decision).toBe(exactContent);
    expect(briefing.decision).not.toContain("truncated");
  });

  test("maxSectionChars 0 means unlimited", () => {
    const longContent = "D".repeat(10000);
    const body = `## Decision\n${longContent}`;
    const adr = makeAdr({ id: "ARCH-040" }, body);
    const briefing = briefAdr(adr, { maxSectionChars: 0 });
    expect(briefing.decision).toBe(longContent);
  });

  test("does not truncate empty sections", () => {
    const adr = makeAdr({ id: "ARCH-050" }, "## Context\nNothing.");
    const briefing = briefAdr(adr, { maxSectionChars: 10 });
    expect(briefing.decision).toBe("");
    expect(briefing.dosAndDonts).toBe("");
  });
});

describe("matchFilesToAdrs", () => {
  test("matches file to ADR by files glob", () => {
    const adr = makeAdr(
      {
        id: "ARCH-001",
        domain: "architecture",
        files: ["src/commands/**/*.ts"],
      },
      "## Decision\nX."
    );
    const result = matchFilesToAdrs(["src/commands/check.ts"], [adr]);
    expect(result).toHaveLength(1);
    expect(result[0].domain).toBe("architecture");
    expect(result[0].changedFiles).toContain("src/commands/check.ts");
    expect(result[0].adrs[0].id).toBe("ARCH-001");
  });

  test("ADR without files globs applies to all changed files", () => {
    const adr = makeAdr(
      { id: "GEN-001", domain: "general" },
      "## Decision\nX."
    );
    const result = matchFilesToAdrs(
      ["src/a.ts", "src/b.ts", "tests/c.test.ts"],
      [adr]
    );
    expect(result).toHaveLength(1);
    expect(result[0].changedFiles).toHaveLength(3);
  });

  test("groups by domain correctly", () => {
    const archAdr = makeAdr(
      { id: "ARCH-001", domain: "architecture", files: ["src/**/*.ts"] },
      "## Decision\nX."
    );
    const beAdr = makeAdr(
      { id: "BE-001", domain: "backend", files: ["api/**/*.ts"] },
      "## Decision\nY."
    );
    const result = matchFilesToAdrs(
      ["src/engine/runner.ts", "api/routes.ts"],
      [archAdr, beAdr]
    );
    expect(result).toHaveLength(2);
    const archDomain = result.find((d) => d.domain === "architecture");
    const beDomain = result.find((d) => d.domain === "backend");
    expect(archDomain!.changedFiles).toContain("src/engine/runner.ts");
    expect(beDomain!.changedFiles).toContain("api/routes.ts");
  });

  test("handles files matching multiple ADRs in same domain", () => {
    const adr1 = makeAdr(
      { id: "ARCH-001", domain: "architecture", files: ["src/**/*.ts"] },
      "## Decision\nX."
    );
    const adr2 = makeAdr(
      { id: "ARCH-002", domain: "architecture", files: ["src/engine/**/*.ts"] },
      "## Decision\nY."
    );
    const result = matchFilesToAdrs(["src/engine/runner.ts"], [adr1, adr2]);
    expect(result).toHaveLength(1);
    expect(result[0].adrs).toHaveLength(2);
    expect(result[0].adrs.map((a) => a.id)).toContain("ARCH-001");
    expect(result[0].adrs.map((a) => a.id)).toContain("ARCH-002");
  });

  test("excludes ADRs with no matching files", () => {
    const adr = makeAdr(
      { id: "FE-001", domain: "frontend", files: ["web/**/*.tsx"] },
      "## Decision\nX."
    );
    expect(matchFilesToAdrs(["src/engine/runner.ts"], [adr])).toHaveLength(0);
  });

  test("passes briefing options through to briefAdr", () => {
    const longDecision = "X".repeat(5000);
    const adr = makeAdr(
      { id: "ARCH-001", domain: "architecture" },
      `## Decision\n${longDecision}`
    );
    const result = matchFilesToAdrs(["src/a.ts"], [adr], {
      maxSectionChars: 50,
    });
    expect(result).toHaveLength(1);
    expect(result[0].adrs[0].decision).toContain("[... truncated");
    expect(result[0].adrs[0].decision.length).toBeLessThan(5000);
  });
});

describe("buildReviewContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-context-test-"));
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeAdr(
    id: string,
    domain: AdrDomain,
    opts: { rules?: boolean } = {}
  ) {
    const rules = opts.rules ?? false;
    const body = `## Decision\nUse ${id}.\n\n## Do's and Don'ts\n\n### Do\n- Follow ${id}`;
    writeFileSync(
      join(tempDir, ".archgate", "adrs", `${id}-test.md`),
      `---\nid: ${id}\ntitle: Test ${id}\ndomain: ${domain}\nrules: ${rules}\n---\n\n${body}\n`
    );
  }

  test("returns empty context for non-git temp dir", async () => {
    writeAdr("ARCH-001", "architecture");
    const ctx = await buildReviewContext(tempDir, { runChecks: false });
    expect(ctx.allChangedFiles).toEqual([]);
    expect(ctx.domains).toEqual([]);
    expect(ctx.checkSummary).toBeNull();
  });

  test("includes check summary when runChecks: true", async () => {
    writeAdr("ARCH-001", "architecture");
    const ctx = await buildReviewContext(tempDir, { runChecks: true });
    expect(ctx.checkSummary).not.toBeNull();
    expect(ctx.checkSummary!.pass).toBe(true);
    expect(ctx.checkSummary!.total).toBe(0);
  });

  test("omits check summary when runChecks: false", async () => {
    writeAdr("ARCH-001", "architecture");
    const ctx = await buildReviewContext(tempDir, { runChecks: false });
    expect(ctx.checkSummary).toBeNull();
  });

  test("handles project with no ADRs", async () => {
    const ctx = await buildReviewContext(tempDir, { runChecks: false });
    expect(ctx.allChangedFiles).toEqual([]);
    expect(ctx.domains).toEqual([]);
  });

  test("truncatedFiles is false when no changed files", async () => {
    writeAdr("ARCH-001", "architecture");
    const ctx = await buildReviewContext(tempDir, { runChecks: false });
    expect(ctx.truncatedFiles).toBe(false);
  });
});
