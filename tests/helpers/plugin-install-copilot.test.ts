// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * GitHub Copilot install flow (`isCopilotAvailable` + `installCopilotPlugin`).
 * Sibling of plugin-install.test.ts — shares its harness pattern (spawn spy,
 * resolveCommand spy, temp HOME) but covers only the Copilot-specific flow.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
  type Mock,
} from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { copilotConfigDir } from "../../src/helpers/paths";
import * as platform from "../../src/helpers/platform";
import {
  buildVscodeMarketplaceUrl,
  installCopilotPlugin,
  isCopilotAvailable,
} from "../../src/helpers/plugin-install";
import { restoreEnv } from "../test-utils";

/**
 * Create a fake Bun.spawn return value — same shape as the fake in
 * plugin-install.test.ts: only stdout/stderr/exited are read by run().
 */
function fakeSpawnResult(
  exitCode: number,
  stdout = "",
  stderr = ""
): ReturnType<typeof Bun.spawn> {
  // Deliberately incomplete fake Subprocess: only the fields run() actually
  // reads (stdout/stderr/exited) need real values; the rest are inert filler.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response(stdout).body!,
    stderr: new Response(stderr).body!,
    exited: Promise.resolve(exitCode),
    pid: 0,
    exitCode: null,
    signalCode: null,
    killed: false,
    // Unused by run(); `never` is filler, not a real stdin implementation.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    stdin: null as never,
    ref: () => {},
    unref: () => {},
    kill: () => {},
    readable: new ReadableStream(),
    [Symbol.asyncDispose]: async () => {},
  } as unknown as ReturnType<typeof Bun.spawn>;
}

let spawnSpy: Mock<typeof Bun.spawn>;
let tempHome: string;
let savedHome: string | undefined;
let savedCopilotHome: string | undefined;
let mockResolveCommand: Mock<typeof platform.resolveCommand>;

beforeEach(() => {
  mockResolveCommand = spyOn(platform, "resolveCommand").mockImplementation(
    async () => null
  );
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));

  // Redirect ~/.copilot into a temp dir so tests never touch the
  // developer's real Copilot settings. copilotConfigDir() reads
  // COPILOT_HOME / HOME at call time.
  tempHome = mkdtempSync(join(tmpdir(), "archgate-copilot-install-"));
  savedHome = Bun.env.HOME;
  savedCopilotHome = Bun.env.COPILOT_HOME;
  Bun.env.HOME = tempHome;
  delete Bun.env.COPILOT_HOME;
});

afterEach(() => {
  spawnSpy.mockRestore();
  mockResolveCommand.mockRestore();
  mock.restore();

  restoreEnv("HOME", savedHome);
  restoreEnv("COPILOT_HOME", savedCopilotHome);
  rmSync(tempHome, { recursive: true, force: true });
});

/** Read the settings file written into the temp ~/.copilot. */
async function readWrittenSettings(): Promise<Record<string, unknown>> {
  const raw: unknown = await Bun.file(
    join(copilotConfigDir(), "settings.json")
  ).json();
  // Test-only narrowing of a file this suite just wrote as a JSON object.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return raw as Record<string, unknown>;
}

describe("isCopilotAvailable", () => {
  test("returns true when the CLI is on PATH", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    const result = await isCopilotAvailable();
    expect(result).toBe(true);
  });

  test("returns true when the desktop app's config dir exists but no CLI is on PATH", async () => {
    // The desktop app ships no CLI binary, so the PATH probe alone would
    // never detect it. Both distributions share ~/.copilot, so its
    // presence is a reliable signal on its own.
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });

    const result = await isCopilotAvailable();
    expect(result).toBe(true);
  });

  test("returns false when neither the CLI nor the config dir is present", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    const result = await isCopilotAvailable();
    expect(result).toBe(false);
  });
});

describe("installCopilotPlugin", () => {
  test("cli mode: declares settings then runs plugin install (no marketplace add)", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    // No pre-existing ~/.copilot — CLI-on-PATH availability alone is enough;
    // the settings write creates the directory.

    const result = await installCopilotPlugin();

    expect(result).toEqual({ mode: "cli" });
    // The marketplace is registered declaratively via settings.json, so the
    // only subprocess is the install itself.
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const argv = spawnSpy.mock.calls[0][0];
    expect(argv).toContain("install");
    expect(argv).toContain("archgate@archgate");
    expect(argv).not.toContain("marketplace");

    const settings = await readWrittenSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: { source: { source: "git", url: buildVscodeMarketplaceUrl() } },
    });
    expect(settings.enabledPlugins).toEqual({ "archgate@archgate": true });
  });

  test("declarative mode: writes settings and spawns nothing when the CLI is absent", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });

    const result = await installCopilotPlugin();

    expect(result).toEqual({ mode: "declarative" });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(existsSync(join(copilotConfigDir(), "settings.json"))).toBe(true);
  });

  test("overwrites a stale archgate marketplace URL while preserving other entries", async () => {
    mockResolveCommand.mockImplementation(async () => null);
    mkdirSync(copilotConfigDir(), { recursive: true });
    await Bun.write(
      join(copilotConfigDir(), "settings.json"),
      JSON.stringify({
        extraKnownMarketplaces: {
          archgate: {
            source: { source: "git", url: "https://example.com/dead.git" },
          },
          other: { source: { source: "github", repo: "acme/plugins" } },
        },
        enabledPlugins: { "foo@other": true },
        theme: "dark",
      })
    );

    await installCopilotPlugin();

    const settings = await readWrittenSettings();
    expect(settings.extraKnownMarketplaces).toEqual({
      archgate: { source: { source: "git", url: buildVscodeMarketplaceUrl() } },
      other: { source: { source: "github", repo: "acme/plugins" } },
    });
    expect(settings.enabledPlugins).toEqual({
      "foo@other": true,
      "archgate@archgate": true,
    });
    expect(settings.theme).toBe("dark");
  });

  test("throws with the exit code but never the CLI's own output", async () => {
    mockResolveCommand.mockImplementation(async () => "copilot");
    mkdirSync(copilotConfigDir(), { recursive: true });
    spawnSpy.mockImplementation(() =>
      fakeSpawnResult(1, "token=ghp_stdoutsecret", "token=ghp_stderrsecret")
    );

    // The message reaches logError, which feeds Sentry breadcrumbs, so the
    // subprocess output must not ride along with it.
    const err = await installCopilotPlugin().then(
      () => null,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toMatch(/plugin install failed \(exit 1\)/u);
    expect(message).not.toContain("ghp_stdoutsecret");
    expect(message).not.toContain("ghp_stderrsecret");
  });

  test("resolves the settings path via COPILOT_HOME when set", async () => {
    const copilotHome = join(tempHome, "custom-copilot-home");
    Bun.env.COPILOT_HOME = copilotHome;
    mkdirSync(copilotHome, { recursive: true });
    mockResolveCommand.mockImplementation(async () => null);

    // Availability detection follows the override...
    const available = await isCopilotAvailable();
    expect(available).toBe(true);

    // ...and the declarative install writes into it.
    const result = await installCopilotPlugin();
    expect(result).toEqual({ mode: "declarative" });
    expect(existsSync(join(copilotHome, "settings.json"))).toBe(true);
    expect(existsSync(join(tempHome, ".copilot", "settings.json"))).toBe(false);
  });
});
