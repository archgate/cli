import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("telemetry-notice", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-notice-test-"));
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

    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
  });

  test("creates marker file after showing notice", async () => {
    const { showTelemetryNotice } =
      await import("../../src/helpers/telemetry-notice");

    showTelemetryNotice();

    // Wait for async marker file write
    await Bun.sleep(200);

    const markerPath = join(tempDir, ".archgate", "telemetry-notice-shown");
    expect(existsSync(markerPath)).toBe(true);
  });

  test("does not show notice when telemetry is disabled", async () => {
    process.env.ARCHGATE_TELEMETRY = "0";

    const { showTelemetryNotice } =
      await import("../../src/helpers/telemetry-notice");

    showTelemetryNotice();
    await Bun.sleep(200);

    const markerPath = join(tempDir, ".archgate", "telemetry-notice-shown");
    expect(existsSync(markerPath)).toBe(false);
  });

  test("does not show notice when marker file exists", async () => {
    const { mkdirSync } = await import("node:fs");
    const archgateDir = join(tempDir, ".archgate");
    mkdirSync(archgateDir, { recursive: true });
    await Bun.write(
      join(archgateDir, "telemetry-notice-shown"),
      "already-shown"
    );

    const { showTelemetryNotice } =
      await import("../../src/helpers/telemetry-notice");

    // Should be a no-op (no error, no duplicate marker write)
    showTelemetryNotice();
  });
});
