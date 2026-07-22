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

import { resolveRuleImportDirs } from "../../src/helpers/project-config";

describe("resolveRuleImportDirs (rule-import containment)", () => {
  let root: string;
  let archgate: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "archgate-rule-imports-")));
    archgate = join(root, ".archgate");
    mkdirSync(archgate, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(config: unknown): void {
    writeFileSync(
      join(archgate, "config.json"),
      JSON.stringify(config, null, 2)
    );
  }

  test("returns [] when the field is absent", () => {
    writeConfig({ domains: {} });
    expect(resolveRuleImportDirs(root)).toEqual([]);
  });

  test("returns [] when allowedDirs is empty", () => {
    writeConfig({ domains: {}, ruleImports: { allowedDirs: [] } });
    expect(resolveRuleImportDirs(root)).toEqual([]);
  });

  test("resolves a valid dir inside .archgate/ to its realpath", () => {
    mkdirSync(join(archgate, "lib"), { recursive: true });
    writeConfig({ ruleImports: { allowedDirs: [".archgate/lib"] } });
    const dirs = resolveRuleImportDirs(root);
    expect(dirs).toEqual([realpathSync(join(archgate, "lib"))]);
  });

  test("(g) rejects an allowedDirs entry that escapes via ..", () => {
    // A dir that exists but is outside .archgate/.
    mkdirSync(join(root, "outside"), { recursive: true });
    writeConfig({ ruleImports: { allowedDirs: ["outside"] } });
    expect(() => resolveRuleImportDirs(root)).toThrow(/outside \.archgate/u);
  });

  test("(g) rejects an absolute-path entry outside .archgate/", () => {
    const abs = realpathSync(tmpdir());
    writeConfig({ ruleImports: { allowedDirs: [abs] } });
    expect(() => resolveRuleImportDirs(root)).toThrow(/outside \.archgate/u);
  });

  test("(g) rejects a symlinked allowed dir whose target escapes .archgate/", () => {
    mkdirSync(join(root, "external"), { recursive: true });
    symlinkSync(join(root, "external"), join(archgate, "liblink"));
    writeConfig({ ruleImports: { allowedDirs: [".archgate/liblink"] } });
    expect(() => resolveRuleImportDirs(root)).toThrow(/outside \.archgate/u);
  });

  test("(g) rejects a non-existent allowedDirs entry", () => {
    writeConfig({ ruleImports: { allowedDirs: [".archgate/nope"] } });
    expect(() => resolveRuleImportDirs(root)).toThrow(/does not exist/u);
  });
});
