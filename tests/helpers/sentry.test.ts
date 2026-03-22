import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Type-safe fetch mock — Bun's fetch type includes `preconnect`. */
function mockFetch(handler: () => Response) {
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
}

describe("sentry", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let originalTelemetryEnv: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-sentry-test-"));
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

    const { _resetSentry } = await import("../../src/helpers/sentry");
    _resetSentry();
    const { _resetConfigCache } =
      await import("../../src/helpers/telemetry-config");
    _resetConfigCache();
  });

  describe("initSentry", () => {
    test("initializes when telemetry is enabled", async () => {
      mockFetch(() => new Response("OK"));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      initSentry();

      // captureException should attempt to send (fire-and-forget)
      captureException(new Error("test error"), { command: "check" });

      // Give async fire-and-forget time to execute
      await Bun.sleep(100);

      // The fetch would have been called if the DSN was valid.
      // With placeholder DSN, initSentry parses it and initialized=true,
      // so captureException fires the async send.
      expect(fetchMock).toHaveBeenCalled();
    });

    test("does not initialize when telemetry is disabled", async () => {
      process.env.ARCHGATE_TELEMETRY = "0";
      mockFetch(() => new Response("OK"));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      initSentry();
      captureException(new Error("should not send"));

      await Bun.sleep(100);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("captureException", () => {
    test("silently ignores fetch failures", async () => {
      mockFetch(() => {
        throw new Error("Network error");
      });

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      initSentry();
      // Should not throw
      captureException(new Error("test"), { command: "check" });
      await Bun.sleep(100);
    });

    test("handles non-Error values", async () => {
      mockFetch(() => new Response("OK"));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { initSentry, captureException } =
        await import("../../src/helpers/sentry");

      initSentry();
      captureException("string error", { command: "init" });
      await Bun.sleep(100);

      expect(fetchMock).toHaveBeenCalled();
    });

    test("is a no-op when not initialized", async () => {
      mockFetch(() => new Response("OK"));
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;

      const { captureException } = await import("../../src/helpers/sentry");

      captureException(new Error("should not send"));
      await Bun.sleep(100);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
