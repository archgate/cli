// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// maybeUpdatePlugins — the post-upgrade editor-plugin flow. inquirer is a
// third-party module, so mock.module is the permitted mechanism (ARCH-005);
// `promptAnswer` lets each test choose what the confirm prompt resolves to.
// ---------------------------------------------------------------------------

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

let promptAnswer: { updatePlugins: boolean } = { updatePlugins: true };
const inquirerPrompt = mock(async () => promptAnswer);
void mock.module("inquirer", () => ({ default: { prompt: inquirerPrompt } }));

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER the mock is registered.
// ---------------------------------------------------------------------------

import * as pluginInstall from "../../src/commands/plugin/install";
import { _maybeUpdatePlugins } from "../../src/commands/upgrade";
import * as credentialStore from "../../src/helpers/credential-store";
import * as editorDetect from "../../src/helpers/editor-detect";
import * as promptModule from "../../src/helpers/prompt";

function setStdinIsTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

describe("_maybeUpdatePlugins", () => {
  let logSpy: Mock<typeof console.log>;
  let credsSpy: Mock<typeof credentialStore.loadCredentials>;
  let detectSpy: Mock<typeof editorDetect.detectEditors>;
  let promptSelectionSpy: Mock<typeof editorDetect.promptEditorSelection>;
  let runInstallsSpy: Mock<typeof pluginInstall.runPluginInstalls>;
  let promptFixSpy: Mock<typeof promptModule.withPromptFix>;
  let originalStdinIsTTY: boolean | undefined;

  beforeEach(() => {
    promptAnswer = { updatePlugins: true };
    inquirerPrompt.mockClear();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    credsSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue({
      token: "test-token",
      github_user: "octocat",
    });
    detectSpy = spyOn(editorDetect, "detectEditors").mockResolvedValue([
      { id: "claude", label: "Claude Code", available: true },
      { id: "cursor", label: "Cursor", available: false },
    ]);
    promptSelectionSpy = spyOn(
      editorDetect,
      "promptEditorSelection"
    ).mockResolvedValue(["cursor"]);
    runInstallsSpy = spyOn(
      pluginInstall,
      "runPluginInstalls"
    ).mockResolvedValue([]);
    // Run the prompt callback directly: the real wrapper permanently patches
    // console methods and stream writes for the whole process (ARCH-019).
    promptFixSpy = spyOn(promptModule, "withPromptFix").mockImplementation(
      async (fn) => fn()
    );

    originalStdinIsTTY = process.stdin.isTTY;
    setStdinIsTTY(false);
  });

  afterEach(() => {
    logSpy.mockRestore();
    credsSpy.mockRestore();
    detectSpy.mockRestore();
    promptSelectionSpy.mockRestore();
    runInstallsSpy.mockRestore();
    promptFixSpy.mockRestore();
    setStdinIsTTY(originalStdinIsTTY);
  });

  function logOutput(): string {
    return logSpy.mock.calls
      .map((c: unknown[]) => c.map(String).join(" "))
      .join("\n");
  }

  test("updates every available editor when --plugins is passed", async () => {
    await _maybeUpdatePlugins(true);

    expect(inquirerPrompt).not.toHaveBeenCalled();
    expect(promptSelectionSpy).not.toHaveBeenCalled();
    expect(runInstallsSpy).toHaveBeenCalledWith(
      ["claude"],
      "test-token",
      "update"
    );
    expect(logOutput()).toContain("Updating editor plugins...");
  });

  test("updates every available editor when stdin is not a TTY", async () => {
    await _maybeUpdatePlugins(false);

    expect(inquirerPrompt).not.toHaveBeenCalled();
    expect(runInstallsSpy).toHaveBeenCalledWith(
      ["claude"],
      "test-token",
      "update"
    );
  });

  test("reports a missing login and installs nothing", async () => {
    credsSpy.mockResolvedValue(null);

    await _maybeUpdatePlugins(true);

    expect(logOutput()).toContain("Not logged in.");
    expect(detectSpy).not.toHaveBeenCalled();
    expect(runInstallsSpy).not.toHaveBeenCalled();
  });

  test("reports when no supported editor is detected", async () => {
    detectSpy.mockResolvedValue([
      { id: "claude", label: "Claude Code", available: false },
      { id: "cursor", label: "Cursor", available: false },
    ]);

    await _maybeUpdatePlugins(true);

    expect(logOutput()).toContain("No supported editors detected.");
    expect(runInstallsSpy).not.toHaveBeenCalled();
  });

  test("prompts for an editor selection when interactive", async () => {
    setStdinIsTTY(true);

    await _maybeUpdatePlugins(false);

    expect(inquirerPrompt).toHaveBeenCalledTimes(1);
    expect(promptSelectionSpy).toHaveBeenCalledTimes(1);
    expect(runInstallsSpy).toHaveBeenCalledWith(
      ["cursor"],
      "test-token",
      "update"
    );
  });

  test("skips the plugin update when the user declines the prompt", async () => {
    setStdinIsTTY(true);
    promptAnswer = { updatePlugins: false };

    await _maybeUpdatePlugins(false);

    expect(inquirerPrompt).toHaveBeenCalledTimes(1);
    expect(credsSpy).not.toHaveBeenCalled();
    expect(runInstallsSpy).not.toHaveBeenCalled();
  });
});
