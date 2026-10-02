// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  type Mock,
  spyOn,
  test,
} from "bun:test";

import * as platform from "../../src/helpers/platform";
import {
  buildCodexMarketplaceUrl,
  installCodexPlugin,
  isCodexCliAvailable,
} from "../../src/helpers/plugin-install";

/** Minimal fake Subprocess: run() only reads stdout/stderr/exited. */
function fakeSpawnResult(exitCode: number): ReturnType<typeof Bun.spawn> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return {
    stdout: new Response("").body!,
    stderr: new Response("").body!,
    exited: Promise.resolve(exitCode),
  } as unknown as ReturnType<typeof Bun.spawn>;
}

let spawnSpy: Mock<typeof Bun.spawn>;
let resolveSpy: Mock<typeof platform.resolveCommand>;

beforeEach(() => {
  resolveSpy = spyOn(platform, "resolveCommand").mockResolvedValue(
    "/bin/codex"
  );
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => fakeSpawnResult(0));
});

afterEach(() => {
  mock.restore();
});

function spawnedArgs(): string[][] {
  return spawnSpy.mock.calls.map((c) => c[0]);
}

describe("Codex plugin install helpers", () => {
  test("isCodexCliAvailable reflects command resolution", async () => {
    expect(await isCodexCliAvailable()).toBe(true);
    resolveSpy.mockResolvedValue(null);
    expect(await isCodexCliAvailable()).toBe(false);
  });

  test("installCodexPlugin adds the marketplace then the plugin", async () => {
    await installCodexPlugin();

    expect(spawnedArgs()).toEqual([
      [
        "/bin/codex",
        "plugin",
        "marketplace",
        "add",
        buildCodexMarketplaceUrl(),
      ],
      ["/bin/codex", "plugin", "add", "archgate@archgate"],
    ]);
  });

  test("falls back to the bare command name when unresolved", async () => {
    resolveSpy.mockResolvedValue(null);

    await installCodexPlugin();

    expect(spawnedArgs()[0]?.[0]).toBe("codex");
  });

  test("throws when marketplace add fails", async () => {
    spawnSpy.mockImplementation(() => fakeSpawnResult(2));

    expect(installCodexPlugin()).rejects.toThrow(
      "codex plugin marketplace add failed (exit 2)"
    );
  });

  test("throws when plugin add fails", async () => {
    spawnSpy
      .mockImplementationOnce(() => fakeSpawnResult(0))
      .mockImplementationOnce(() => fakeSpawnResult(3));

    expect(installCodexPlugin()).rejects.toThrow(
      "codex plugin add failed (exit 3)"
    );
  });
});
