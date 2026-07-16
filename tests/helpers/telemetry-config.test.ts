// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { restoreEnv } from "../test-utils";

describe("telemetry-config", () => {
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
    // `env.X = undefined` assigns the string "undefined" rather than unsetting,
    // so HOME (normally unset on Windows) leaked into every later test file.
    // Bun.env and process.env are the same store, so restoreEnv covers both.
    restoreEnv("HOME", originalHome);
    restoreEnv("ARCHGATE_TELEMETRY", originalTelemetryEnv);
    rmSync(tempDir, { recursive: true, force: true });

    // Reset cached config between tests
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
  });

  describe("loadTelemetryConfig", () => {
    test("creates config with telemetry enabled on first run", async () => {
      const { loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      const config = loadTelemetryConfig();
      expect(config.telemetry).toBe(true);
      expect(config.installId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
      expect(config.createdAt).toBeTruthy();
    });

    test("returns cached config on subsequent calls", async () => {
      const { loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      const first = loadTelemetryConfig();
      const second = loadTelemetryConfig();
      expect(first).toBe(second); // Same reference (cached)
    });

    test("reads existing config from disk", async () => {
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        join(configDir, "config.json"),
        JSON.stringify({
          telemetry: false,
          installId: "test-uuid-1234",
          createdAt: "2026-01-01T00:00:00.000Z",
        })
      );

      const { loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      const config = loadTelemetryConfig();
      expect(config.telemetry).toBe(false);
      expect(config.installId).toBe("test-uuid-1234");
    });

    test("preserves noticeShown flag from disk", async () => {
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        join(configDir, "config.json"),
        JSON.stringify({
          telemetry: true,
          installId: "test-uuid-5678",
          createdAt: "2026-01-01T00:00:00.000Z",
          noticeShown: true,
        })
      );

      const { loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      const config = loadTelemetryConfig();
      expect(config.noticeShown).toBe(true);
    });

    test("creates new config when file is malformed", async () => {
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(join(configDir, "config.json"), "not-json");

      const { loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      const config = loadTelemetryConfig();
      expect(config.telemetry).toBe(true);
      expect(config.installId).toBeTruthy();
    });
  });

  describe("isEnvTelemetryDisabled", () => {
    test("returns false when env var is not set", async () => {
      const { isEnvTelemetryDisabled } =
        await import("../../src/helpers/telemetry-config");
      expect(isEnvTelemetryDisabled()).toBe(false);
    });

    test.each(["0", "false", "no", "off", "FALSE", "No", "OFF"])(
      "returns true for %s",
      async (value) => {
        process.env.ARCHGATE_TELEMETRY = value;
        const { isEnvTelemetryDisabled } =
          await import("../../src/helpers/telemetry-config");
        expect(isEnvTelemetryDisabled()).toBe(true);
      }
    );

    test("returns false for other values like '1' or 'true'", async () => {
      process.env.ARCHGATE_TELEMETRY = "1";
      const { isEnvTelemetryDisabled } =
        await import("../../src/helpers/telemetry-config");
      expect(isEnvTelemetryDisabled()).toBe(false);
    });
  });

  describe("isTelemetryEnabled", () => {
    test("returns true by default", async () => {
      const { isTelemetryEnabled } =
        await import("../../src/helpers/telemetry-config");
      expect(isTelemetryEnabled()).toBe(true);
    });

    test("returns false when env var disables it", async () => {
      process.env.ARCHGATE_TELEMETRY = "0";
      const { isTelemetryEnabled } =
        await import("../../src/helpers/telemetry-config");
      expect(isTelemetryEnabled()).toBe(false);
    });

    test("returns false when config disables it", async () => {
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        join(configDir, "config.json"),
        JSON.stringify({
          telemetry: false,
          installId: "test-uuid",
          createdAt: "2026-01-01",
        })
      );

      const { isTelemetryEnabled } =
        await import("../../src/helpers/telemetry-config");
      expect(isTelemetryEnabled()).toBe(false);
    });
  });

  describe("setTelemetryEnabled", () => {
    test("persists disabled state to disk", async () => {
      const { setTelemetryEnabled, loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      // Initialize first
      loadTelemetryConfig();

      // Wait for async first-run save
      await Bun.sleep(100);

      await setTelemetryEnabled(false);

      // Read from disk to verify persistence
      const configPath = join(tempDir, ".archgate", "config.json");
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.telemetry).toBe(false);
    });

    test("persists enabled state to disk", async () => {
      const { setTelemetryEnabled, loadTelemetryConfig } =
        await import("../../src/helpers/telemetry-config");

      loadTelemetryConfig();
      await Bun.sleep(100);

      await setTelemetryEnabled(false);
      await setTelemetryEnabled(true);

      const configPath = join(tempDir, ".archgate", "config.json");
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.telemetry).toBe(true);
    });
  });

  describe("getInstallId", () => {
    test("returns the same ID across calls", async () => {
      const { getInstallId } =
        await import("../../src/helpers/telemetry-config");

      const id1 = getInstallId();
      const id2 = getInstallId();
      expect(id1).toBe(id2);
    });
  });

  describe("showFirstRunNoticeIfNeeded", () => {
    let originalIsTTY: boolean | undefined;
    let originalCI: string | undefined;

    beforeEach(() => {
      originalIsTTY = process.stdout.isTTY;
      originalCI = Bun.env.CI;
    });

    afterEach(() => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
      restoreEnv("CI", originalCI);
    });

    test("prints notice when TTY + enabled + not yet shown", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      delete Bun.env.CI;
      delete process.env.ARCHGATE_TELEMETRY;

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();

        expect(writeSpy).toHaveBeenCalled();
        const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
        expect(output).toContain("anonymous usage data");
        expect(output).toContain("archgate telemetry disable");
      } finally {
        writeSpy.mockRestore();
      }
    });

    test("does not print when noticeShown is already true", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      delete Bun.env.CI;
      delete process.env.ARCHGATE_TELEMETRY;

      // Write a config with noticeShown: true
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        join(configDir, "config.json"),
        JSON.stringify({
          telemetry: true,
          installId: "test-uuid-notice",
          createdAt: "2026-01-01T00:00:00.000Z",
          noticeShown: true,
        })
      );

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();
        // No output — notice was already shown
        const privacyCalls = writeSpy.mock.calls.filter((c) =>
          String(c[0]).includes("anonymous usage data")
        );
        expect(privacyCalls).toHaveLength(0);
      } finally {
        writeSpy.mockRestore();
      }
    });

    test("does not print when CI env is set", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      Bun.env.CI = "true";
      delete process.env.ARCHGATE_TELEMETRY;

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();
        const privacyCalls = writeSpy.mock.calls.filter((c) =>
          String(c[0]).includes("anonymous usage data")
        );
        expect(privacyCalls).toHaveLength(0);
      } finally {
        writeSpy.mockRestore();
      }
    });

    test("does not print when telemetry is disabled via env", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      delete Bun.env.CI;
      process.env.ARCHGATE_TELEMETRY = "0";

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();
        const privacyCalls = writeSpy.mock.calls.filter((c) =>
          String(c[0]).includes("anonymous usage data")
        );
        expect(privacyCalls).toHaveLength(0);
      } finally {
        writeSpy.mockRestore();
      }
    });

    test("does not print when telemetry is disabled via config", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });
      delete Bun.env.CI;
      delete process.env.ARCHGATE_TELEMETRY;

      // Write a config with telemetry disabled
      const { mkdirSync } = await import("node:fs");
      const configDir = join(tempDir, ".archgate");
      mkdirSync(configDir, { recursive: true });
      await Bun.write(
        join(configDir, "config.json"),
        JSON.stringify({
          telemetry: false,
          installId: "test-uuid-disabled",
          createdAt: "2026-01-01T00:00:00.000Z",
        })
      );

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();
        const privacyCalls = writeSpy.mock.calls.filter((c) =>
          String(c[0]).includes("anonymous usage data")
        );
        expect(privacyCalls).toHaveLength(0);
      } finally {
        writeSpy.mockRestore();
      }
    });

    test("does not print when stdout is not a TTY", async () => {
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        writable: true,
        configurable: true,
      });
      delete Bun.env.CI;
      delete process.env.ARCHGATE_TELEMETRY;

      const { showFirstRunNoticeIfNeeded, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        () => true
      );
      try {
        showFirstRunNoticeIfNeeded();
        const privacyCalls = writeSpy.mock.calls.filter((c) =>
          String(c[0]).includes("anonymous usage data")
        );
        expect(privacyCalls).toHaveLength(0);
      } finally {
        writeSpy.mockRestore();
      }
    });
  });

  describe("saveTelemetryConfigAsync", () => {
    test("swallows write errors silently", async () => {
      // loadTelemetryConfig on first run triggers saveTelemetryConfigAsync.
      // If the write fails (e.g., HOME is non-writable), it should not throw.
      const nonWritable = join(tempDir, "readonly");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(nonWritable, { recursive: true });
      process.env.HOME = nonWritable;

      // Make the directory non-writable (skip on Windows where chmod is limited)
      const { isWindows: isWin } = await import("../../src/helpers/platform");
      if (!isWin()) {
        const { chmodSync: chmod } = await import("node:fs");
        chmod(nonWritable, 0o444);
      }

      const { loadTelemetryConfig, _resetConfigCache } =
        await import("../../src/helpers/telemetry-config");
      _resetConfigCache();

      // Should not throw even when the async save fails
      expect(() => loadTelemetryConfig()).not.toThrow();

      // Wait for the async save to settle
      await Bun.sleep(200);

      // Restore permissions for cleanup
      if (!isWin()) {
        const { chmodSync: chmod } = await import("node:fs");
        chmod(nonWritable, 0o755);
      }
    });
  });
});
