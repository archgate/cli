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

import {
  copyToClipboard,
  isHeadless,
  openBrowser,
} from "../../src/helpers/desktop";
import * as platform from "../../src/helpers/platform";
import { restoreEnv } from "../test-utils";

let spawnSpy: Mock<typeof Bun.spawn>;
let platformSpies: Mock<() => boolean>[];

/** Env vars isHeadless reads, saved and restored around every test. */
const ENV_KEYS = [
  "CI",
  "SSH_CONNECTION",
  "SSH_TTY",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];
let originalEnv: Record<string, string | undefined>;

/** Pin the platform predicates so a test does not depend on the host. */
function onPlatform(which: "macos" | "windows" | "wsl" | "linux"): void {
  platformSpies = [
    spyOn(platform, "isMacOS").mockReturnValue(which === "macos"),
    spyOn(platform, "isWindows").mockReturnValue(which === "windows"),
    spyOn(platform, "isWSL").mockReturnValue(which === "wsl"),
    spyOn(platform, "isLinux").mockReturnValue(which === "linux"),
  ];
}

/** Stub Bun.spawn so the nth attempt exits with the given code. */
function spawnExits(...codes: number[]): void {
  // Replacing an existing spy would nest one mock inside another.
  spawnSpy.mockRestore();
  let call = 0;
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
    const code = codes[call] ?? 1;
    call += 1;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return {
      exited: Promise.resolve(code),
      kill: () => {
        // Nothing to kill: the stub has already settled.
      },
    } as unknown as ReturnType<typeof Bun.spawn>;
  });
}

/** Argv of each recorded spawn, in call order. */
function captured(): string[][] {
  return spawnSpy.mock.calls.map((call) => [...call[0]]);
}

/** The `stdin` option passed to the nth spawn. */
function stdinOf(index: number): unknown {
  return (spawnSpy.mock.calls[index]?.[1] as { stdin?: unknown } | undefined)
    ?.stdin;
}

beforeEach(() => {
  platformSpies = [];
  // Installed unconditionally so no test can reach the real Bun.spawn, and so
  // afterEach always has a spy to restore.
  spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => {
    throw new Error("unexpected spawn");
  });
  originalEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, Bun.env[k]]));
  for (const key of ENV_KEYS) delete Bun.env[key];
  // A desktop Linux session by default; individual tests override.
  Bun.env.DISPLAY = ":0";
  onPlatform("linux");
});

afterEach(() => {
  mock.restore();
  for (const key of ENV_KEYS) restoreEnv(key, originalEnv[key]);
});

describe("isHeadless", () => {
  test.each(["CI", "SSH_CONNECTION", "SSH_TTY"])(
    "treats %s as headless",
    (key) => {
      Bun.env[key] = "1";

      expect(isHeadless()).toBe(true);
    }
  );

  // An empty value is how a shell reports "unset" for an exported-but-blank var.
  test("ignores an empty value", () => {
    Bun.env.CI = "";

    expect(isHeadless()).toBe(false);
  });

  test.each([
    ["DISPLAY", ":0"],
    ["WAYLAND_DISPLAY", "wayland-0"],
  ])("a Linux session with %s is not headless", (key, value) => {
    delete Bun.env.DISPLAY;
    Bun.env[key] = value;

    expect(isHeadless()).toBe(false);
  });

  test("Linux without any display server is headless", () => {
    delete Bun.env.DISPLAY;

    expect(isHeadless()).toBe(true);
  });

  // WSL has no display server of its own but reaches the Windows desktop.
  test("WSL is not headless despite having no display", () => {
    delete Bun.env.DISPLAY;
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform("wsl");

    expect(isHeadless()).toBe(false);
  });

  test.each(["macos", "windows"] as const)("%s is not headless", (which) => {
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform(which);

    expect(isHeadless()).toBe(false);
  });
});

describe("openBrowser", () => {
  test.each([
    ["macos", ["open", "https://auth.archgate.dev/device"]],
    ["linux", ["xdg-open", "https://auth.archgate.dev/device"]],
    ["wsl", ["wslview", "https://auth.archgate.dev/device"]],
  ] as const)("uses the %s launcher", async (which, expected) => {
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform(which);
    spawnExits(0);

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(true);
    expect(captured()[0]).toEqual([...expected]);
  });

  // `cmd /c start` and PowerShell parse `?` and `&` out of a URL, so the
  // complete verification URL would be truncated before the browser saw it.
  test("hands Windows the URL without a shell in between", async () => {
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform("windows");
    spawnExits(0);

    await openBrowser(
      "https://auth.archgate.dev/device?user_code=HZML-HXLB&x=1"
    );

    expect(captured()[0]).toEqual([
      "rundll32",
      "url.dll,FileProtocolHandler",
      "https://auth.archgate.dev/device?user_code=HZML-HXLB&x=1",
    ]);
  });

  test("falls back to rundll32 on WSL without wslview", async () => {
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform("wsl");
    spawnExits(1, 0);

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(true);
    expect(captured()[1]?.[0]).toBe("rundll32.exe");
  });

  test("falls through to the next launcher when the first is missing", async () => {
    spawnExits(1, 0);

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(true);
    expect(captured()).toHaveLength(2);
    expect(captured()[1]?.[0]).toBe("gio");
  });

  test("returns false when no launcher works", async () => {
    spawnExits(1, 1);

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(false);
  });

  test("spawns nothing when headless", async () => {
    Bun.env.CI = "1";
    spawnExits(0);

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(false);
    expect(captured()).toHaveLength(0);
  });

  // A launcher that never exits must not hang login behind it.
  test("gives up on a launcher that never exits", async () => {
    let killed = false;
    spawnSpy.mockRestore();
    spawnSpy = spyOn(Bun, "spawn").mockImplementation(
      () =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        ({
          exited: new Promise<number>(() => {
            // never settles
          }),
          kill: () => {
            killed = true;
          },
        }) as unknown as ReturnType<typeof Bun.spawn>
    );

    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(false);
    expect(killed).toBe(true);
  });

  test("returns false when spawning throws", async () => {
    // The default stub from beforeEach already throws.
    expect(await openBrowser("https://auth.archgate.dev/device")).toBe(false);
  });
});

describe("copyToClipboard", () => {
  test.each([
    ["macos", "pbcopy"],
    ["linux", "wl-copy"],
    ["wsl", "clip.exe"],
    ["windows", "clip.exe"],
  ] as const)("uses the %s clipboard tool", async (which, expected) => {
    for (const spy of platformSpies) spy.mockRestore();
    onPlatform(which);
    spawnExits(0);

    expect(await copyToClipboard("HZML-HXLB")).toBe(true);
    expect(captured()[0]?.[0]).toBe(expected);
  });

  test("writes the text on standard input, never as an argument", async () => {
    spawnExits(0);

    await copyToClipboard("HZML-HXLB");

    expect(captured()[0]).not.toContain("HZML-HXLB");
    const stdin = stdinOf(0);
    expect(stdin).toBeInstanceOf(Blob);
    expect(stdin instanceof Blob ? await stdin.text() : null).toBe("HZML-HXLB");
  });

  test("falls through the Linux clipboard tools in order", async () => {
    spawnExits(1, 1, 0);

    expect(await copyToClipboard("HZML-HXLB")).toBe(true);
    expect(captured().map((c) => c[0])).toEqual(["wl-copy", "xclip", "xsel"]);
  });

  test("returns false when headless", async () => {
    delete Bun.env.DISPLAY;
    spawnExits(0);

    expect(await copyToClipboard("HZML-HXLB")).toBe(false);
    expect(captured()).toHaveLength(0);
  });

  test("returns false when every clipboard tool is missing", async () => {
    spawnExits(1, 1, 1);

    expect(await copyToClipboard("HZML-HXLB")).toBe(false);
    expect(captured()).toHaveLength(3);
  });
});
