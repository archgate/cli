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

import { Command } from "@commander-js/extra-typings";

import { registerPluginInstallCommand } from "../../../src/commands/plugin/install";
import * as credentialStore from "../../../src/helpers/credential-store";
import * as pluginInstall from "../../../src/helpers/plugin-install";

let logSpy: Mock<typeof console.log>;
let installSpy: Mock<typeof pluginInstall.installCodexPlugin>;
let availableSpy: Mock<typeof pluginInstall.isCodexCliAvailable>;

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
  spyOn(console, "warn").mockImplementation(() => {});
  spyOn(credentialStore, "loadCredentials").mockResolvedValue({
    token: "tok",
    github_user: "user",
  });
  installSpy = spyOn(pluginInstall, "installCodexPlugin").mockResolvedValue();
  availableSpy = spyOn(pluginInstall, "isCodexCliAvailable");
});

afterEach(() => {
  mock.restore();
});

async function runInstall(): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerPluginInstallCommand(program);
  const sub = program.commands.find((c) => c.name() === "install")!;
  await sub.parseAsync(["--editor", "codex"], { from: "user" });
}

describe("plugin install --editor codex", () => {
  test("installs through the Codex CLI when available", async () => {
    availableSpy.mockResolvedValue(true);

    await runInstall();

    expect(installSpy).toHaveBeenCalledTimes(1);
  });

  test("prints manual commands when the Codex CLI is missing", async () => {
    availableSpy.mockResolvedValue(false);

    await runInstall();

    expect(installSpy).not.toHaveBeenCalled();
    const out = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(out).toContain("codex plugin marketplace add");
    expect(out).toContain("codex plugin add");
  });
});
