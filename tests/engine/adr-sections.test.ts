// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BRIEFED_SECTIONS,
  DEFAULT_MAX_SECTION_CHARS,
  collectBriefingBudgetWarnings,
  collectBriefingDiagnostics,
  extractAdrSections,
  truncateSection,
} from "../../src/engine/adr-sections";
import type { AdrDocument } from "../../src/formats/adr";
import { safeRmSync } from "../test-utils";

function makeAdr(
  id: string,
  body: string,
  filePath = `/adrs/${id}.md`
): AdrDocument {
  return {
    frontmatter: {
      id,
      title: `Test ${id}`,
      domain: "architecture",
      rules: false,
    },
    body,
    filePath,
  };
}

describe("extractAdrSections", () => {
  test("extracts a named section up to the next heading", () => {
    const body =
      "## Context\nWhy.\n\n## Decision\nWe decided X.\nIt applies broadly.\n\n## Consequences\nFine.";
    expect(extractAdrSections(body, ["Decision"]).Decision).toBe(
      "We decided X.\nIt applies broadly."
    );
  });

  test("matches heading names case-insensitively", () => {
    const body = "## decision\nLowercase heading.";
    expect(extractAdrSections(body, ["Decision"]).Decision).toBe(
      "Lowercase heading."
    );
  });

  test("returns empty strings for missing sections", () => {
    const result = extractAdrSections("## Context\nOnly context.", [
      "Decision",
      "Do's and Don'ts",
    ]);
    expect(result.Decision).toBe("");
    expect(result["Do's and Don'ts"]).toBe("");
  });

  test("keeps subsections inside the captured section", () => {
    const body =
      "## Do's and Don'ts\n\n### Do\n- A\n\n### Don't\n- B\n\n## Consequences\nx";
    const section = extractAdrSections(body, ["Do's and Don'ts"])[
      "Do's and Don'ts"
    ];
    expect(section).toContain("### Do");
    expect(section).toContain("### Don't");
    expect(section).not.toContain("## Consequences");
  });
});

describe("truncateSection", () => {
  test("marks the cut and reports it", () => {
    const result = truncateSection("A".repeat(500), "ARCH-001", 100);
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("[... truncated");
    expect(result.text).toContain("adr://ARCH-001");
  });

  test("leaves content at exactly the cap untouched", () => {
    const exact = "B".repeat(100);
    expect(truncateSection(exact, "ARCH-002", 100)).toEqual({
      text: exact,
      truncated: false,
    });
  });

  test("treats a cap of 0 as unlimited", () => {
    const long = "C".repeat(9000);
    expect(truncateSection(long, "ARCH-003", 0)).toEqual({
      text: long,
      truncated: false,
    });
  });
});

describe("collectBriefingBudgetWarnings", () => {
  test("reports a section over the cap with its size and the cap", () => {
    const adr = makeAdr("ARCH-001", `## Decision\n${"A".repeat(300)}`);
    const warnings = collectBriefingBudgetWarnings([adr], 100);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      adrId: "ARCH-001",
      section: "Decision",
      cap: 100,
    });
    expect(warnings[0].length).toBeGreaterThan(100);
  });

  test("reports both briefed sections independently", () => {
    const adr = makeAdr(
      "ARCH-002",
      `## Decision\n${"A".repeat(300)}\n\n## Do's and Don'ts\n${"B".repeat(300)}`
    );
    const sections = collectBriefingBudgetWarnings([adr], 100).map(
      (w) => w.section
    );
    expect(sections).toEqual([...BRIEFED_SECTIONS]);
  });

  test("stays silent for sections within the cap", () => {
    const adr = makeAdr(
      "ARCH-003",
      "## Decision\nShort.\n\n## Do's and Don'ts\nAlso short."
    );
    expect(collectBriefingBudgetWarnings([adr], 2000)).toEqual([]);
  });

  test("ignores un-briefed sections however long they are", () => {
    const adr = makeAdr("ARCH-004", `## Context\n${"A".repeat(9000)}`);
    expect(collectBriefingBudgetWarnings([adr], 100)).toEqual([]);
  });

  test("covers ADRs regardless of whether they carry rules", () => {
    const adr = makeAdr("GEN-001", `## Decision\n${"A".repeat(300)}`);
    adr.frontmatter.rules = false;
    expect(collectBriefingBudgetWarnings([adr], 100)).toHaveLength(1);
  });

  test("a cap of 0 disables the check", () => {
    const adr = makeAdr("ARCH-005", `## Decision\n${"A".repeat(9000)}`);
    expect(collectBriefingBudgetWarnings([adr], 0)).toEqual([]);
  });

  test("defaults to the same cap briefAdr truncates at", () => {
    const adr = makeAdr(
      "ARCH-006",
      `## Decision\n${"A".repeat(DEFAULT_MAX_SECTION_CHARS + 1)}`
    );
    expect(collectBriefingBudgetWarnings([adr])).toHaveLength(1);
    const atCap = makeAdr(
      "ARCH-007",
      `## Decision\n${"A".repeat(DEFAULT_MAX_SECTION_CHARS)}`
    );
    expect(collectBriefingBudgetWarnings([atCap])).toEqual([]);
  });

  test("carries the ADR file path through for reporting", () => {
    const adr = makeAdr(
      "ARCH-008",
      `## Decision\n${"A".repeat(300)}`,
      "/repo/.archgate/adrs/ARCH-008-x.md"
    );
    expect(collectBriefingBudgetWarnings([adr], 100)[0].file).toBe(
      "/repo/.archgate/adrs/ARCH-008-x.md"
    );
  });
});

describe("collectBriefingDiagnostics", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-adrsec-"));
    mkdirSync(join(dir, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  async function writeAdrFile(name: string, body: string) {
    await Bun.write(join(dir, ".archgate", "adrs", name), body);
  }

  test("reports over-budget sections with project-relative paths", async () => {
    await writeAdrFile(
      "ARCH-001-x.md",
      `---\nid: ARCH-001\ntitle: X\ndomain: architecture\nrules: false\n---\n\n## Decision\n${"A".repeat(3000)}\n`
    );
    const { briefingWarnings, unparsedAdrs } =
      await collectBriefingDiagnostics(dir);
    expect(unparsedAdrs).toEqual([]);
    expect(briefingWarnings).toHaveLength(1);
    expect(briefingWarnings[0].adrId).toBe("ARCH-001");
    expect(briefingWarnings[0].file).toBe(".archgate/adrs/ARCH-001-x.md");
  });

  // An unparsed ADR is measured by nothing, so silence here would read as
  // "nothing over budget" when the file was simply never inspected.
  test("names ADRs that could not be parsed", async () => {
    await writeAdrFile(
      "ARCH-001-x.md",
      "---\nid: ARCH-001\ntitle: X\ndomain: architecture\nrules: false\n---\n\n## Decision\nShort.\n"
    );
    await writeAdrFile("ZZ-broken.md", "no frontmatter at all");
    const { briefingWarnings, unparsedAdrs } =
      await collectBriefingDiagnostics(dir);
    // Project-relative and POSIX-separated, matching `briefingWarnings.file`:
    // the GitHub Actions and SARIF reporters emit this value as-is, and GitHub
    // resolves both against the repository root. A bare filename would anchor
    // the finding to a nonexistent root-level file.
    expect(unparsedAdrs).toEqual([".archgate/adrs/ZZ-broken.md"]);
    expect(briefingWarnings).toEqual([]);
  });

  test("honours a caller-supplied cap so diagnostics match the truncation applied", async () => {
    await writeAdrFile(
      "ARCH-002-y.md",
      "---\nid: ARCH-002\ntitle: Y\ndomain: architecture\nrules: false\n---\n\n## Decision\nJust over fifty characters of prose for this decision.\n"
    );
    const tight = await collectBriefingDiagnostics(dir, 20);
    expect(tight.briefingWarnings[0].cap).toBe(20);
    const loose = await collectBriefingDiagnostics(dir, 0);
    expect(loose.briefingWarnings).toEqual([]);
  });
});
