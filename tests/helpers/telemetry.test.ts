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

    test("calling initTelemetry twice does not throw", async () => {
      const { initTelemetry, _getClient } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(_getClient()).not.toBeNull();

      // Second init overwrites state — should not throw
      await initTelemetry();
      expect(_getClient()).not.toBeNull();
    });
  });

  describe("trackEvent", () => {
    test("captures event via PostHog client without throwing", async () => {
      const { initTelemetry, trackEvent } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      // Events are queued internally by the SDK (and suppressed entirely in
      // test mode by trackEvent itself), so the contract is simply: no throw.
      expect(() =>
        trackEvent("command_executed", { command: "check" })
      ).not.toThrow();
    });

    test("is a no-op when not initialized", async () => {
      const { trackEvent } = await import("../../src/helpers/telemetry");

      expect(() => trackEvent("should_not_capture")).not.toThrow();
    });

    test("is a no-op with no properties argument", async () => {
      const { trackEvent } = await import("../../src/helpers/telemetry");

      // trackEvent with no properties — exercises the undefined branch
      expect(() => trackEvent("bare_event")).not.toThrow();
    });
  });

  describe("trackCommand", () => {
    test("captures a command_executed event without throwing", async () => {
      const { initTelemetry, trackCommand } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() => trackCommand("adr create", { json: true })).not.toThrow();
    });

    test("is a no-op when not initialized", async () => {
      const { trackCommand } = await import("../../src/helpers/telemetry");

      expect(() => trackCommand("check")).not.toThrow();
    });
  });

  describe("trackCommandResult", () => {
    test("captures command_completed event without throwing", async () => {
      const { initTelemetry, trackCommandResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackCommandResult("check", 0, 120, { outcome: "success" })
      ).not.toThrow();
    });

    test("handles non-zero exit code and extra properties", async () => {
      const { initTelemetry, trackCommandResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackCommandResult("check", 1, 450, {
          outcome: "user_error",
          error_kind: "violations_found",
        })
      ).not.toThrow();
    });

    test("is a no-op when not initialized", async () => {
      const { trackCommandResult } =
        await import("../../src/helpers/telemetry");

      expect(() => trackCommandResult("check", 0, 100)).not.toThrow();
    });
  });

  describe("trackCheckResult", () => {
    test("captures check_completed event without throwing", async () => {
      const { initTelemetry, trackCheckResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
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
          used_base: false,
          used_file_filter: false,
          used_adr_filter: false,
        })
      ).not.toThrow();
    });

    test("accepts optional fields (files_scanned, durations)", async () => {
      const { initTelemetry, trackCheckResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackCheckResult({
          total_rules: 10,
          passed: 10,
          failed: 0,
          warnings: 0,
          errors: 0,
          rule_errors: 0,
          pass: true,
          output_format: "json",
          used_staged: true,
          used_base: true,
          used_file_filter: true,
          used_adr_filter: true,
          files_scanned: 42,
          load_duration_ms: 15,
          check_duration_ms: 200,
        })
      ).not.toThrow();
    });
  });

  describe("trackInitResult", () => {
    test("captures init_completed event without throwing", async () => {
      const { initTelemetry, trackInitResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackInitResult({
          editor: "claude",
          plugin_installed: true,
          plugin_auto_installed: true,
          had_existing_project: false,
        })
      ).not.toThrow();
    });
  });

  describe("trackUpgradeResult", () => {
    test("captures upgrade_completed event without throwing", async () => {
      const { initTelemetry, trackUpgradeResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackUpgradeResult({
          from_version: "0.24.0",
          to_version: "0.25.0",
          install_method: "binary",
          success: true,
        })
      ).not.toThrow();
    });

    test("accepts optional failure fields", async () => {
      const { initTelemetry, trackUpgradeResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackUpgradeResult({
          from_version: "0.24.0",
          to_version: "0.25.0",
          install_method: "binary",
          success: false,
          prompted_by_update_check: true,
          failure_reason: "download_failed",
        })
      ).not.toThrow();
    });
  });

  describe("trackLoginResult", () => {
    test("captures login_completed event without throwing", async () => {
      const { initTelemetry, trackLoginResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackLoginResult({ subcommand: "login", success: true })
      ).not.toThrow();
    });

    test("accepts failure_reason", async () => {
      const { initTelemetry, trackLoginResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackLoginResult({
          subcommand: "login",
          success: false,
          failure_reason: "network",
        })
      ).not.toThrow();
    });

    test("tracks logout subcommand", async () => {
      const { initTelemetry, trackLoginResult } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackLoginResult({ subcommand: "logout", success: true })
      ).not.toThrow();
    });
  });

  describe("trackProjectInitialized", () => {
    test("captures project_initialized event without throwing", async () => {
      const { initTelemetry, trackProjectInitialized } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackProjectInitialized({
          editors: ["claude"],
          editor_primary: "claude",
          plugin_installed: false,
          had_existing_project: false,
          identity_shared: false,
          repo_host: "github",
          repo_is_git: true,
          repo_public: null,
        })
      ).not.toThrow();
    });

    test("accepts identity fields when sharing", async () => {
      const { initTelemetry, trackProjectInitialized } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
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
        })
      ).not.toThrow();
    });
  });

  describe("trackTelemetryPreferenceChange", () => {
    test("captures telemetry_preference_changed event without throwing", async () => {
      const { initTelemetry, trackTelemetryPreferenceChange } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackTelemetryPreferenceChange({ enabled: false })
      ).not.toThrow();
    });

    test("tracks re-enabling telemetry", async () => {
      const { initTelemetry, trackTelemetryPreferenceChange } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackTelemetryPreferenceChange({ enabled: true })
      ).not.toThrow();
    });
  });

  describe("trackGreenfieldWizardShown", () => {
    test("does not throw when initialized", async () => {
      const { initTelemetry, trackGreenfieldWizardShown } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() => trackGreenfieldWizardShown()).not.toThrow();
    });

    test("is a no-op when not initialized", async () => {
      const { trackGreenfieldWizardShown } =
        await import("../../src/helpers/telemetry");

      expect(() => trackGreenfieldWizardShown()).not.toThrow();
    });
  });

  describe("trackPackImportedAtInit", () => {
    test("separates official packs from third-party count", async () => {
      const { initTelemetry, trackPackImportedAtInit } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      // Exercises the filter logic: "packs/" prefix = official, others = third-party
      expect(() =>
        trackPackImportedAtInit([
          "packs/security",
          "packs/testing",
          "my-custom-pack",
        ])
      ).not.toThrow();
    });

    test("handles empty pack list", async () => {
      const { initTelemetry, trackPackImportedAtInit } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() => trackPackImportedAtInit([])).not.toThrow();
    });

    test("handles all-official packs", async () => {
      const { initTelemetry, trackPackImportedAtInit } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackPackImportedAtInit(["packs/security", "packs/testing"])
      ).not.toThrow();
    });

    test("is a no-op when not initialized", async () => {
      const { trackPackImportedAtInit } =
        await import("../../src/helpers/telemetry");

      expect(() => trackPackImportedAtInit(["packs/foo"])).not.toThrow();
    });
  });

  describe("trackWizardSkipped", () => {
    test("does not throw when initialized", async () => {
      const { initTelemetry, trackWizardSkipped } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() => trackWizardSkipped()).not.toThrow();
    });
  });

  describe("trackCustomDomainAdded", () => {
    test("does not throw when initialized", async () => {
      const { initTelemetry, trackCustomDomainAdded } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackCustomDomainAdded({
          domain_name: "security",
          prefix: "SEC",
          total_custom_domains: 1,
        })
      ).not.toThrow();
    });
  });

  describe("trackCustomDomainRemoved", () => {
    test("does not throw when initialized", async () => {
      const { initTelemetry, trackCustomDomainRemoved } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(() =>
        trackCustomDomainRemoved({
          domain_name: "security",
          prefix: "SEC",
          total_custom_domains: 0,
        })
      ).not.toThrow();
    });
  });

  describe("flushTelemetry", () => {
    test("flushes without throwing when initialized", async () => {
      const { initTelemetry, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();

      // Flush with no pending events — should resolve quickly to undefined.
      await expect(flushTelemetry()).resolves.toBeUndefined();
    });

    test("is a no-op when not initialized", async () => {
      const { flushTelemetry } = await import("../../src/helpers/telemetry");

      await expect(flushTelemetry()).resolves.toBeUndefined();
    });

    test("respects custom timeout argument", async () => {
      const { initTelemetry, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();

      // Short timeout — should still resolve (no pending events).
      await expect(flushTelemetry(100)).resolves.toBeUndefined();
    });
  });

  describe("_resetTelemetry", () => {
    test("clears client and initialized state", async () => {
      const { initTelemetry, _getClient, _resetTelemetry } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      expect(_getClient()).not.toBeNull();

      _resetTelemetry();
      expect(_getClient()).toBeNull();
    });

    test("allows re-initialization after reset", async () => {
      const { initTelemetry, _getClient, _resetTelemetry } =
        await import("../../src/helpers/telemetry");

      await initTelemetry();
      _resetTelemetry();
      expect(_getClient()).toBeNull();

      await initTelemetry();
      expect(_getClient()).not.toBeNull();
    });
  });
});
