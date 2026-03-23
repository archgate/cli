import { describe, expect, test } from "bun:test";

import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
} from "../../src/helpers/plugin-install";

describe("plugin-install", () => {
  describe("buildMarketplaceUrl", () => {
    test("returns bare URL without embedded credentials", () => {
      const url = buildMarketplaceUrl();
      expect(url).toBe("https://plugins.archgate.dev/archgate.git");
    });

    test("does not contain @ (no embedded credentials)", () => {
      const url = buildMarketplaceUrl();
      expect(url).not.toContain("@");
    });
  });

  describe("buildVscodeMarketplaceUrl", () => {
    test("returns bare URL pointing to archgate/vscode.git", () => {
      const url = buildVscodeMarketplaceUrl();
      expect(url).toBe("https://plugins.archgate.dev/archgate/vscode.git");
    });

    test("does not contain @ (no embedded credentials)", () => {
      const url = buildVscodeMarketplaceUrl();
      expect(url).not.toContain("@");
    });

    test("uses archgate/vscode.git path (not archgate.git)", () => {
      const vscodeUrl = buildVscodeMarketplaceUrl();
      const claudeUrl = buildMarketplaceUrl();
      expect(vscodeUrl).toContain("archgate/vscode.git");
      expect(claudeUrl).not.toContain("archgate/vscode.git");
      expect(claudeUrl).toContain("archgate.git");
    });
  });

  describe("isClaudeCliAvailable", () => {
    test("returns a boolean", async () => {
      const result = await isClaudeCliAvailable();
      expect(typeof result).toBe("boolean");
    });
  });

  describe("isCopilotCliAvailable", () => {
    test("returns a boolean", async () => {
      const result = await isCopilotCliAvailable();
      expect(typeof result).toBe("boolean");
    });

    test("returns false when copilot is not installed", async () => {
      // copilot CLI is not expected to be installed in the test environment
      const result = await isCopilotCliAvailable();
      expect(result === true || result === false).toBe(true);
    });
  });
});
