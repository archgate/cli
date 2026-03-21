import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import { isAgentContext, formatJSON } from "../../src/helpers/output";

describe("output helpers", () => {
  let originalCI: string | undefined;

  beforeEach(() => {
    originalCI = process.env.CI;
  });

  afterEach(() => {
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
  });

  describe("isAgentContext", () => {
    // Note: bunfig.toml sets CI=1 for test runs. Tests override CI as needed.

    test("returns false when CI env is set", () => {
      process.env.CI = "true";
      expect(isAgentContext()).toBe(false);
    });

    test("returns false when stdout is a TTY", () => {
      // Even with CI unset, if stdout were a TTY it would return false.
      // In the test runner stdout is piped, so we can only test the CI path.
      process.env.CI = "1";
      expect(isAgentContext()).toBe(false);
    });

    test("returns true when no CI env and stdout is piped", () => {
      // In the test runner, stdout is piped (isTTY is undefined).
      // Removing CI makes isAgentContext() return true.
      delete process.env.CI;
      expect(isAgentContext()).toBe(true);
    });
  });

  describe("formatJSON", () => {
    const data = { a: 1, b: [2, 3] };

    test("pretty-prints with 2-space indent when forcePretty is true", () => {
      const result = formatJSON(data, true);
      expect(result).toBe(JSON.stringify(data, null, 2));
      expect(result).toContain("\n");
    });

    test("compact output when forcePretty is false", () => {
      const result = formatJSON(data, false);
      expect(result).toBe(JSON.stringify(data));
      expect(result).not.toContain("\n");
    });

    test("forcePretty overrides agent context detection", () => {
      delete process.env.CI;
      // Even if isAgentContext() would return true, forcePretty wins
      const pretty = formatJSON(data, true);
      expect(pretty).toContain("\n");

      const compact = formatJSON(data, false);
      expect(compact).not.toContain("\n");
    });

    test("auto-detects pretty when CI is set", () => {
      process.env.CI = "true";
      const result = formatJSON(data);
      expect(result).toBe(JSON.stringify(data, null, 2));
    });

    test("auto-detects compact when no CI and piped stdout", () => {
      delete process.env.CI;
      const result = formatJSON(data);
      expect(result).toBe(JSON.stringify(data));
      expect(result).not.toContain("\n");
    });
  });
});
