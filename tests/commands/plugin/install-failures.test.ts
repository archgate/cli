// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Failure and interactive-selection paths of `archgate plugin install`.
 * Sibling of install.test.ts, which is already at the `max-lines` budget.
 *
 * First-party modules are stubbed with `spyOn` over an imported namespace
 * instead of `mock.module`, which is process-global (ARCH-005).
 */
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

import { Command } from "@commander-js/extra-typings";

import { registerPluginInstallCommand } from "../../../src/commands/plugin/install";
import * as credentialStore from "../../../src/helpers/credential-store";
import * as editorDetect from "../../../src/helpers/editor-detect";
import type { EditorTarget } from "../../../src/helpers/init-project";
import * as pathsMod from "../../../src/helpers/paths";
import * as pluginInstall from "../../../src/helpers/plugin-install";
import * as vscodeSettings from "../../../src/helpers/vscode-settings";

const FAILURE_MESSAGE = "install exploded";

let logSpy: Mock<typeof console.log>;
let warnSpy: Mock<typeof console.warn>;
let errorSpy: Mock<typeof console.error>;
let exitSpy: Mock<typeof process.exit>;
let originalIsTTY: boolean | undefined;

let installClaude: Mock<typeof pluginInstall.installClaudePlugin>;
let installCopilot: Mock<typeof pluginInstall.installCopilotPlugin>;
let installCursor: Mock<typeof pluginInstall.installCursorPlugin>;
let installOpencode: Mock<typeof pluginInstall.installOpencodePlugin>;
let installVscode: Mock<typeof pluginInstall.installVscodeExtension>;
let configureVscode: Mock<typeof vscodeSettings.configureVscodeSettings>;
let detectSpy: Mock<typeof editorDetect.detectEditors>;
let promptSpy: Mock<typeof editorDetect.promptEditorSelection>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  originalIsTTY = process.stdin.isTTY;

  spyOn(credentialStore, "loadCredentials").mockResolvedValue({
    token: "tok",
    github_user: "user",
  });
  spyOn(pathsMod, "findProjectRoot").mockReturnValue("/fake/project");
  spyOn(pluginInstall, "buildMarketplaceUrl").mockReturnValue(
    "https://plugins.archgate.dev/archgate.git"
  );
  spyOn(pluginInstall, "buildVscodeMarketplaceUrl").mockReturnValue(
    "https://plugins.archgate.dev/archgate/vscode.git"
  );
  spyOn(pluginInstall, "isClaudeCliAvailable").mockResolvedValue(true);
  spyOn(pluginInstall, "isCopilotAvailable").mockResolvedValue(true);
  spyOn(pluginInstall, "isCursorCliAvailable").mockResolvedValue(true);
  spyOn(pluginInstall, "isOpencodeAvailable").mockResolvedValue(true);
  spyOn(pluginInstall, "isVscodeCliAvailable").mockResolvedValue(true);

  installClaude = spyOn(
    pluginInstall,
    "installClaudePlugin"
  ).mockResolvedValue();
  installCopilot = spyOn(
    pluginInstall,
    "installCopilotPlugin"
  ).mockResolvedValue({ mode: "cli" });
  installCursor = spyOn(
    pluginInstall,
    "installCursorPlugin"
  ).mockResolvedValue();
  installOpencode = spyOn(
    pluginInstall,
    "installOpencodePlugin"
  ).mockResolvedValue();
  installVscode = spyOn(
    pluginInstall,
    "installVscodeExtension"
  ).mockResolvedValue();
  configureVscode = spyOn(
    vscodeSettings,
    "configureVscodeSettings"
  ).mockResolvedValue("/fake/project/.vscode/settings.json");

  detectSpy = spyOn(editorDetect, "detectEditors").mockResolvedValue([]);
  promptSpy = spyOn(editorDetect, "promptEditorSelection").mockResolvedValue([
    "claude",
  ]);
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  mock.restore();
  setTTY(originalIsTTY);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
}

async function runInstall(args: string[]): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerPluginInstallCommand(program);
  const sub = program.commands.find((c) => c.name() === "install")!;
  await sub.parseAsync(args, { from: "user" });
}

function loggedOutput(): string {
  return logSpy.mock.calls
    .map((c: unknown[]) => c.map(String).join(" "))
    .join("\n");
}

function erroredOutput(): string {
  return errorSpy.mock.calls
    .map((c: unknown[]) => c.map(String).join(" "))
    .join("\n");
}

/** Make the editor's own install step reject, so `runPluginInstalls` collects it. */
function forceFailure(editor: EditorTarget): void {
  const boom = new Error(FAILURE_MESSAGE);
  switch (editor) {
    case "claude":
      installClaude.mockRejectedValue(boom);
      break;
    case "copilot":
      installCopilot.mockRejectedValue(boom);
      break;
    case "cursor":
      installCursor.mockRejectedValue(boom);
      break;
    case "opencode":
      installOpencode.mockRejectedValue(boom);
      break;
    case "vscode":
      // configureVscodeSettings runs before the CLI probe, so failing it
      // short-circuits the whole vscode branch.
      configureVscode.mockRejectedValue(boom);
      break;
  }
}

async function runFailingInstall(editor: EditorTarget): Promise<void> {
  forceFailure(editor);
  const running = runInstall(["--editor", editor]);
  expect(running).rejects.toThrow("process.exit called");
  // Settle before the caller inspects the spies.
  await running.catch(() => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** One row per editor: the heading and command `printManualInstructions` prints. */
const MANUAL_INSTRUCTION_CASES = [
  {
    editor: "claude" as const,
    heading: "To install the plugin manually, run:",
    fallback: "claude plugin marketplace add",
  },
  {
    editor: "copilot" as const,
    heading: "To install the plugin manually, run:",
    fallback: "copilot plugin marketplace add",
  },
  {
    editor: "cursor" as const,
    heading: "To install the plugin manually, run:",
    fallback: "archgate plugin install --editor cursor",
  },
  {
    editor: "vscode" as const,
    heading: "To install the extension manually, run:",
    fallback: "--install-extension archgate.vsix",
  },
  {
    editor: "opencode" as const,
    heading: "Retry the install, or refresh your credentials",
    fallback: "archgate login refresh",
  },
];

describe.each(MANUAL_INSTRUCTION_CASES)(
  "plugin install failure for $editor",
  ({ editor, heading, fallback }) => {
    test("exits 1 and reports the underlying error", async () => {
      await runFailingInstall(editor);

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(erroredOutput()).toContain("Failed to install plugin for");
      expect(erroredOutput()).toContain(FAILURE_MESSAGE);
    });

    test("prints the manual fallback command", async () => {
      await runFailingInstall(editor);

      expect(loggedOutput()).toContain(heading);
      expect(loggedOutput()).toContain(fallback);
    });
  }
);

describe("interactive editor selection", () => {
  test("prompts with the detected editors when stdin is a TTY", async () => {
    setTTY(true);
    const detected = [
      { id: "claude" as const, label: "Claude Code", available: true },
      { id: "vscode" as const, label: "VS Code", available: false },
    ];
    detectSpy.mockResolvedValue(detected);
    promptSpy.mockResolvedValue(["claude"]);

    await runInstall([]);

    expect(detectSpy).toHaveBeenCalledTimes(1);
    expect(promptSpy).toHaveBeenCalledWith(detected);
    expect(installClaude).toHaveBeenCalledTimes(1);
  });

  test("installs every editor the prompt returns", async () => {
    setTTY(true);
    detectSpy.mockResolvedValue([]);
    promptSpy.mockResolvedValue(["cursor", "opencode"]);

    await runInstall([]);

    expect(installCursor).toHaveBeenCalledWith("tok");
    expect(installOpencode).toHaveBeenCalledWith("tok");
    expect(installClaude).not.toHaveBeenCalled();
  });

  test("skips detection entirely when --editor is given on a TTY", async () => {
    setTTY(true);

    await runInstall(["--editor", "vscode"]);

    expect(detectSpy).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
    expect(installVscode).toHaveBeenCalledWith("tok");
  });
});
