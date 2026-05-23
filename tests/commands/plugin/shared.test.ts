// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Tests for maybeUpdatePlugins (exported from upgrade.ts as _maybeUpdatePlugins).
 *
 * Uses spyOn instead of mock.module to avoid the global mock.module leak
 * that breaks plugin/install.test.ts when both files run in the same Bun
 * process.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import * as pluginInstall from "../../../src/commands/plugin/install";
import * as credentialStore from "../../../src/helpers/credential-store";
import * as editorDetect from "../../../src/helpers/editor-detect";

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let logSpy: ReturnType<typeof spyOn>;
let warnSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let originalIsTTY: boolean | undefined;

let credSpy: ReturnType<typeof spyOn>;
let detectSpy: ReturnType<typeof spyOn>;
let promptSpy: ReturnType<typeof spyOn>;
let installSpy: ReturnType<typeof spyOn>;
let manualSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  originalIsTTY = process.stdin.isTTY;

  credSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(null);
  detectSpy = spyOn(editorDetect, "detectEditors").mockResolvedValue([]);
  promptSpy = spyOn(editorDetect, "promptEditorSelection").mockResolvedValue([
    "claude",
  ]);
  installSpy = spyOn(pluginInstall, "installForEditor").mockResolvedValue();
  manualSpy = spyOn(
    pluginInstall,
    "printManualInstructions"
  ).mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  credSpy.mockRestore();
  detectSpy.mockRestore();
  promptSpy.mockRestore();
  installSpy.mockRestore();
  manualSpy.mockRestore();
  Object.defineProperty(process.stdin, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function importUpgrade() {
  return import(`../../../src/commands/upgrade?t=${Date.now()}`);
}

function setTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("maybeUpdatePlugins", () => {
  test("prints login hint when no credentials", async () => {
    setTTY(false);
    credSpy.mockResolvedValue(null);

    const { _maybeUpdatePlugins } = await importUpgrade();
    await _maybeUpdatePlugins(true);

    expect(logSpy).toHaveBeenCalled();
    const allLogOutput = logSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(allLogOutput).toContain("archgate login");
    expect(detectSpy).not.toHaveBeenCalled();
  });

  test("prints hint when no editors detected", async () => {
    setTTY(false);
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    detectSpy.mockResolvedValue([
      { id: "claude" as const, label: "Claude Code", available: false },
      { id: "cursor" as const, label: "Cursor", available: false },
    ]);

    const { _maybeUpdatePlugins } = await importUpgrade();
    await _maybeUpdatePlugins(true);

    expect(logSpy).toHaveBeenCalled();
    const allLogOutput = logSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(allLogOutput).toContain("No supported editors detected");
    expect(installSpy).not.toHaveBeenCalled();
  });

  test("auto-updates all detected editors with --plugins flag", async () => {
    setTTY(false);
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    detectSpy.mockResolvedValue([
      { id: "claude" as const, label: "Claude Code", available: true },
      { id: "vscode" as const, label: "VS Code", available: true },
      { id: "cursor" as const, label: "Cursor", available: false },
    ]);

    const { _maybeUpdatePlugins } = await importUpgrade();
    await _maybeUpdatePlugins(true);

    expect(installSpy).toHaveBeenCalledTimes(2);
    expect(installSpy).toHaveBeenCalledWith("claude", "Claude Code", "tok");
    expect(installSpy).toHaveBeenCalledWith("vscode", "VS Code", "tok");
    expect(promptSpy).not.toHaveBeenCalled();
  });

  test("auto-updates in non-TTY agent context without prompt", async () => {
    setTTY(false);
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    detectSpy.mockResolvedValue([
      { id: "claude" as const, label: "Claude Code", available: true },
    ]);

    const { _maybeUpdatePlugins } = await importUpgrade();
    await _maybeUpdatePlugins(false);

    expect(installSpy).toHaveBeenCalledTimes(1);
    expect(installSpy).toHaveBeenCalledWith("claude", "Claude Code", "tok");
    expect(promptSpy).not.toHaveBeenCalled();
  });

  test("reports install failures without changing exit code", async () => {
    setTTY(false);
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    detectSpy.mockResolvedValue([
      { id: "claude" as const, label: "Claude Code", available: true },
    ]);
    installSpy.mockRejectedValue(new Error("install failed"));

    const { _maybeUpdatePlugins } = await importUpgrade();
    await _maybeUpdatePlugins(true);

    expect(errorSpy).toHaveBeenCalled();
    const allErrorOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(allErrorOutput).toContain("Failed to update plugin");
    expect(manualSpy).toHaveBeenCalledWith("claude");
  });
});
