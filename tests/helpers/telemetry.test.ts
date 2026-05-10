// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("telemetry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-telemetry-test-"));
    originalHome = process.env.HOME;
    originalTelemetryEnv = process.env.ARCHGATE_TELEMETRY;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.HOME = tempDir;
    delete process.env.ARCHGATE_TELEMETRY;
    // NODE_ENV=test keeps trackEvent from sending real events to the prod
    // PostHog project. See ARCH-005 for the equivalent Sentry convention.
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalTelemetryEnv === undefined) {
      delete process.env.ARCHGATE_TELEMETRY;
    } else {
      process.env.ARCHGATE_TELEMETRY = originalTelemetryEnv;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });

    const { _resetTelemetry } = await import("../../src/helpers/telemetry");
    _resetTelemetry();
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
  });

  describe("initTelemetry", () => {
    test("initializes PostHog client when telemetry is enabled", async () => {
      const { initTelemetry, _getClient } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(_getClient()).not.toBeNull();
    });

    test("skips init when telemetry is disabled via env", async () => {
      process.env.ARCHGATE_TELEMETRY = "0";

      const { initTelemetry, _getClient } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(_getClient()).toBeNull();
    });
  });

  describe("trackEvent", () => {
    test("captures event via PostHog client without throwing", async () => {
      const { initTelemetry, trackEvent } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      // Should not throw — events are queued internally by the SDK (and
      // suppressed entirely in test mode by trackEvent itself)
      trackEvent("command_executed", { command: "check" });
    });

    test("is a no-op when not initialized", async () => {
      const { trackEvent } = await import("../../src/helpers/telemetry");

      // Should not throw
      trackEvent("should_not_capture");
    });
  });

  describe("trackCommand", () => {
    test("captures a command_executed event without throwing", async () => {
      const { initTelemetry, trackCommand } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      // Should not throw
      trackCommand("adr create", { json: true });
    });
  });

  describe("trackCheckResult", () => {
    test("captures check_completed event without throwing", async () => {
      const { initTelemetry, trackCheckResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackCheckResult({
        total_rules: 5,
        passed: 4,
        failed: 1,
        warnings: 2,
        errors: 1,
        rule_errors: 0,
        pass: false,
        output_format: "console",
        used_staged: false,
        used_file_filter: false,
        used_adr_filter: false,
      });
    });
  });

  describe("trackInitResult", () => {
    test("captures init_completed event without throwing", async () => {
      const { initTelemetry, trackInitResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackInitResult({
        editor: "claude",
        plugin_installed: true,
        plugin_auto_installed: true,
        had_existing_project: false,
      });
    });
  });

  describe("trackUpgradeResult", () => {
    test("captures upgrade_completed event without throwing", async () => {
      const { initTelemetry, trackUpgradeResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackUpgradeResult({
        from_version: "0.24.0",
        to_version: "0.25.0",
        install_method: "binary",
        success: true,
      });
    });
  });

  describe("trackLoginResult", () => {
    test("captures login_completed event without throwing", async () => {
      const { initTelemetry, trackLoginResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackLoginResult({ subcommand: "login", success: true });
    });
  });

  describe("trackProjectInitialized", () => {
    test("captures project_initialized event without throwing", async () => {
      const { initTelemetry, trackProjectInitialized } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackProjectInitialized({
        editors: ["claude"],
        editor_primary: "claude",
        plugin_installed: false,
        had_existing_project: false,
        identity_shared: false,
        repo_host: "github",
        repo_is_git: true,
        repo_public: null,
      });
    });

    test("accepts identity fields when sharing", async () => {
      const { initTelemetry, trackProjectInitialized } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackProjectInitialized({
        editors: ["claude"],
        editor_primary: "claude",
        plugin_installed: false,
        had_existing_project: false,
        identity_shared: true,
        repo_host: "github",
        repo_is_git: true,
        repo_public: true,
        remote_url: "https://github.com/archgate/cli.git",
        repo_owner: "archgate",
        repo_name: "cli",
      });
    });
  });

  describe("trackTelemetryPreferenceChange", () => {
    test("captures telemetry_preference_changed event without throwing", async () => {
      const { initTelemetry, trackTelemetryPreferenceChange } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      trackTelemetryPreferenceChange({ enabled: false });
    });
  });

  describe("flushTelemetry", () => {
    test("flushes without throwing when initialized", async () => {
      const { initTelemetry, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();

      // Flush with no pending events — should resolve quickly
      await flushTelemetry();
    });

    test("is a no-op when not initialized", async () => {
      const { flushTelemetry } = await import("../../src/helpers/telemetry");

      // Should not throw
      await flushTelemetry();
    });
  });
});
