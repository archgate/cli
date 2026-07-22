// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
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

  test("(g) rejects a relative allowedDirs entry that resolves outside .archgate/", () => {
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

  test("(i) rejects an allowedDirs entry that is a file, not a directory", () => {
    writeFileSync(join(archgate, "lib.ts"), "export const x = 1;\n");
    writeConfig({ ruleImports: { allowedDirs: [".archgate/lib.ts"] } });
    expect(() => resolveRuleImportDirs(root)).toThrow(/not a directory/u);
  });

  test("(j) rejects when .archgate/ itself is a symlink escaping the project", () => {
    // Build a sibling project whose `.archgate` is a symlink to a dir outside
    // the project tree, containing an otherwise-valid `lib/` dir. Without the
    // project-root anchor, the containment check would pass against the escaped
    // realpath and authorize imports outside the repo.
    const project = join(root, "project");
    mkdirSync(project, { recursive: true });
    const external = join(root, "external-archgate");
    mkdirSync(join(external, "lib"), { recursive: true });
    symlinkSync(external, join(project, ".archgate"));
    writeFileSync(
      join(project, ".archgate", "config.json"),
      JSON.stringify(
        { ruleImports: { allowedDirs: [".archgate/lib"] } },
        null,
        2
      )
    );
    expect(() => resolveRuleImportDirs(project)).toThrow(
      /outside the project root/u
    );
  });

  test("(k) surfaces a non-ENOENT realpath fault instead of silently disabling", () => {
    mkdirSync(join(archgate, "lib"), { recursive: true });
    writeConfig({ ruleImports: { allowedDirs: [".archgate/lib"] } });
    // A real filesystem fault (e.g. EACCES) on an otherwise-valid, configured
    // project must surface, not fall back to [] like the missing-.archgate case.
    const throwEacces = (): never => {
      const err = new Error("EACCES: permission denied") as Error & {
        code: string;
      };
      err.code = "EACCES";
      throw err;
    };
    const spy = spyOn(fs, "realpathSync").mockImplementation(
      throwEacces as unknown as typeof fs.realpathSync
    );
    try {
      expect(() => resolveRuleImportDirs(root)).toThrow(
        /Could not resolve the \.archgate\/ directory/u
      );
    } finally {
      spy.mockRestore();
    }
  });
});
