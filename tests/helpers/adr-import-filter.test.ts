// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ImportsManifest } from "../../src/formats/pack";
import {
  filterAdrsToImport,
  indexUpstreamAdrs,
  parseIdList,
  updateImportsManifest,
  type AdrToImport,
} from "../../src/helpers/adr-import";
import { UserError } from "../../src/helpers/user-error";
import { safeRmSync } from "../test-utils";

function adr(originalId: string): AdrToImport {
  return {
    sourcePath: `/src/${originalId}.md`,
    rulesPath: null,
    originalId,
    title: `Title ${originalId}`,
    domain: "architecture",
    source: "packs/sec",
    packVersion: "1.0.0",
  };
}

const ADRS = ["SEC-001", "SEC-002", "SEC-003"].map((id) => adr(id));
const ids = (list: AdrToImport[]) => list.map((a) => a.originalId);

describe("parseIdList", () => {
  test.each([
    { input: undefined, expected: [] },
    { input: ["A", "B"], expected: ["A", "B"] },
    { input: ["A,B", "C"], expected: ["A", "B", "C"] },
    { input: [" A , ,B "], expected: ["A", "B"] },
  ])("parses $input", ({ input, expected }) => {
    expect(parseIdList(input, "--only")).toEqual([...expected]);
  });

  test.each([[[","]], [[" "]], [[" , "]]])(
    "rejects a supplied option with no ID (%j)",
    (input) => {
      expect(() => parseIdList(input, "--only")).toThrow(
        "--only needs at least one ADR ID."
      );
    }
  );
});

describe("filterAdrsToImport", () => {
  test("returns every ADR when no filter is given", () => {
    expect(filterAdrsToImport(ADRS, {})).toBe(ADRS);
  });

  test("--exclude drops the listed IDs", () => {
    expect(ids(filterAdrsToImport(ADRS, { exclude: ["SEC-002"] }))).toEqual([
      "SEC-001",
      "SEC-003",
    ]);
  });

  test("--only keeps the listed IDs in source order", () => {
    expect(
      ids(filterAdrsToImport(ADRS, { only: ["SEC-003", "SEC-001"] }))
    ).toEqual(["SEC-001", "SEC-003"]);
  });

  test("matches IDs case-insensitively", () => {
    expect(ids(filterAdrsToImport(ADRS, { only: ["sec-002"] }))).toEqual([
      "SEC-002",
    ]);
  });

  test("excluding every ADR returns an empty list", () => {
    expect(
      filterAdrsToImport(ADRS, { exclude: ["SEC-001", "SEC-002", "SEC-003"] })
    ).toEqual([]);
  });

  test.each([
    { filter: { exclude: ["SEC-009"] } },
    { filter: { only: ["SEC-001", "NOPE-1"] } },
  ])("throws UserError for an unknown ID ($filter)", ({ filter }) => {
    expect(() => filterAdrsToImport(ADRS, filter)).toThrow(UserError);
    expect(() => filterAdrsToImport(ADRS, filter)).toThrow(
      "Available IDs: SEC-001, SEC-002, SEC-003"
    );
  });
});

describe("updateImportsManifest", () => {
  test("records each local ID's source ID", () => {
    const manifest: ImportsManifest = { imports: [] };
    updateImportsManifest(
      manifest,
      [adr("SEC-001"), adr("SEC-003")],
      [
        { original: "SEC-001", newId: "ARCH-004", title: "a" },
        { original: "SEC-003", newId: "ARCH-005", title: "b" },
      ]
    );
    expect(manifest.imports[0].adrIds).toEqual(["ARCH-004", "ARCH-005"]);
    expect(manifest.imports[0].originalIds).toEqual({
      "ARCH-004": "SEC-001",
      "ARCH-005": "SEC-003",
    });
  });
});

describe("indexUpstreamAdrs", () => {
  let dir: string;

  const write = (file: string, id: string) => {
    writeFileSync(
      join(dir, file),
      `---\nid: ${id}\ntitle: T\ndomain: architecture\nrules: false\n---\n\n## Context\n`
    );
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "archgate-upstream-index-"));
    write("SEC-001-x.md", "SEC-001");
    write("SEC-002-x.md", "SEC-002");
    write("SEC-002-z-duplicate.md", "SEC-002");
    writeFileSync(join(dir, "broken.md"), "no frontmatter");
    writeFileSync(join(dir, "bad-yaml.md"), "---\nid: [\n---\n");
  });

  afterEach(() => {
    safeRmSync(dir);
  });

  test("maps each id to its file, first sorted match wins", () => {
    expect(indexUpstreamAdrs(dir)).toEqual(
      new Map([
        ["SEC-001", join(dir, "SEC-001-x.md")],
        ["SEC-002", join(dir, "SEC-002-x.md")],
      ])
    );
  });

  test("propagates read errors instead of skipping the file", () => {
    mkdirSync(join(dir, "SEC-003-dir.md"));
    expect(() => indexUpstreamAdrs(dir)).toThrow();
  });
});
