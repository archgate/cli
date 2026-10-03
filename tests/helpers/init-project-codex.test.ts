// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as credentialStore from "../../src/helpers/credential-store";
import { initProject } from "../../src/helpers/init-project";
import * as pluginInstall from "../../src/helpers/plugin-install";
import { safeRmSync } from "../test-utils";

describe("initProject codex plugin install", () => {
  let tempDir: string;
  let credSpy: ReturnType<
    typeof spyOn<typeof credentialStore, "loadCredentials">
  >;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-initproj-codex-test-"));
    credSpy = spyOn(credentialStore, "loadCredentials");
  });

  afterEach(() => {
    credSpy.mockRestore();
    safeRmSync(tempDir);
  });

  test("codex available auto-installs without touching Claude", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCodexCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCodexPlugin"
    ).mockResolvedValue();
    const claudeSpy = spyOn(
      pluginInstall,
      "installClaudePlugin"
    ).mockResolvedValue();
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "codex",
      });
      expect(result.plugin!.autoInstalled).toBe(true);
      expect(installSpy).toHaveBeenCalledTimes(1);
      expect(claudeSpy).not.toHaveBeenCalled();
    } finally {
      availableSpy.mockRestore();
      installSpy.mockRestore();
      claudeSpy.mockRestore();
    }
  });

  test("codex not found returns not-found", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCodexCliAvailable"
    ).mockResolvedValue(false);
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "codex",
      });
      expect(result.plugin!.detail).toBe("not-found");
    } finally {
      availableSpy.mockRestore();
    }
  });

  test("codex install failure returns error detail", async () => {
    credSpy.mockResolvedValue({ token: "tok", github_user: "user" });
    const availableSpy = spyOn(
      pluginInstall,
      "isCodexCliAvailable"
    ).mockResolvedValue(true);
    const installSpy = spyOn(
      pluginInstall,
      "installCodexPlugin"
    ).mockRejectedValue(new Error("boom"));
    try {
      const result = await initProject(tempDir, {
        installPlugin: true,
        editor: "codex",
      });
      expect(result.plugin!.installed).toBe(true);
      expect(result.plugin!.autoInstalled).toBeUndefined();
      expect(result.plugin!.detail).toBe("boom");
    } finally {
      availableSpy.mockRestore();
      installSpy.mockRestore();
    }
  });
});
