import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    process.env.HOME = originalHome;
    if (originalTelemetryEnv === undefined) {
      delete process.env.ARCHGATE_TELEMETRY;
    } else {
      process.env.ARCHGATE_TELEMETRY = originalTelemetryEnv;
    }
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
});
