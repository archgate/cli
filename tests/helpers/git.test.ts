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
  type Mock,
} from "bun:test";

import { installGit } from "../../src/helpers/git";
import * as platform from "../../src/helpers/platform";
import { UserError } from "../../src/helpers/user-error";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Replace `Bun.which` for the duration of a callback. */
async function withBunWhich(
  fn: (name: string) => string | null,
  cb: () => Promise<void>
): Promise<void> {
  const original = Bun.which;
  Bun.which = fn;
  try {
    await cb();
  } finally {
    Bun.which = original;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("installGit", () => {
  test("returns immediately when Bun.which finds git (fast path)", async () => {
    await withBunWhich(
      () => "/usr/bin/git",
      async () => {
        expect(installGit()).resolves.toBeUndefined();
      }
    );
  });

  test("returns when resolveCommand finds git (slow path)", async () => {
    // Force Bun.which to miss so installGit falls through to resolveCommand.
    // resolveCommand uses its own Bun.which call internally, so we only
    // override for the initial check and then restore before resolveCommand
    // runs. Since git IS available in the test environment, resolveCommand
    // finds it and the function returns without attempting an install.
    let callCount = 0;
    const realWhich = Bun.which;
    await withBunWhich(
      (name: string) => {
        callCount++;
        // First call is installGit's fast-path check — return null to skip it.
        // Subsequent calls come from resolveCommand — use the real Bun.which.
        if (callCount === 1 && name === "git") return null;
        return realWhich(name);
      },
      async () => {
        expect(installGit()).resolves.toBeUndefined();
      }
    );
  });

  test.skipIf(process.platform !== "win32")(
    "throws when git is not found on Windows",
    async () => {
      // On other platforms, installGit would attempt brew/apt install instead
      // of throwing. Force the WSL fallback (`wsl which git`) to report a miss
      // so resolveCommand returns null and installGit reaches the Windows throw.
      const originalSpawn = Bun.spawn;
      // Deliberately incomplete fake Subprocess: installGit only reads
      // `exited`, so the rest of the Subprocess shape is inert filler.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      Bun.spawn = (() => ({
        exited: Promise.resolve(1),
      })) as unknown as typeof Bun.spawn;
      try {
        await withBunWhich(
          () => null,
          async () => {
            expect(installGit()).rejects.toThrow(/Git is not installed/u);
          }
        );
      } finally {
        Bun.spawn = originalSpawn;
      }
    }
  );
});

/** Deliberately incomplete fake Subprocess: installGit reads only `exited`. */
function fakeExit(code: number): ReturnType<typeof Bun.spawn> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { exited: Promise.resolve(code) } as unknown as ReturnType<
    typeof Bun.spawn
  >;
}

/** Await a rejection and hand back the thrown value for assertions. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err: unknown) {
    return err;
  }
  throw new Error("expected the promise to reject");
}

describe("installGit on Unix platforms", () => {
  // spyOn over the imported namespace (never mock.module on a first-party
  // module — ARCH-005) so the platform branch is deterministic on any host OS.
  let isWindowsSpy: Mock<typeof platform.isWindows>;
  let isMacOSSpy: Mock<typeof platform.isMacOS>;
  let resolveCommandSpy: Mock<typeof platform.resolveCommand>;
  let spawnSpy: Mock<typeof Bun.spawn>;

  beforeEach(() => {
    isWindowsSpy = spyOn(platform, "isWindows").mockReturnValue(false);
    isMacOSSpy = spyOn(platform, "isMacOS").mockReturnValue(false);
    resolveCommandSpy = spyOn(platform, "resolveCommand").mockImplementation(
      async () => null
    );
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeExit(0));
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    resolveCommandSpy.mockRestore();
    isMacOSSpy.mockRestore();
    isWindowsSpy.mockRestore();
    mock.restore();
  });

  const packageManagerCases = [
    { platformName: "macOS", macOS: true, argv: ["brew", "install", "git"] },
    {
      platformName: "Linux",
      macOS: false,
      argv: ["sudo", "apt-get", "install", "-y", "git"],
    },
  ];

  test.each(packageManagerCases)(
    "installs git via the $platformName package manager",
    async ({ macOS, argv }) => {
      isMacOSSpy.mockReturnValue(macOS);

      await withBunWhich(
        () => null,
        async () => {
          await installGit();
        }
      );

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      expect(spawnSpy.mock.calls[0]?.[0]).toEqual(argv);
    }
  );

  test.each(packageManagerCases)(
    "throws a UserError when the $platformName install exits non-zero",
    async ({ macOS }) => {
      isMacOSSpy.mockReturnValue(macOS);
      spawnSpy.mockImplementation(() => fakeExit(1));

      await withBunWhich(
        () => null,
        async () => {
          // UserError = expected failure (ARCH-002): the boundary logs it and
          // exits 1 with no stack trace and no Sentry capture.
          const err = await captureRejection(installGit());
          expect(err).toBeInstanceOf(UserError);
          expect(err).toHaveProperty(
            "message",
            "Failed to install git (exit code 1)"
          );
        }
      );
    }
  );
});
