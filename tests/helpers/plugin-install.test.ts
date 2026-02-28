import { describe, expect, test } from "bun:test";
import {
  buildMarketplaceUrl,
  isClaudeCliAvailable,
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

  describe("isClaudeCliAvailable", () => {
    test("returns a boolean", async () => {
      const result = await isClaudeCliAvailable();
      expect(typeof result).toBe("boolean");
    });
  });
});
