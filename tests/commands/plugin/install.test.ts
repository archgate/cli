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

// ---------------------------------------------------------------------------
// Module mocks — declared before imports that use them.
// ---------------------------------------------------------------------------

// loadCredentials is stubbed per-test via spyOn (see beforeEach), NOT
// mock.module — mock.module is process-global and would leak the stub into
// credential-store.test.ts and other consumers.
let mockLoadCredentials: Mock<typeof credentialStore.loadCredentials>;

const mockInstallClaudePlugin = mock(async () => {});
const mockInstallCopilotPlugin = mock(
  async (): Promise<{ mode: "cli" | "declarative" }> => ({ mode: "cli" })
);
const mockInstallVscodeExtension = mock(async (_token: string) => {});
const mockInstallOpencodePlugin = mock(async (_token: string) => {});
const mockInstallCursorPlugin = mock(async (_token: string) => {});
const mockIsClaudeCliAvailable = mock(async () => false);
const mockIsCopilotAvailable = mock(async () => false);
const mockIsVscodeCliAvailable = mock(async () => false);
const mockIsOpencodeAvailable = mock(async () => false);
void mock.module("../../../src/helpers/plugin-install", () => ({
  buildMarketplaceUrl: () => "https://plugins.archgate.dev/archgate.git",
  buildVscodeMarketplaceUrl: () =>
    "https://plugins.archgate.dev/archgate/vscode.git",
  buildCursorMarketplaceUrl: () =>
    "https://plugins.archgate.dev/archgate/cursor.git",
  installClaudePlugin: mockInstallClaudePlugin,
  installCopilotPlugin: mockInstallCopilotPlugin,
  installVscodeExtension: mockInstallVscodeExtension,
  installOpencodePlugin: mockInstallOpencodePlugin,
  installCursorPlugin: mockInstallCursorPlugin,
  isClaudeCliAvailable: mockIsClaudeCliAvailable,
  isCopilotAvailable: mockIsCopilotAvailable,
  isVscodeCliAvailable: mockIsVscodeCliAvailable,
  isOpencodeAvailable: mockIsOpencodeAvailable,
  isCursorCliAvailable: mock(async () => false),
}));

const mockDetectEditors = mock(async () => []);
const mockPromptEditorSelection = mock(async () => ["claude" as const]);
void mock.module("../../../src/helpers/editor-detect", () => ({
  detectEditors: mockDetectEditors,
  promptEditorSelection: mockPromptEditorSelection,
}));

const mockConfigureVscodeSettings = mock(
  async (_root: string, _url: string) => {}
);
void mock.module("../../../src/helpers/vscode-settings", () => ({
  configureVscodeSettings: mockConfigureVscodeSettings,
}));

// NOTE: Do NOT mock.module paths or credential-store here — mock.module is
// process-global and leaks into other test files (e.g. session-context and
// credential-store tests). For first-party modules we use spyOn in beforeEach
// (findProjectRoot, loadCredentials), which is per-test and auto-restored.

// ---------------------------------------------------------------------------
// Imports under test — loaded AFTER mocks are registered.
// ---------------------------------------------------------------------------

import { Command } from "@commander-js/extra-typings";

import { registerPluginInstallCommand } from "../../../src/commands/plugin/install";
import * as credentialStore from "../../../src/helpers/credential-store";
import * as pathsMod from "../../../src/helpers/paths";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

let logSpy: Mock<typeof console.log>;
let warnSpy: Mock<typeof console.warn>;
let errorSpy: Mock<typeof console.error>;
let exitSpy: Mock<typeof process.exit>;

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerPluginInstallCommand(program);
  return program;
}

async function runInstall(args: string[]): Promise<void> {
  const program = buildProgram();
  const sub = program.commands.find((c) => c.name() === "install")!;
  await sub.parseAsync(args, { from: "user" });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = spyOn(console, "error").mockImplementation(() => {});
  exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit called");
  });
  spyOn(pathsMod, "findProjectRoot").mockReturnValue("/fake/project");
  mockLoadCredentials = spyOn(
    credentialStore,
    "loadCredentials"
  ).mockResolvedValue(null);

  // Reset all mocks
  mockInstallClaudePlugin.mockReset();
  mockInstallCopilotPlugin.mockReset();
  mockInstallVscodeExtension.mockReset();
  mockInstallOpencodePlugin.mockReset();
  mockIsClaudeCliAvailable.mockReset();
  mockIsCopilotAvailable.mockReset();
  mockIsVscodeCliAvailable.mockReset();
  mockIsOpencodeAvailable.mockReset();
  mockDetectEditors.mockReset();
  mockPromptEditorSelection.mockReset();
  mockConfigureVscodeSettings.mockReset();

  // Default implementations
  mockInstallClaudePlugin.mockImplementation(async () => {});
  mockInstallCopilotPlugin.mockImplementation(async () => ({ mode: "cli" }));
  mockInstallVscodeExtension.mockImplementation(async (_token: string) => {});
  mockInstallOpencodePlugin.mockImplementation(async (_token: string) => {});
  mockIsClaudeCliAvailable.mockImplementation(async () => false);
  mockIsCopilotAvailable.mockImplementation(async () => false);
  mockIsVscodeCliAvailable.mockImplementation(async () => false);
  mockIsOpencodeAvailable.mockImplementation(async () => false);
  mockConfigureVscodeSettings.mockImplementation(async () => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
  exitSpy.mockRestore();
  mock.restore();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerPluginInstallCommand", () => {
  test("registers 'install' as a subcommand", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install");
    expect(sub).toBeDefined();
  });

  test("has a description", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    expect(sub.description()).toBeTruthy();
  });

  test("accepts --editor option without default (auto-detect when omitted)", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor");
    expect(editorOpt).toBeDefined();
    expect(editorOpt!.defaultValue).toBeUndefined();
  });

  test("--editor option restricts choices to valid editors", () => {
    const program = new Command();
    registerPluginInstallCommand(program);
    const sub = program.commands.find((c) => c.name() === "install")!;
    const editorOpt = sub.options.find((o) => o.long === "--editor")!;
    expect(editorOpt.argChoices).toEqual([
      "claude",
      "cursor",
      "vscode",
      "copilot",
      "opencode",
    ]);
  });
});

describe("plugin install action", () => {
  test("exits with error when not logged in", async () => {
    mockLoadCredentials.mockImplementation(async () => null);

    expect(runInstall(["--editor", "claude"])).rejects.toThrow(
      "process.exit called"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("installs claude plugin when CLI is available", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsClaudeCliAvailable.mockImplementation(async () => true);

    await runInstall(["--editor", "claude"]);

    expect(mockInstallClaudePlugin).toHaveBeenCalledTimes(1);
  });

  test("prints manual instructions when claude CLI not found", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsClaudeCliAvailable.mockImplementation(async () => false);

    await runInstall(["--editor", "claude"]);

    // Should not call installClaudePlugin
    expect(mockInstallClaudePlugin).not.toHaveBeenCalled();
    // Should print a warning about Claude CLI not found
    expect(warnSpy).toHaveBeenCalled();
  });

  test("installs cursor plugin for --editor cursor", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));

    await runInstall(["--editor", "cursor"]);

    // Cursor case calls installCursorPlugin with the token
    expect(mockInstallCursorPlugin).toHaveBeenCalledWith("tok");
  });

  test("installs copilot plugin when Copilot is available", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsCopilotAvailable.mockImplementation(async () => true);

    await runInstall(["--editor", "copilot"]);

    expect(mockInstallCopilotPlugin).toHaveBeenCalledTimes(1);
  });

  test("prints a restart note for a declarative (desktop-only) copilot install", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsCopilotAvailable.mockImplementation(async () => true);
    mockInstallCopilotPlugin.mockImplementation(async () => ({
      mode: "declarative" as const,
    }));

    await runInstall(["--editor", "copilot"]);

    expect(mockInstallCopilotPlugin).toHaveBeenCalledTimes(1);
    const logged = logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("Restart the GitHub Copilot app");
  });

  test("prints manual instructions when Copilot is not installed", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsCopilotAvailable.mockImplementation(async () => false);

    await runInstall(["--editor", "copilot"]);

    expect(mockInstallCopilotPlugin).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("installs vscode extension when code CLI is available", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsVscodeCliAvailable.mockImplementation(async () => true);

    await runInstall(["--editor", "vscode"]);

    expect(mockConfigureVscodeSettings).toHaveBeenCalledTimes(1);
    expect(mockInstallVscodeExtension).toHaveBeenCalledWith("tok");
  });

  test("prints manual instructions when vscode CLI not found", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsVscodeCliAvailable.mockImplementation(async () => false);

    await runInstall(["--editor", "vscode"]);

    // Should configure vscode settings even without CLI
    expect(mockConfigureVscodeSettings).toHaveBeenCalledTimes(1);
    // Should not call installVscodeExtension
    expect(mockInstallVscodeExtension).not.toHaveBeenCalled();
    // Should print a warning about code CLI not found
    expect(warnSpy).toHaveBeenCalled();
  });

  test("installs opencode plugin when opencode is available", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsOpencodeAvailable.mockImplementation(async () => true);

    await runInstall(["--editor", "opencode"]);

    expect(mockInstallOpencodePlugin).toHaveBeenCalledWith("tok");
  });

  test("skips opencode install when opencode not available", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsOpencodeAvailable.mockImplementation(async () => false);

    await runInstall(["--editor", "opencode"]);

    expect(mockInstallOpencodePlugin).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  test("prints manual instructions and exits 1 on install failure", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsClaudeCliAvailable.mockImplementation(async () => true);
    mockInstallClaudePlugin.mockImplementation(async () => {
      throw new Error("marketplace add failed (exit 1)");
    });

    expect(runInstall(["--editor", "claude"])).rejects.toThrow(
      "process.exit called"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("defaults to claude editor in non-TTY context without --editor", async () => {
    mockLoadCredentials.mockImplementation(async () => ({
      token: "tok",
      github_user: "user",
    }));
    mockIsClaudeCliAvailable.mockImplementation(async () => true);

    // process.stdin.isTTY is undefined in test context (non-TTY)
    await runInstall([]);

    expect(mockInstallClaudePlugin).toHaveBeenCalledTimes(1);
  });
});
