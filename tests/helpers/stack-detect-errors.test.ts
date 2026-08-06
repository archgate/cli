// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Failure paths of stack detection: unreadable or unparseable project files,
 * and a disk cache that cannot be read or written. Detection is best-effort
 * everywhere — a broken input must degrade the result, never throw. Kept
 * separate from stack-detect.test.ts, which covers the happy paths.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectStack,
  detectStackUncached,
} from "../../src/helpers/stack-detect";
import { restoreEnv, safeRmSync } from "../test-utils";

describe("detectStackUncached with unreadable project files", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-err-"));
  });

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  test("keeps the file-based signals when package.json is not valid JSON", async () => {
    writeFileSync(join(tempDir, "package.json"), "{ not json");

    const stack = await detectStackUncached(tempDir);

    // The file's presence still implies node + javascript; only the
    // dependency-derived frameworks are lost.
    expect(stack.runtimes).toContain("node");
    expect(stack.languages).toEqual(["javascript"]);
    expect(stack.frameworks).toEqual([]);
  });

  test("detects dart but not flutter when pubspec.yaml cannot be read", async () => {
    // A directory in the file's place: `existsSync` says yes, reading throws.
    mkdirSync(join(tempDir, "pubspec.yaml"));

    const stack = await detectStackUncached(tempDir);

    expect(stack.languages).toContain("dart");
    expect(stack.frameworks).not.toContain("flutter");
  });

  test("detects elixir but not phoenix when mix.exs cannot be read", async () => {
    mkdirSync(join(tempDir, "mix.exs"));

    const stack = await detectStackUncached(tempDir);

    expect(stack.languages).toContain("elixir");
    expect(stack.frameworks).not.toContain("phoenix");
  });

  test("detects python when requirements.txt cannot be read", async () => {
    mkdirSync(join(tempDir, "requirements.txt"));

    const stack = await detectStackUncached(tempDir);

    expect(stack.languages).toContain("python");
    expect(stack.frameworks).toEqual([]);
  });

  test("detects python when pyproject.toml is not valid TOML", async () => {
    writeFileSync(join(tempDir, "pyproject.toml"), "[project\nname = ");

    const stack = await detectStackUncached(tempDir);

    expect(stack.languages).toContain("python");
    expect(stack.frameworks).toEqual([]);
  });
});

describe("detectStack disk cache failures", () => {
  let tempDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-cache-"));
    // The cache lives under ~/.archgate/cache — redirect it so no test ever
    // reads or writes the real user-scope cache.
    homeDir = mkdtempSync(join(tmpdir(), "archgate-stack-home-"));
    originalHome = Bun.env.HOME;
    originalUserProfile = Bun.env.USERPROFILE;
    Bun.env.HOME = homeDir;
    Bun.env.USERPROFILE = homeDir;
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    if (tempDir) safeRmSync(tempDir);
    if (homeDir) safeRmSync(homeDir);
  });

  /** Wait for the fire-and-forget cache write kicked off by detectStack. */
  async function waitForCacheFile(cacheDir: string): Promise<string> {
    /* oxlint-disable no-await-in-loop -- polling is inherently sequential */
    for (let attempt = 0; attempt < 50; attempt++) {
      if (existsSync(cacheDir)) {
        const hit = readdirSync(cacheDir).find(
          (f) => f.startsWith("stack-") && f.endsWith(".json")
        );
        if (hit !== undefined) return join(cacheDir, hit);
      }
      await Bun.sleep(20);
    }
    /* oxlint-enable no-await-in-loop */
    throw new Error(`no stack cache file appeared in ${cacheDir}`);
  }

  test("re-runs full detection when the cached file is corrupt", async () => {
    writeFileSync(join(tempDir, "go.mod"), "module example.com/test");

    const first = await detectStack(tempDir);
    const cachePath = await waitForCacheFile(
      join(homeDir, ".archgate", "cache")
    );
    writeFileSync(cachePath, "{ not json");

    // A corrupt cache is treated as a miss, not an error.
    expect(await detectStack(tempDir)).toEqual(first);
    expect(first.languages).toContain("go");
  });

  test("returns a stack even when the cache cannot be written", async () => {
    writeFileSync(join(tempDir, "Cargo.toml"), '[package]\nname = "t"');
    // A regular file where the cache directory belongs, so Bun.write cannot
    // create the parent and the write rejects.
    mkdirSync(join(homeDir, ".archgate"), { recursive: true });
    writeFileSync(join(homeDir, ".archgate", "cache"), "not a directory");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("rust");

    // Let the background write settle so its rejection is observed here
    // rather than escaping into a later test file.
    await Bun.sleep(50);
    expect(statSync(join(homeDir, ".archgate", "cache")).isFile()).toBe(true);
  });
});
