// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import type { RuleSet } from "../../src/formats/rules";

describe("RuleSet type", () => {
  test("plain object satisfies RuleSet shape", () => {
    const ruleSet: RuleSet = {
      rules: {
        "no-console": {
          description: "Disallow console.log",
          check: async () => {},
        },
      },
    };

    expect(ruleSet).toHaveProperty("rules");
    expect(ruleSet.rules["no-console"]).toBeDefined();
  });

  test("supports multiple rules with severity", () => {
    const ruleSet: RuleSet = {
      rules: {
        "rule-a": {
          description: "Rule A",
          severity: "warning",
          check: async () => {},
        },
        "rule-b": {
          description: "Rule B",
          severity: "error",
          check: async () => {},
        },
        "rule-c": {
          description: "Rule C",
          severity: "info",
          check: async () => {},
        },
      },
    };

    expect(Object.keys(ruleSet.rules)).toEqual(["rule-a", "rule-b", "rule-c"]);
    expect(ruleSet.rules["rule-a"].severity).toBe("warning");
    expect(ruleSet.rules["rule-b"].severity).toBe("error");
    expect(ruleSet.rules["rule-c"].severity).toBe("info");
  });

  test("severity defaults to undefined (engine applies 'error' default)", () => {
    const ruleSet: RuleSet = {
      rules: { "my-rule": { description: "A rule", check: async () => {} } },
    };

    expect(ruleSet.rules["my-rule"].severity).toBeUndefined();
  });

  test("preserves check function references", () => {
    const checkFn = async () => {};
    const ruleSet: RuleSet = {
      rules: { "test-rule": { description: "Test", check: checkFn } },
    };

    expect(ruleSet.rules["test-rule"].check).toBe(checkFn);
  });
});
