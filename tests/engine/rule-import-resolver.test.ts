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

import {
  isRelativeSpecifier,
  resolveContainedImport,
} from "../../src/engine/rule-import-resolver";

describe("isRelativeSpecifier", () => {
  test("recognizes ./ and ../ prefixes", () => {
    expect(isRelativeSpecifier("./x")).toBe(true);
    expect(isRelativeSpecifier("../x")).toBe(true);
  });

  test("rejects bare, scheme, and absolute specifiers", () => {
    expect(isRelativeSpecifier("x")).toBe(false);
    expect(isRelativeSpecifier("some-package")).toBe(false);
    expect(isRelativeSpecifier("node:fs")).toBe(false);
    expect(isRelativeSpecifier("/abs/path")).toBe(false);
  });
});

describe("resolveContainedImport", () => {
  let root: string;
  let libDir: string;
  let allowed: string[];
  let fromFile: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "archgate-resolver-")));
    libDir = join(root, ".archgate", "lib");
    mkdirSync(libDir, { recursive: true });
    allowed = [realpathSync(libDir)];
    fromFile = join(root, ".archgate", "adrs", "ADR.rules.ts");
    mkdirSync(join(root, ".archgate", "adrs"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns null when allowedDirs is empty", () => {
    writeFileSync(join(libDir, "helper.ts"), "export const x = 1;\n");
    expect(resolveContainedImport("../lib/helper", fromFile, [])).toBeNull();
  });

  test("resolves a .ts file inside an allowed dir to its realpath", () => {
    const helper = join(libDir, "helper.ts");
    writeFileSync(helper, "export const x = 1;\n");
    expect(resolveContainedImport("../lib/helper", fromFile, allowed)).toBe(
      realpathSync(helper)
    );
  });

  test("resolves a directory to its index file", () => {
    mkdirSync(join(libDir, "util"), { recursive: true });
    const idx = join(libDir, "util", "index.ts");
    writeFileSync(idx, "export const x = 1;\n");
    expect(resolveContainedImport("../lib/util", fromFile, allowed)).toBe(
      realpathSync(idx)
    );
  });

  test("returns null for a target that does not exist", () => {
    expect(
      resolveContainedImport("../lib/missing", fromFile, allowed)
    ).toBeNull();
  });

  test("returns null for a target that resolves outside the allowed dir", () => {
    mkdirSync(join(root, "outside"), { recursive: true });
    writeFileSync(join(root, "outside", "mod.ts"), "export const x = 1;\n");
    expect(
      resolveContainedImport("../../outside/mod", fromFile, allowed)
    ).toBeNull();
  });

  test("returns null when a symlink inside the allowed dir escapes it", () => {
    mkdirSync(join(root, "external"), { recursive: true });
    const target = join(root, "external", "target.ts");
    writeFileSync(target, "export const x = 1;\n");
    symlinkSync(target, join(libDir, "link.ts"));
    expect(resolveContainedImport("../lib/link", fromFile, allowed)).toBeNull();
  });
});
