import { describe, expect, test } from "bun:test";

import { defineRules } from "../../src/formats/rules";
import type { RuleConfig, RuleSet } from "../../src/formats/rules";

describe("defineRules", () => {
  test("wraps rules record into a RuleSet", () => {
    const rules: Record<string, RuleConfig> = {
      "no-console": {
        description: "Disallow console.log",
        check: async () => {},
      },
    };

    const result = defineRules(rules);
    expect(result).toHaveProperty("rules");
    expect(result.rules).toBe(rules);
  });

  test("returns correct structure with multiple rules", () => {
    const result = defineRules({
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
    });

    expect(Object.keys(result.rules)).toEqual(["rule-a", "rule-b", "rule-c"]);
    expect(result.rules["rule-a"].severity).toBe("warning");
    expect(result.rules["rule-b"].severity).toBe("error");
    expect(result.rules["rule-c"].severity).toBe("info");
  });

  test("defaults severity to undefined (engine applies 'error' default)", () => {
    const result = defineRules({
      "my-rule": { description: "A rule", check: async () => {} },
    });

    expect(result.rules["my-rule"].severity).toBeUndefined();
  });

  test("preserves check function references", () => {
    const checkFn = async () => {};
    const result = defineRules({
      "test-rule": { description: "Test", check: checkFn },
    });

    expect(result.rules["test-rule"].check).toBe(checkFn);
  });

  test("satisfies RuleSet type", () => {
    const result: RuleSet = defineRules({
      "typed-rule": { description: "Typed", check: async () => {} },
    });

    expect(result.rules).toBeDefined();
  });
});
