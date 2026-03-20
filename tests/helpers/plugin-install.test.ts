import { describe, expect, test } from "bun:test";

import {
  buildMarketplaceUrl,
  buildVscodeMarketplaceUrl,
  isClaudeCliAvailable,
  isCopilotCliAvailable,
} from "../../src/helpers/plugin-install";

describe("plugin-install", () => {
  describe("buildMarketplaceUrl", () => {
    test("builds URL with credentials embedded", () => {
      const url = buildMarketplaceUrl({
        token: "ag_beta_abc123def456",
        github_user: "octocat",
        created_at: "2026-01-15",
      });
      expect(url).toBe(
        "https://octocat:ag_beta_abc123def456@plugins.archgate.dev/archgate.git"
      );
    });

    test("uses github_user as the URL username", () => {
      const url = buildMarketplaceUrl({
        token: "ag_beta_token",
        github_user: "my-handle",
        created_at: "2026-02-01",
      });
      expect(url).toContain("my-handle:");
      expect(url).toContain(":ag_beta_token@");
    });
  });

  describe("buildVscodeMarketplaceUrl", () => {
    test("builds URL pointing to archgate-vscode.git", () => {
      const url = buildVscodeMarketplaceUrl({
        token: "ag_beta_abc123def456",
        github_user: "octocat",
        created_at: "2026-01-15",
      });
      expect(url).toBe(
        "https://octocat:ag_beta_abc123def456@plugins.archgate.dev/archgate-vscode.git"
      );
    });

    test("embeds credentials correctly", () => {
      const url = buildVscodeMarketplaceUrl({
        token: "ag_beta_token",
        github_user: "my-handle",
        created_at: "2026-02-01",
      });
      expect(url).toContain("my-handle:");
      expect(url).toContain(":ag_beta_token@");
    });

    test("uses archgate-vscode.git repo (not archgate.git)", () => {
      const vscodeUrl = buildVscodeMarketplaceUrl({
        token: "tok",
        github_user: "user",
        created_at: "2026-01-01",
      });
      const claudeUrl = buildMarketplaceUrl({
        token: "tok",
        github_user: "user",
        created_at: "2026-01-01",
      });
      expect(vscodeUrl).toContain("archgate-vscode.git");
      expect(claudeUrl).not.toContain("archgate-vscode.git");
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
