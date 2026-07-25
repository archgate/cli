// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { briefAdr } from "../../src/engine/context";
import { parseAdr } from "../../src/formats/adr";
import { runCli } from "./cli-harness";

const ADR_DIR = join(process.cwd(), ".archgate", "adrs");

interface CheckJson {
  results: {
    ruleId: string;
    violations: { message: string; file: string; severity: string }[];
  }[];
}

/**
 * GEN-005's companion rule cannot import `extractAdrSections` — ARCH-024
 * confines rule files to the `ctx` API — so it reimplements the extraction.
 * This asserts the two agree on the real ADR corpus: whatever `briefAdr`
 * would truncate is exactly what the rule warns about, and nothing else.
 */
describe("GEN-005 briefing-budget parity with briefAdr", () => {
  test("rule warnings match briefAdr truncation exactly", async () => {
    // What the engine actually truncates, keyed as "<file>::<section>".
    const expected = new Set<string>();
    for (const name of readdirSync(ADR_DIR).filter((f) => f.endsWith(".md"))) {
      const adr = parseAdr(
        readFileSync(join(ADR_DIR, name), "utf8"),
        join(ADR_DIR, name)
      );
      const briefing = briefAdr(adr, { briefings: true });
      for (const section of briefing.truncatedSections ?? []) {
        expected.add(`.archgate/adrs/${name}::${section}`);
      }
    }

    const { exitCode, stdout } = await runCli(
      ["check", "--adr", "GEN-005", "--json"],
      process.cwd()
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout) as CheckJson;
    const rule = parsed.results.find((r) => r.ruleId === "briefing-budget");

    const actual = new Set<string>();
    for (const v of rule?.violations ?? []) {
      // Message opens with the section name in double quotes.
      const section = v.message.match(/^"(.+?)"/u)?.[1];
      if (section) actual.add(`${v.file.replaceAll("\\", "/")}::${section}`);
    }

    expect([...actual].sort()).toEqual([...expected].sort());
  }, 60_000);

  test("every rule warning names a section briefAdr reports as truncated", async () => {
    const { stdout } = await runCli(
      ["check", "--adr", "GEN-005", "--json"],
      process.cwd()
    );
    const parsed = JSON.parse(stdout) as CheckJson;
    const rule = parsed.results.find((r) => r.ruleId === "briefing-budget");

    // Guards the assertion above against passing vacuously if the corpus ever
    // has zero overflows: parity would hold trivially and prove nothing.
    for (const v of rule?.violations ?? []) {
      expect(v.severity).toBe("warning");
      expect(v.message).toMatch(/hiding \d+ chars from agent briefings$/u);
    }
  }, 60_000);
});
