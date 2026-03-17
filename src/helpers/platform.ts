import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformInfo {
  /** The Node.js process.platform value ("win32", "linux", "darwin", etc.) */
  runtime: NodeJS.Platform;
  /** Whether the process is running inside WSL (1 or 2) */
  isWSL: boolean;
  /** The WSL distribution name (e.g. "Ubuntu"), or null if not WSL */
  wslDistro: string | null;
}

// ---------------------------------------------------------------------------
// Detection (sync, cached)
// ---------------------------------------------------------------------------

let cachedPlatformInfo: PlatformInfo | null = null;

/**
 * Detect the current platform, including WSL detection.
 * Results are cached for the lifetime of the process.
 */
export function getPlatformInfo(): PlatformInfo {
  if (cachedPlatformInfo) return cachedPlatformInfo;

  const runtime = process.platform;

  // WSL only applies when process.platform is "linux"
  if (runtime !== "linux") {
    cachedPlatformInfo = { runtime, isWSL: false, wslDistro: null };
    return cachedPlatformInfo;
  }

  // Check WSL2 env vars first (fastest)
  const distroName = process.env.WSL_DISTRO_NAME;
  if (distroName) {
    cachedPlatformInfo = { runtime, isWSL: true, wslDistro: distroName };
    return cachedPlatformInfo;
  }

  if (process.env.WSL_INTEROP) {
    cachedPlatformInfo = { runtime, isWSL: true, wslDistro: null };
    return cachedPlatformInfo;
  }

  // Fallback: /proc/version check (catches WSL1)
  try {
    const procVersion = readFileSync("/proc/version", "utf-8");
    if (/microsoft/i.test(procVersion)) {
      cachedPlatformInfo = { runtime, isWSL: true, wslDistro: null };
      return cachedPlatformInfo;
    }
  } catch {
    // /proc/version not available — not WSL
  }

  cachedPlatformInfo = { runtime, isWSL: false, wslDistro: null };
  return cachedPlatformInfo;
}

/**
 * Shorthand: returns true if running inside WSL.
 */
export function isWSL(): boolean {
  return getPlatformInfo().isWSL;
}

/**
 * Returns true if the process is running on native Windows (not WSL).
 */
export function isWindows(): boolean {
  return getPlatformInfo().runtime === "win32";
}

/**
 * Returns true if the process is running on macOS.
 */
export function isMacOS(): boolean {
  return getPlatformInfo().runtime === "darwin";
}

/**
 * Returns true if the process is running on Linux (including WSL).
 */
export function isLinux(): boolean {
  return getPlatformInfo().runtime === "linux";
}

/**
 * Returns true if the platform is one of the supported ones (macOS, Linux, Windows).
 */
export function isSupportedPlatform(): boolean {
  const { runtime } = getPlatformInfo();
  return runtime === "darwin" || runtime === "linux" || runtime === "win32";
}

/**
 * Reset the cached platform info. For testing only.
 */
export function _resetPlatformCache(): void {
  cachedPlatformInfo = null;
}

// ---------------------------------------------------------------------------
// Path Conversion (async, WSL only)
// ---------------------------------------------------------------------------

/**
 * Convert a WSL path to a Windows path (e.g. /mnt/c/Users → C:\Users).
 * Returns null if not in WSL or conversion fails.
 */
export async function toWindowsPath(wslPath: string): Promise<string | null> {
  if (!isWSL()) return null;
  try {
    const proc = Bun.spawn(["wslpath", "-w", wslPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Convert a Windows path to a WSL path (e.g. C:\Users → /mnt/c/Users).
 * Returns null if not in WSL or conversion fails.
 */
export async function toWslPath(windowsPath: string): Promise<string | null> {
  if (!isWSL()) return null;
  try {
    const proc = Bun.spawn(["wslpath", "-u", windowsPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

let cachedWindowsHomeDir: string | null | undefined;

/** Try resolving the Windows home dir using a specific cmd.exe path. */
async function tryGetWindowsHome(cmd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn([cmd, "/c", "echo", "%USERPROFILE%"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;

    const winHome = stdout.trim();
    if (!winHome || winHome === "%USERPROFILE%") return null;

    return await toWslPath(winHome);
  } catch {
    return null;
  }
}

/**
 * Get the Windows user home directory as a WSL path (e.g. /mnt/c/Users/user).
 * Cached per process. Returns null if not in WSL or resolution fails.
 */
export async function getWindowsHomeDirFromWSL(): Promise<string | null> {
  if (!isWSL()) return null;
  if (cachedWindowsHomeDir !== undefined) return cachedWindowsHomeDir;

  const result =
    (await tryGetWindowsHome("cmd.exe")) ??
    (await tryGetWindowsHome("/mnt/c/Windows/System32/cmd.exe"));

  cachedWindowsHomeDir = result;
  return result;
}

// ---------------------------------------------------------------------------
// Cross-Environment Command Resolution (async)
// ---------------------------------------------------------------------------

/**
 * Resolve a command name across environments.
 *
 * 1. Try `Bun.which(name)` — native PATH lookup
 * 2. If WSL: try `Bun.which(name + ".exe")` — Windows binaries callable from WSL2
 * 3. If win32: try `wsl which name` — check WSL availability
 * 4. Return null if all fail
 */
export async function resolveCommand(name: string): Promise<string | null> {
  // 1. Native lookup
  if (Bun.which(name)) return name;

  const info = getPlatformInfo();

  // 2. WSL: try Windows .exe variant
  if (info.isWSL) {
    const exeName = name + ".exe";
    if (Bun.which(exeName)) return exeName;
  }

  // 3. Native Windows: try WSL
  if (info.runtime === "win32") {
    try {
      const proc = Bun.spawn(["wsl", "which", name], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) return name;
    } catch {
      // wsl not available
    }
  }

  return null;
}

/**
 * Reset all caches (platform + Windows home dir). For testing only.
 */
export function _resetAllCaches(): void {
  cachedPlatformInfo = null;
  cachedWindowsHomeDir = undefined;
}
