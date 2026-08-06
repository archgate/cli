// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { findProjectRoot, internalPath } from "../../src/helpers/paths";
import { restoreEnv } from "../test-utils";

describe("findProjectRoot", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-paths-test-"));
    // Prevent findProjectRoot() from walking above the temp dir
    Bun.env.ARCHGATE_PROJECT_CEILING = tempDir;
  });

  afterEach(() => {
    delete Bun.env.ARCHGATE_PROJECT_CEILING;
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("finds root when .archgate/adrs/ exists", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });

    const result = findProjectRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds root when .archgate/lint/ exists (custom ADR paths)", () => {
    // A project with custom ADR paths may not have .archgate/adrs/,
    // but .archgate/lint/ is always created by `archgate init`.
    mkdirSync(join(tempDir, ".archgate", "lint"), { recursive: true });

    const result = findProjectRoot(tempDir);
    expect(result).toBe(tempDir);
  });

  test("finds root from a subdirectory", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    const subDir = join(tempDir, "src", "commands");
    mkdirSync(subDir, { recursive: true });

    const result = findProjectRoot(subDir);
    expect(result).toBe(tempDir);
  });

  test("returns null when no project markers found", () => {
    // With the ceiling set, the walk-up is isolated to tempDir
    const result = findProjectRoot(tempDir);
    expect(result).toBeNull();
  });

  test("does not match directory without .archgate/adrs/ or .archgate/lint/", () => {
    // A directory with only a bare .archgate/ (like ~/.archgate/ user cache)
    // should NOT be detected as a project root.
    const parent = join(tempDir, "parent");
    const child = join(parent, "child");
    mkdirSync(child, { recursive: true });
    mkdirSync(join(parent, ".archgate"), { recursive: true });

    const result = findProjectRoot(child);
    expect(result).toBeNull();
  });

  test("respects ARCHGATE_PROJECT_CEILING to isolate tests", () => {
    // The ceiling prevents walk-up past the temp dir, even if
    // ~/.archgate/adrs/ exists on the host machine.
    const nested = join(tempDir, "deep", "nested");
    mkdirSync(nested, { recursive: true });

    const result = findProjectRoot(nested);
    expect(result).toBeNull();
  });

  test("gives up at the ancestor-depth bound instead of walking on", () => {
    mkdirSync(join(tempDir, ".archgate", "adrs"), { recursive: true });
    // Deeper than the 1000-ancestor bound. The directories need not exist —
    // the walk only stats each candidate.
    let deep = tempDir;
    for (let i = 0; i < 1005; i++) deep = join(deep, "d");

    // A real project root sits above, but further than the bound allows.
    expect(findProjectRoot(deep)).toBeNull();
    // Fire-test the other direction: within the bound the same root is found.
    expect(findProjectRoot(join(tempDir, "d"))).toBe(tempDir);
  });
});

describe("internalPath", () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    originalHome = Bun.env.HOME;
    originalUserProfile = Bun.env.USERPROFILE;
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
  });

  test("prefers HOME when it holds a usable value", () => {
    Bun.env.HOME = join("/srv", "someone");
    expect(internalPath("cache")).toBe(
      join("/srv", "someone", ".archgate", "cache")
    );
  });

  test.each(["", "undefined"])(
    "falls back to os.homedir() when HOME is %p",
    (badHome) => {
      const fakeHome = join(tmpdir(), "archgate-fake-home");
      const homeSpy = spyOn(os, "homedir").mockReturnValue(fakeHome);
      try {
        // Shells and tooling surface an unset variable both ways; neither may
        // reach path.join, or an ./undefined/.archgate tree appears under cwd.
        Bun.env.HOME = badHome;
        delete Bun.env.USERPROFILE;

        expect(internalPath("cache")).toBe(
          join(fakeHome, ".archgate", "cache")
        );
      } finally {
        homeSpy.mockRestore();
      }
    }
  );
});
