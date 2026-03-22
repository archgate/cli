import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("telemetry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-telemetry-test-"));
    originalHome = process.env.HOME;
    originalTelemetryEnv = process.env.ARCHGATE_TELEMETRY;
    process.env.HOME = tempDir;
    delete process.env.ARCHGATE_TELEMETRY;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalTelemetryEnv === undefined) {
      delete process.env.ARCHGATE_TELEMETRY;
    } else {
      process.env.ARCHGATE_TELEMETRY = originalTelemetryEnv;
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

      initTelemetry();
      expect(_getClient()).not.toBeNull();
    });

    test("skips init when telemetry is disabled via env", async () => {
      process.env.ARCHGATE_TELEMETRY = "0";

      const { initTelemetry, _getClient } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      expect(_getClient()).toBeNull();
    });
  });

  describe("trackEvent", () => {
    test("captures event via PostHog client without throwing", async () => {
      const { initTelemetry, trackEvent } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      // Should not throw — events are queued internally by the SDK
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

      initTelemetry();
      // Should not throw
      trackCommand("adr create", { json: true });
    });
  });

  describe("flushTelemetry", () => {
    test("flushes without throwing when initialized", async () => {
      const { initTelemetry, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      initTelemetry();

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
