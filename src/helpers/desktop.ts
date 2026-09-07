// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * desktop.ts — open a URL in the browser and copy text to the clipboard.
 *
 * Both are conveniences: every caller must still print what it would have
 * opened or copied, because a headless host, an SSH session or a container
 * has neither a browser nor a clipboard.
 */

import { isLinux, isMacOS, isWindows, isWSL } from "./platform";

/** Give a launcher this long before deciding it is not going to answer. */
const SPAWN_TIMEOUT_MS = 3_000;

/**
 * True when the process has no desktop session to open a browser into.
 *
 * CI and SSH are treated as headless even on a platform that would otherwise
 * qualify: opening a browser on the far end of an SSH connection helps nobody.
 * On Linux a session needs a display server; WSL is exempt because it reaches
 * the Windows desktop through its own launcher.
 */
export function isHeadless(): boolean {
  const set = (name: string): boolean => {
    const value = Bun.env[name];
    return value !== undefined && value !== "";
  };

  if (set("CI")) return true;
  if (set("SSH_CONNECTION") || set("SSH_TTY")) return true;
  if (isLinux() && !isWSL()) {
    return !set("DISPLAY") && !set("WAYLAND_DISPLAY");
  }
  return false;
}

/**
 * Run a command, resolving false rather than throwing when it is unavailable.
 *
 * Streams are ignored rather than piped: nothing reads them, and an unread
 * pipe can fill and block the child (ARCH-007).
 *
 * @param command - Argv array.
 * @param stdin - Optional payload written to the process's standard input.
 */
async function run(command: string[], stdin?: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(command, {
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "ignore",
      stderr: "ignore",
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      proc.exited,
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          resolve("timeout");
        }, SPAWN_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    if (exited === "timeout") {
      proc.kill();
      return false;
    }
    return exited === 0;
  } catch {
    return false;
  }
}

/** Browser launchers to try, in order, for the current platform. */
function browserCommands(url: string): string[][] {
  if (isMacOS()) return [["open", url]];
  // rundll32 hands the URL to the default browser without a shell in
  // between: `cmd /c start` and PowerShell both parse `&` and `?` out of it.
  const windowsHandler = ["url.dll,FileProtocolHandler", url];
  // WSL reaches the Windows desktop; wslview ships with wslu, and rundll32
  // covers distributions that lack it.
  if (isWSL()) {
    return [
      ["wslview", url],
      ["rundll32.exe", ...windowsHandler],
    ];
  }
  if (isWindows()) return [["rundll32", ...windowsHandler]];
  return [
    ["xdg-open", url],
    ["gio", "open", url],
  ];
}

/** Clipboard writers to try, in order, for the current platform. */
function clipboardCommands(): string[][] {
  if (isMacOS()) return [["pbcopy"]];
  if (isWSL() || isWindows()) return [["clip.exe"], ["clip"]];
  return [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
  ];
}

/** Try each command in order, stopping at the first that succeeds. */
async function firstThatWorks(
  commands: string[][],
  stdin?: string
): Promise<boolean> {
  if (isHeadless()) return false;

  /* oxlint-disable no-await-in-loop -- candidates are tried in order */
  for (const command of commands) {
    if (await run(command, stdin)) return true;
  }
  /* oxlint-enable no-await-in-loop */
  return false;
}

/**
 * Open a URL in the user's browser.
 *
 * @param url - Absolute URL to open.
 * @returns `true` when a launcher accepted it; `false` when headless or none
 * of the platform's launchers are installed.
 */
export async function openBrowser(url: string): Promise<boolean> {
  return firstThatWorks(browserCommands(url));
}

/**
 * Copy text to the system clipboard.
 *
 * @param text - Text to place on the clipboard.
 * @returns `true` when a clipboard tool accepted it.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  return firstThatWorks(clipboardCommands(), text);
}
