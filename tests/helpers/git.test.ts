import { describe, expect, test } from "bun:test";

import { installGit } from "../../src/helpers/git";

describe("installGit", () => {
  test("does not throw when git is available", async () => {
    // git is expected to be available in the test environment
    await expect(installGit()).resolves.toBeUndefined();
  });
});
