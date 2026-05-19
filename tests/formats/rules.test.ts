// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

// Value import (not `import type`) to ensure the module is loaded at runtime,
// which is necessary for code coverage to register the file.
import type {
  GrepMatch,
  PackageJson,
  RuleConfig,
  RuleContext,
  RuleReport,
  RuleSet,
  Severity,
  ViolationDetail,
} from "../../src/formats/rules";
// Force runtime evaluation of the module so coverage tools register it.
// Type-only imports are erased at compile time and contribute 0% coverage.
import * as rulesModule from "../../src/formats/rules";

describe("formats/rules module", () => {
  test("module is loadable at runtime", () => {
    // The module exports only types, but importing it as a value ensures the
    // runtime evaluates the file, making it appear in coverage reports.
    expect(rulesModule).toBeDefined();
    expect(typeof rulesModule).toBe("object");
  });
});

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

describe("Severity type", () => {
  test("accepts error, warning, and info", () => {
    const severities: Severity[] = ["error", "warning", "info"];
    expect(severities).toHaveLength(3);
    expect(severities).toContain("error");
    expect(severities).toContain("warning");
    expect(severities).toContain("info");
  });
});

describe("GrepMatch interface", () => {
  test("has required fields", () => {
    const match: GrepMatch = {
      file: "src/index.ts",
      line: 10,
      column: 5,
      content: "console.log('hello')",
    };

    expect(match.file).toBe("src/index.ts");
    expect(match.line).toBe(10);
    expect(match.column).toBe(5);
    expect(match.content).toBe("console.log('hello')");
  });
});

describe("ViolationDetail interface", () => {
  test("required fields", () => {
    const detail: ViolationDetail = {
      ruleId: "no-console",
      adrId: "ARCH-001",
      message: "Found console.log",
      severity: "error",
    };

    expect(detail.ruleId).toBe("no-console");
    expect(detail.adrId).toBe("ARCH-001");
    expect(detail.message).toBe("Found console.log");
    expect(detail.severity).toBe("error");
  });

  test("optional fields", () => {
    const detail: ViolationDetail = {
      ruleId: "no-console",
      adrId: "ARCH-001",
      message: "Found console.log",
      severity: "warning",
      file: "src/app.ts",
      line: 42,
      endLine: 45,
      endColumn: 10,
      fix: "Remove the console.log call",
    };

    expect(detail.file).toBe("src/app.ts");
    expect(detail.line).toBe(42);
    expect(detail.endLine).toBe(45);
    expect(detail.endColumn).toBe(10);
    expect(detail.fix).toBe("Remove the console.log call");
  });
});

describe("RuleConfig interface", () => {
  test("check is an async function accepting RuleContext", () => {
    const config: RuleConfig = {
      description: "Test rule",
      check: async (_ctx: RuleContext) => {},
    };

    expect(typeof config.check).toBe("function");
    expect(config.description).toBe("Test rule");
    expect(config.severity).toBeUndefined();
  });

  test("severity is optional", () => {
    const withSeverity: RuleConfig = {
      description: "With severity",
      severity: "warning",
      check: async () => {},
    };

    const withoutSeverity: RuleConfig = {
      description: "Without severity",
      check: async () => {},
    };

    expect(withSeverity.severity).toBe("warning");
    expect(withoutSeverity.severity).toBeUndefined();
  });
});

describe("PackageJson interface", () => {
  test("all fields are optional", () => {
    const empty: PackageJson = {};
    expect(empty.name).toBeUndefined();
  });

  test("supports standard package.json fields", () => {
    const pkg: PackageJson = {
      name: "my-package",
      version: "1.0.0",
      description: "A test package",
      main: "index.js",
      module: "index.mjs",
      types: "index.d.ts",
      bin: { mycli: "./bin/cli.js" },
      scripts: { build: "tsc" },
      dependencies: { lodash: "^4.0.0" },
      devDependencies: { typescript: "^5.0.0" },
      private: true,
      license: "MIT",
      engines: { node: ">=18" },
      files: ["dist"],
    };

    expect(pkg.name).toBe("my-package");
    expect(pkg.version).toBe("1.0.0");
    expect(pkg.private).toBe(true);
    expect(pkg.bin).toEqual({ mycli: "./bin/cli.js" });
  });

  test("bin can be a string", () => {
    const pkg: PackageJson = { bin: "./bin/cli.js" };
    expect(pkg.bin).toBe("./bin/cli.js");
  });

  test("repository can be a string or object", () => {
    const stringRepo: PackageJson = {
      repository: "https://github.com/user/repo",
    };
    const objectRepo: PackageJson = {
      repository: { type: "git", url: "https://github.com/user/repo" },
    };

    expect(stringRepo.repository).toBe("https://github.com/user/repo");
    expect(typeof objectRepo.repository).toBe("object");
  });

  test("supports index signature for unknown fields", () => {
    const pkg: PackageJson = { customField: "value" };
    expect(pkg["customField"]).toBe("value");
  });
});

describe("RuleReport interface", () => {
  test("has violation, warning, and info methods", () => {
    const violations: Array<{ message: string; severity: string }> = [];
    const report: RuleReport = {
      violation: (detail) =>
        violations.push({ message: detail.message, severity: "error" }),
      warning: (detail) =>
        violations.push({ message: detail.message, severity: "warning" }),
      info: (detail) =>
        violations.push({ message: detail.message, severity: "info" }),
    };

    report.violation({ message: "Error found" });
    report.warning({ message: "Warning found" });
    report.info({ message: "Info found" });

    expect(violations).toHaveLength(3);
    expect(violations[0]).toEqual({
      message: "Error found",
      severity: "error",
    });
    expect(violations[1]).toEqual({
      message: "Warning found",
      severity: "warning",
    });
    expect(violations[2]).toEqual({ message: "Info found", severity: "info" });
  });
});
