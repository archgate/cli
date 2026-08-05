// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { shallowClone } from "../../src/helpers/registry";
import { git, safeRmSync } from "../test-utils";

/** Await a rejection and hand back its message for assertions. */
async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the promise to reject");
}

describe("shallowClone", () => {
  let fixtureRoot: string;
  let bareUrl: string;
  const cloneDirs: string[] = [];

  /** Names of the temp dirs shallowClone creates, so leaks are detectable. */
  function importTempDirs(): string[] {
    return readdirSync(tmpdir()).filter((entry) =>
      entry.startsWith("archgate-import-")
    );
  }

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "archgate-registry-fixture-"));
    const work = join(fixtureRoot, "work");
    const adrsDir = join(work, "packs", "demo", "adrs");
    mkdirSync(adrsDir, { recursive: true });
    writeFileSync(
      join(work, "packs", "demo", "archgate-pack.yaml"),
      [
        "name: demo",
        "version: 1.0.0",
        "description: Clone fixture pack",
        "maintainers:",
        "  - github: testuser",
      ].join("\n")
    );
    writeFileSync(
      join(adrsDir, "DEMO-001-first.md"),
      "---\nid: DEMO-001\n---\n"
    );

    await git(["init", "--initial-branch=main"], work);
    // CI has no global git identity, so the commits below need a local one.
    await git(["config", "user.email", "test@test.com"], work);
    await git(["config", "user.name", "Test"], work);
    await git(["config", "commit.gpgsign", "false"], work);
    await git(["add", "."], work);
    await git(["commit", "-m", "initial"], work);
    await git(["tag", "v1.0.0"], work);

    writeFileSync(
      join(adrsDir, "DEMO-002-second.md"),
      "---\nid: DEMO-002\n---\n"
    );
    await git(["add", "."], work);
    await git(["commit", "-m", "second"], work);

    const bare = join(fixtureRoot, "fixture.git");
    await git(["clone", "--bare", work, bare], fixtureRoot);
    // `--depth 1` is only honoured for a file:// URL, not a bare local path.
    bareUrl = pathToFileURL(bare).href;
  });

  afterAll(() => {
    for (const dir of cloneDirs) safeRmSync(dir);
    safeRmSync(fixtureRoot);
  });

  test("clones the default branch into a temp directory", async () => {
    const dir = await shallowClone(bareUrl);
    cloneDirs.push(dir);

    expect(readdirSync(join(dir, "packs", "demo", "adrs")).sort()).toEqual([
      "DEMO-001-first.md",
      "DEMO-002-second.md",
    ]);
  });

  test("clones at an explicit ref", async () => {
    const dir = await shallowClone(bareUrl, "v1.0.0");
    cloneDirs.push(dir);

    expect(readdirSync(join(dir, "packs", "demo", "adrs"))).toEqual([
      "DEMO-001-first.md",
    ]);
  });

  test("throws a UserError and cleans up when git reports a bad ref", async () => {
    const before = importTempDirs();

    expect(
      await rejectionMessage(shallowClone(bareUrl, "no-such-tag"))
    ).toMatch(/Failed to clone .*\(ref: no-such-tag\)/su);

    expect(importTempDirs().filter((d) => !before.includes(d))).toEqual([]);
  });

  test("throws a UserError and cleans up when the repository is missing", async () => {
    const missing = pathToFileURL(join(fixtureRoot, "absent.git")).href;
    const before = importTempDirs();

    expect(await rejectionMessage(shallowClone(missing))).toMatch(
      /Failed to clone/u
    );

    expect(importTempDirs().filter((d) => !before.includes(d))).toEqual([]);
  });

  test("removes the temp directory and rethrows when the spawn itself fails", async () => {
    const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
      throw new Error("spawn unavailable");
    });
    try {
      const before = importTempDirs();

      expect(await rejectionMessage(shallowClone(bareUrl))).toBe(
        "spawn unavailable"
      );

      expect(importTempDirs().filter((d) => !before.includes(d))).toEqual([]);
    } finally {
      spawnSpy.mockRestore();
    }
  });
});
