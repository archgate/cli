// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("sentry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sentry-test-"));
    originalHome = Bun.env.HOME;
    originalTelemetryEnv = Bun.env.ARCHGATE_TELEMETRY;
    originalNodeEnv = Bun.env.NODE_ENV;
    Bun.env.HOME = tempDir;
    Bun.env.NODE_ENV = "test";
    delete Bun.env.ARCHGATE_TELEMETRY;
  });

  afterEach(async () => {
    Bun.env.HOME = originalHome;
    if (originalTelemetryEnv === undefined) {
      delete Bun.env.ARCHGATE_TELEMETRY;
    } else {
      Bun.env.ARCHGATE_TELEMETRY = originalTelemetryEnv;
    }
    if (originalNodeEnv === undefined) {
      delete Bun.env.NODE_ENV;
    } else {
      Bun.env.NODE_ENV = originalNodeEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });

    const { _resetSentry } = await import("../../src/helpers/sentry");
    _resetSentry();
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
    mock.restore();
  });

  describe("initSentry", () => {
    test("initializes Sentry SDK when telemetry is enabled", async () => {
      const { initSentry } = await import("../../src/helpers/sentry");

      // Sentry.init is called internally — initialization must resolve cleanly.
      await expect(initSentry()).resolves.toBeUndefined();
    });

    test("does not initialize when telemetry is disabled", async () => {
      Bun.env.ARCHGATE_TELEMETRY = "0";

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      await initSentry();
      // captureException should be a no-op when telemetry is disabled.
      expect(() =>
        captureException(new Error("should not send"))
      ).not.toThrow();
    });
  });

  describe("captureException", () => {
    test("is a no-op when not initialized", async () => {
      const { captureException } = await import("../../src/helpers/sentry");

      expect(() =>
        captureException(new Error("should not send"))
      ).not.toThrow();
    });

    test("handles non-Error values without throwing", async () => {
      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      await initSentry();
      expect(() =>
        captureException("string error", { command: "init" })
      ).not.toThrow();
    });
  });

  describe("addBreadcrumb", () => {
    test("is a no-op when not initialized", async () => {
      const { addBreadcrumb } = await import("../../src/helpers/sentry");

      expect(() => addBreadcrumb("test", "test breadcrumb")).not.toThrow();
    });

    test("adds breadcrumb when initialized", async () => {
      const { initSentry, addBreadcrumb } =
        await import("../../src/helpers/sentry");

      await initSentry();
      expect(() =>
        addBreadcrumb("command", "Running: check", { staged: true })
      ).not.toThrow();
    });
  });

  describe("flushSentry", () => {
    test("is a no-op when not initialized", async () => {
      const { flushSentry } = await import("../../src/helpers/sentry");

      await expect(flushSentry()).resolves.toBeUndefined();
    });

    test("flushes when initialized", async () => {
      const { initSentry, flushSentry } =
        await import("../../src/helpers/sentry");

      await initSentry();
      await expect(flushSentry(100)).resolves.toBeUndefined();
    });
  });
});
