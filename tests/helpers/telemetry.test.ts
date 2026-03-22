import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect`. */
function mockFetch(handler: () => Response) {
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("telemetry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;
  const originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
    mock.restore();

    const { _resetTelemetry } = await import("../../src/helpers/telemetry");
    _resetTelemetry();
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
  });

  describe("initTelemetry", () => {
    test("initializes when telemetry is enabled", async () => {
      const { initTelemetry, trackEvent, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackEvent("test_event", { key: "value" });

      const buffer = _getEventBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].event).toBe("test_event");
    });

    test("skips init when telemetry is disabled via env", async () => {
      process.env.ARCHGATE_TELEMETRY = "0";

      const { initTelemetry, trackEvent, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackEvent("test_event");

      expect(_getEventBuffer()).toHaveLength(0);
    });
  });

  describe("trackEvent", () => {
    test("buffers events with common properties", async () => {
      const { initTelemetry, trackEvent, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackEvent("command_executed", { command: "check" });

      const buffer = _getEventBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].properties).toMatchObject({
        $lib: "archgate-cli",
        os: process.platform,
        arch: process.arch,
        command: "check",
        $ip: null,
      });
      expect(buffer[0].timestamp).toBeTruthy();
    });

    test("is a no-op when not initialized", async () => {
      const { trackEvent, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      trackEvent("should_not_buffer");
      expect(_getEventBuffer()).toHaveLength(0);
    });
  });

  describe("trackCommand", () => {
    test("buffers a command_executed event", async () => {
      const { initTelemetry, trackCommand, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackCommand("adr create", { json: true });

      const buffer = _getEventBuffer();
      expect(buffer).toHaveLength(1);
      expect(buffer[0].event).toBe("command_executed");
      expect(buffer[0].properties.command).toBe("adr create");
      expect(buffer[0].properties.json).toBe(true);
    });
  });

  describe("flushTelemetry", () => {
    test("sends buffered events to PostHog and clears buffer", async () => {
      mockFetch(() => new Response("OK", { status: 200 }));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { initTelemetry, trackEvent, flushTelemetry, _getEventBuffer } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackEvent("test_event_1");
      trackEvent("test_event_2");

      await flushTelemetry();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(_getEventBuffer()).toHaveLength(0);
    });

    test("is a no-op when buffer is empty", async () => {
      mockFetch(() => new Response("OK"));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { initTelemetry, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      await flushTelemetry();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("silently ignores fetch failures", async () => {
      mockFetch(() => {
        throw new Error("Network error");
      });

      const { initTelemetry, trackEvent, flushTelemetry } =
        await import("../../src/helpers/telemetry");

      initTelemetry();
      trackEvent("test_event");

      // Should not throw
      await flushTelemetry();
    });
  });
});
