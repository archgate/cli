// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rulesSourceText } from "../../src/helpers/rules-source";

describe("rulesSourceText", () => {
  test("resolves and returns the full text of src/formats/rules.ts", () => {
    const expected = readFileSync(
      join(import.meta.dir, "..", "..", "src", "formats", "rules.ts"),
      "utf8"
    );

    expect(rulesSourceText()).toBe(expected);
  });

  test("carries the RuleContext interface the shim derives from", () => {
    expect(rulesSourceText()).toContain("export interface RuleContext {");
  });
});
