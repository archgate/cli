// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Copilot branch of tryInstallPlugin via initProject. Sibling of
 * init-project.test.ts — same harness, split to keep that file under the
 * max-lines cap.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as credentialStore from "../../src/helpers/credential-store";
import { initProject } from "../../src/helpers/init-project";
import * as pluginInstall from "../../src/helpers/plugin-install";

describe("tryInstallPlugin via initProject — copilot", () => {
  let tempDir: string;
  let credSpy: Mock<typeof credentialStore.loadCredentials>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-copilot-"));
    credSpy = spyOn(credentialStore, "loadCredentials").mockResolvedValue(null);
  });

  afterEach(() => {
    credSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("copilot with CLI available auto-installs", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCopilotAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCopilotPlugin"
    ).mockResolvedValue({ mode: "cli" });
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBe(true);
      expect(result.plugin!.detail).toBeUndefined();
    } finally {
      availableSpy.mockRestore();
      installSpy.mockRestore();
    }
  });

  test("copilot declarative (desktop-only) install reports a restart note", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCopilotAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCopilotPlugin"
    ).mockResolvedValue({ mode: "declarative" });
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBe(true);
      expect(result.plugin!.deferred).toBe(true);
      expect(result.plugin!.detail).toContain("Restart the GitHub Copilot app");
    } finally {
      availableSpy.mockRestore();
      installSpy.mockRestore();
    }
  });

  test("copilot not installed returns the not-found sentinel", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCopilotAvailable"
    ).mockResolvedValue(false);
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBeUndefined();
      expect(result.plugin!.detail).toBe("not-found");
    } finally {
      availableSpy.mockRestore();
    }
  });

  test("copilot install failure falls back to marketplace URL", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCopilotAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCopilotPlugin"
    ).mockRejectedValue(new Error("install failed"));
    const urlSpy = spyOn(
      pluginInstall,
      "buildVscodeMarketplaceUrl"
    ).mockReturnValue("https://vscode.example");
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "copilot",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.detail).toBe("https://vscode.example");
    } finally {
      availableSpy.mockRestore();
      installSpy.mockRestore();
      urlSpy.mockRestore();
    }
  });
});
