// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Action handler tests — exercise the upgrade command via parseAsync() to
// cover the action handler's upgrade flow: binary downloads, telemetry
// tracking, and error paths.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";

import { Command } from "@commander-js/extra-typings";

import { registerUpgradeCommand } from "../../src/commands/upgrade";
import * as binaryUpgrade from "../../src/helpers/binary-upgrade";
import * as credentialStore from "../../src/helpers/credential-store";
import * as exitModule from "../../src/helpers/exit";
import { internalPath } from "../../src/helpers/paths";
import * as telemetryModule from "../../src/helpers/telemetry";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("upgrade action handler (upgrade flow)", () => {
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let fetchVersionSpy: ReturnType<typeof spyOn>;
  let getArtifactSpy: ReturnType<typeof spyOn>;
  let downloadSpy: ReturnType<typeof spyOn>;
  let replaceSpy: ReturnType<typeof spyOn>;
  let trackSpy: ReturnType<typeof spyOn>;
  let credsSpy: ReturnType<typeof spyOn>;
  let originalExecPath: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(exitModule, "exitWith").mockImplementation(() => {
      throw new Error("process.exit");
    });

    // Default: newer version available, binary install, artifact found
    fetchVersionSpy = spyOn(
      binaryUpgrade,
      "fetchLatestGitHubVersion"
    ).mockResolvedValue("v99.0.0");
    getArtifactSpy = spyOn(binaryUpgrade, "getArtifactInfo").mockReturnValue({
      name: "archgate-test-x64",
      ext: ".tar.gz",
      binaryName: "archgate",
    });
    downloadSpy = spyOn(
      binaryUpgrade,
      "downloadReleaseBinary"
    ).mockResolvedValue("/tmp/new-binary");
    replaceSpy = spyOn(binaryUpgrade, "replaceBinary").mockImplementation(
      () => {}
    );
    trackSpy = spyOn(telemetryModule, "trackUpgradeResult").mockImplementation(
      () => {}
    );
    // Prevent real credential store lookups in maybeUpdatePlugins
    credsSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(
      null
    );

    // Set execPath to ~/.archgate/bin/ so isBinaryInstall() returns true
    originalExecPath = process.execPath;
    Object.defineProperty(process, "execPath", {
      value: join(internalPath("bin"), "archgate"),
      writable: true,
      configurable: true,
    });

    // Non-TTY stdin to skip interactive prompts in maybeUpdatePlugins
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    fetchVersionSpy.mockRestore();
    getArtifactSpy.mockRestore();
    downloadSpy.mockRestore();
    replaceSpy.mockRestore();
    trackSpy.mockRestore();
    credsSpy.mockRestore();
    Object.defineProperty(process, "execPath", {
      value: originalExecPath,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
  });

  function makeProgram(): Command {
    const program = new Command().exitOverride();
    registerUpgradeCommand(program);
    return program;
  }

  // -- Successful binary upgrade --

  test("downloads and replaces binary when newer version available", async () => {
    await makeProgram().parseAsync(["node", "test", "upgrade"]);

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledTimes(1);

    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("upgraded to 99.0.0");
  });

  // -- Telemetry --

  test("tracks successful upgrade with version info", async () => {
    await makeProgram().parseAsync(["node", "test", "upgrade"]);

    expect(trackSpy).toHaveBeenCalledTimes(1);
    const data = trackSpy.mock.calls[0][0];
    expect(data.to_version).toBe("99.0.0");
    expect(data.install_method).toBe("binary");
    expect(data.success).toBe(true);
  });

  test("tracks failed upgrade on download error", async () => {
    downloadSpy.mockRejectedValue(new Error("download failed"));

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const failCall = trackSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as { success: boolean }).success === false
    );
    expect(failCall).toBeDefined();
  });

  // -- Version checks --

  test("already up-to-date when remote equals current", async () => {
    const pkg = await import("../../package.json");
    fetchVersionSpy.mockResolvedValue(`v${pkg.default.version}`);

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
    const output = logSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .join("\n");
    expect(output).toContain("already up-to-date");
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  test("null version from GitHub exits 1", async () => {
    fetchVersionSpy.mockResolvedValue(null);

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("Failed to fetch release info");
  });

  // -- Binary upgrade error paths --

  test("unsupported platform exits 1", async () => {
    getArtifactSpy.mockReturnValue(null);

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("Unsupported platform");
  });

  test("download failure logs error with manual hint", async () => {
    downloadSpy.mockRejectedValue(new Error("connection reset"));

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("process.exit");

    const errOutput = errorSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
    expect(errOutput).toContain("Failed to upgrade binary");
    expect(errOutput).toContain("connection reset");
  });

  // -- ExitPromptError --

  test("re-throws ExitPromptError from download", async () => {
    const exitPromptError = new Error("user cancelled");
    exitPromptError.name = "ExitPromptError";
    downloadSpy.mockRejectedValue(exitPromptError);

    await expect(
      makeProgram().parseAsync(["node", "test", "upgrade"])
    ).rejects.toThrow("user cancelled");

    expect(exitSpy).not.toHaveBeenCalled();
  });

  // -- Plugin update after upgrade --

  test("offers plugin update after successful upgrade", async () => {
    await makeProgram().parseAsync(["node", "test", "upgrade"]);

    // With stdin not TTY and no --plugins flag, maybeUpdatePlugins
    // still runs but loadCredentials returns null (mocked), so it
    // logs "Not logged in" and returns
    expect(credsSpy).toHaveBeenCalledTimes(1);
  });
});
