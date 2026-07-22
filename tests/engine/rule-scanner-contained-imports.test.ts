// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanRuleSource } from "../../src/engine/rule-scanner";

/**
 * Direct-scanner coverage for the opt-in "contained relative import" feature.
 * The loader-level, config-driven path is exercised in
 * `loader-contained-imports.test.ts`; here we drive `scanRuleSource` directly
 * with realpath'd `allowedImportDirs` to isolate the containment + transitive
 * logic.
 */
describe("scanRuleSource contained relative imports", () => {
  let root: string;
  let archgate: string;
  let adrsDir: string;
  let libDir: string;
  let allowed: string[];
  let rulesFile: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "archgate-contained-")));
    archgate = join(root, ".archgate");
    adrsDir = join(archgate, "adrs");
    libDir = join(archgate, "lib");
    mkdirSync(adrsDir, { recursive: true });
    mkdirSync(libDir, { recursive: true });
    allowed = [realpathSync(libDir)];
    rulesFile = join(adrsDir, "ADR-001.rules.ts");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const RULE_USING = (expr: string): string =>
    `import { helper } from "../lib/helper";
export default {
  rules: {
    "r": { description: "d", async check() { ${expr}; } },
  },
};`;

  test("(a) allows a relative import of a file inside a configured .archgate dir", () => {
    writeFileSync(join(libDir, "helper.ts"), `export function helper() {}\n`);
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations).toHaveLength(0);
  });

  test("(a') allows an extensionless index import inside a configured dir", () => {
    mkdirSync(join(libDir, "util"), { recursive: true });
    writeFileSync(
      join(libDir, "util", "index.ts"),
      `export function helper() {}\n`
    );
    const source = `import { helper } from "../lib/util";
export default { rules: { r: { description: "d", async check() { helper(); } } } };`;
    const violations = scanRuleSource(source, {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations).toHaveLength(0);
  });

  test("(b) blocks a relative import resolving outside .archgate/", () => {
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(
      join(root, "outside", "mod.ts"),
      `export function helper() {}\n`
    );
    const source = `import { helper } from "../../outside/mod";
export default { rules: { r: { description: "d", async check() { helper(); } } } };`;
    const violations = scanRuleSource(source, {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("blocked");
    expect(violations[0].message).toContain("../../outside/mod");
  });

  test("(b') blocks a relative import inside .archgate/ but outside the allowed dir", () => {
    mkdirSync(join(archgate, "other"), { recursive: true });
    writeFileSync(
      join(archgate, "other", "mod.ts"),
      `export function helper() {}\n`
    );
    const source = `import { helper } from "../other/mod";
export default { rules: { r: { description: "d", async check() { helper(); } } } };`;
    const violations = scanRuleSource(source, {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("blocked");
  });

  test("(c) blocks a `..` escape that begins with the allowed-dir segment", () => {
    // `../lib/../secrets` normalizes to `.archgate/secrets`, escaping `lib`.
    writeFileSync(
      join(archgate, "secrets.ts"),
      `export function helper() {}\n`
    );
    const source = `import { helper } from "../lib/../secrets";
export default { rules: { r: { description: "d", async check() { helper(); } } } };`;
    const violations = scanRuleSource(source, {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("blocked");
  });

  test("(d) blocks a symlink inside the allowed dir that points outside .archgate/", () => {
    mkdirSync(join(root, "external"), { recursive: true });
    const externalTarget = join(root, "external", "target.ts");
    writeFileSync(externalTarget, `export function helper() {}\n`);
    // symlink lives inside the allowed dir but resolves (realpath) outside it.
    symlinkSync(externalTarget, join(libDir, "helper.ts"));
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("blocked");
  });

  test("(e) blocks a bare (non-relative) specifier even with the feature enabled", () => {
    const source = `import { readFileSync } from "some-package";
export default { rules: { r: { description: "d", async check() { readFileSync(); } } } };`;
    const violations = scanRuleSource(source, {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain('"some-package"');
    expect(violations[0].message).toContain("blocked");
  });

  test("(f) transitively blocks an allowed helper that imports node:child_process", () => {
    writeFileSync(
      join(libDir, "helper.ts"),
      `import { execSync } from "node:child_process";
export function helper() { execSync("ls"); }\n`
    );
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(
      violations.some((v) => v.message.includes("node:child_process"))
    ).toBe(true);
    expect(violations.some((v) => v.message.includes("Imported file"))).toBe(
      true
    );
  });

  test("(f') transitively blocks an allowed helper that uses fetch", () => {
    writeFileSync(
      join(libDir, "helper.ts"),
      `export function helper() { return fetch("https://evil.example"); }\n`
    );
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(
      violations.some(
        (v) =>
          v.message.includes(`"fetch" global`) &&
          v.message.includes("Imported file")
      )
    ).toBe(true);
  });

  test("(f'') transitively blocks a helper reached two hops deep", () => {
    writeFileSync(
      join(libDir, "helper.ts"),
      `import { deep } from "./deep";
export function helper() { deep(); }\n`
    );
    writeFileSync(
      join(libDir, "deep.ts"),
      `export function deep() { eval("1"); }\n`
    );
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations.some((v) => v.message.includes(`"eval" global`))).toBe(
      true
    );
  });

  test("allows a clean multi-file helper chain", () => {
    writeFileSync(
      join(libDir, "helper.ts"),
      `import { pure } from "./pure";
export function helper() { return pure(); }\n`
    );
    writeFileSync(
      join(libDir, "pure.ts"),
      `export function pure() { return 1; }\n`
    );
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations).toHaveLength(0);
  });

  test("terminates on an import cycle between two allowed helpers", () => {
    writeFileSync(
      join(libDir, "helper.ts"),
      `import { b } from "./b";
export function helper() { return b(); }\n`
    );
    writeFileSync(
      join(libDir, "b.ts"),
      `import { helper } from "./helper";
export function b() { return helper; }\n`
    );
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: allowed,
    });
    expect(violations).toHaveLength(0);
  });

  test("(h) blocks a relative import when the feature is not enabled (no opts)", () => {
    writeFileSync(join(libDir, "helper.ts"), `export function helper() {}\n`);
    const violations = scanRuleSource(RULE_USING("helper()"));
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("../lib/helper");
    expect(violations[0].message).toContain("blocked");
  });

  test("(h') blocks a relative import when allowedImportDirs is empty", () => {
    writeFileSync(join(libDir, "helper.ts"), `export function helper() {}\n`);
    const violations = scanRuleSource(RULE_USING("helper()"), {
      filePath: rulesFile,
      allowedImportDirs: [],
    });
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations[0].message).toContain("blocked");
  });
});
