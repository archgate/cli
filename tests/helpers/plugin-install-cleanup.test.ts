// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import * as platform from "../../src/helpers/platform";
import {
  installCursorPlugin,
  installOpencodePlugin,
} from "../../src/helpers/plugin-install";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;

function fakeSpawnResult(
  exitCode: number,
  stdout = "",
  stderr = ""
): ReturnType<typeof Bun.spawn> {
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 0,
    exitCode: null,
    signalCode: null,
    killed: false,
    stdin: null as never,
    ref: () => {},
    unref: () => {},
    kill: () => {},
    readable: new ReadableStream(),
    [Symbol.asyncDispose]: () => Promise.resolve(),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

function mockFetch(status: number, body: ArrayBuffer | null = null): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      arrayBuffer: () => Promise.resolve(body ?? new ArrayBuffer(0)),
    })) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let spawnSpy: ReturnType<typeof spyOn>;
let tempDir: string;
let savedHome: string | undefined;
let savedXdg: string | undefined;

/**
 * Per-test spy on resolveCommand so CLI availability checks are deterministic.
 * spyOn (not mock.module) — mock.module on a first-party module is
 * process-global, replaces the WHOLE module for every other test file, and is
 * not undone by mock.restore() (ARCH-005).
 */
let mockResolveCommand: ReturnType<typeof spyOn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockResolveCommand = spyOn(platform, "resolveCommand").mockImplementation(
    () => Promise.resolve(null)
  );
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));

  // Redirect user-scope paths into a temp dir. cursorUserDir(),
  // opencodeConfigDir(), and internalPath() all read Bun.env.HOME /
  // XDG_CONFIG_HOME at call time, so an env override (saved and restored
  // per-test) isolates the real paths.ts resolvers — no module mock needed.
  tempDir = realpathSync(mkdtempSync(join(tmpdir(), "archgate-plugin-test-")));
  savedHome = Bun.env.HOME;
  savedXdg = Bun.env.XDG_CONFIG_HOME;
  Bun.env.HOME = tempDir;
  Bun.env.XDG_CONFIG_HOME = tempDir;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  spawnSpy.mockRestore();
  mockResolveCommand.mockRestore();
  mock.restore();
  if (savedHome === undefined) delete Bun.env.HOME;
  else Bun.env.HOME = savedHome;
  if (savedXdg === undefined) delete Bun.env.XDG_CONFIG_HOME;
  else Bun.env.XDG_CONFIG_HOME = savedXdg;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // SQLite handles may persist on Windows
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("plugin install — stale file cleanup", () => {
  describe("opencode", () => {
    test("removes archgate-* agents and skills before extraction", async () => {
      const agentsDir = join(tempDir, "opencode", "agents");
      const skillsDir = join(tempDir, "opencode", "skills");
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(skillsDir, { recursive: true });

      // Seed old archgate files that should be cleaned
      writeFileSync(join(agentsDir, "archgate-developer.md"), "old");
      writeFileSync(join(agentsDir, "archgate-planner.md"), "old");
      mkdirSync(join(skillsDir, "archgate-reviewer"));
      writeFileSync(join(skillsDir, "archgate-reviewer", "SKILL.md"), "old");

      mockFetch(200, new ArrayBuffer(64));

      await installOpencodePlugin("test-token");

      expect(existsSync(join(agentsDir, "archgate-developer.md"))).toBe(false);
      expect(existsSync(join(agentsDir, "archgate-planner.md"))).toBe(false);
      expect(existsSync(join(skillsDir, "archgate-reviewer"))).toBe(false);
    });

    test("preserves non-archgate files during cleanup", async () => {
      const agentsDir = join(tempDir, "opencode", "agents");
      const skillsDir = join(tempDir, "opencode", "skills");
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(skillsDir, { recursive: true });

      // User's own agent and skill — must survive
      writeFileSync(join(agentsDir, "my-custom-agent.md"), "keep");
      mkdirSync(join(skillsDir, "my-custom-skill"));
      writeFileSync(join(skillsDir, "my-custom-skill", "SKILL.md"), "keep");

      // Archgate file that should be cleaned
      writeFileSync(join(agentsDir, "archgate-old.md"), "old");

      mockFetch(200, new ArrayBuffer(64));

      await installOpencodePlugin("test-token");

      expect(existsSync(join(agentsDir, "my-custom-agent.md"))).toBe(true);
      expect(existsSync(join(skillsDir, "my-custom-skill", "SKILL.md"))).toBe(
        true
      );
      expect(existsSync(join(agentsDir, "archgate-old.md"))).toBe(false);
    });

    test("handles clean install with no pre-existing files", async () => {
      mockFetch(200, new ArrayBuffer(64));

      await installOpencodePlugin("test-token");

      expect(existsSync(join(tempDir, "opencode", "agents"))).toBe(true);
      expect(existsSync(join(tempDir, "opencode", "skills"))).toBe(true);
    });

    test("extracts into config dir, not agents subdir", async () => {
      mockFetch(200, new ArrayBuffer(64));

      await installOpencodePlugin("test-token");

      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      const targetIdx = callArgs.indexOf("-C");
      expect(targetIdx).toBeGreaterThanOrEqual(0);
      const targetDir = callArgs[targetIdx + 1];
      // Must end with /opencode (config dir), not /opencode/agents
      expect(targetDir).toMatch(/opencode$/u);
      expect(targetDir).not.toMatch(/agents$/u);
    });
  });

  describe("cursor", () => {
    // cursorUserDir() resolves to tempDir/.cursor via the Bun.env.HOME
    // override installed in the file-level beforeEach.
    test("removes archgate-* agents and skills before extraction", async () => {
      const agentsDir = join(tempDir, ".cursor", "agents");
      const skillsDir = join(tempDir, ".cursor", "skills");
      mkdirSync(agentsDir, { recursive: true });
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(join(agentsDir, "archgate-developer.md"), "old");
      mkdirSync(join(skillsDir, "archgate-reviewer"));
      writeFileSync(join(skillsDir, "archgate-reviewer", "SKILL.md"), "old");

      mockFetch(200, new ArrayBuffer(64));

      await installCursorPlugin("test-token");

      expect(existsSync(join(agentsDir, "archgate-developer.md"))).toBe(false);
      expect(existsSync(join(skillsDir, "archgate-reviewer"))).toBe(false);
    });

    test("extracts into cursor user dir, not a subdirectory", async () => {
      mockFetch(200, new ArrayBuffer(64));

      await installCursorPlugin("test-token");

      const callArgs = spawnSpy.mock.calls[0][0] as string[];
      const targetIdx = callArgs.indexOf("-C");
      expect(targetIdx).toBeGreaterThanOrEqual(0);
      const targetDir = callArgs[targetIdx + 1];
      expect(targetDir).toMatch(/\.cursor$/u);
    });
  });
});
