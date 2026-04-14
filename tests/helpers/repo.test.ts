import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getRepoContext,
  hashRepoId,
  parseRemoteUrl,
  shouldShareRepoIdentity,
  _resetRepoContextCache,
} from "../../src/helpers/repo";

describe("repo helper", () => {
  let originalEnv: string | undefined;
  let originalCwd: string;

  beforeEach(() => {
    originalEnv = process.env.ARCHGATE_SHARE_REPO_IDENTITY;
    originalCwd = process.cwd();
    delete process.env.ARCHGATE_SHARE_REPO_IDENTITY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ARCHGATE_SHARE_REPO_IDENTITY;
    } else {
      process.env.ARCHGATE_SHARE_REPO_IDENTITY = originalEnv;
    }
    process.chdir(originalCwd);
    _resetRepoContextCache();
  });

  describe("parseRemoteUrl", () => {
    test("parses HTTPS GitHub remotes", () => {
      const parsed = parseRemoteUrl("https://github.com/foo/bar.git");
      expect(parsed.host).toBe("github");
      expect(parsed.owner).toBe("foo");
      expect(parsed.name).toBe("bar");
      expect(parsed.normalized).toBe("github.com/foo/bar");
    });

    test("parses SCP-style SSH GitHub remotes", () => {
      const parsed = parseRemoteUrl("git@github.com:foo/Bar.git");
      expect(parsed.host).toBe("github");
      expect(parsed.owner).toBe("foo");
      expect(parsed.name).toBe("Bar");
      // Normalization lowercases so the hash is stable regardless of URL style
      expect(parsed.normalized).toBe("github.com/foo/bar");
    });

    test("HTTPS and SCP-style URLs for the same repo normalize identically", () => {
      const https = parseRemoteUrl("https://github.com/foo/Bar.git");
      const scp = parseRemoteUrl("git@github.com:foo/Bar.git");
      expect(https.normalized).toBe(scp.normalized);
    });

    test("classifies non-GitHub hosts", () => {
      expect(parseRemoteUrl("git@gitlab.com:foo/bar.git").host).toBe("gitlab");
      expect(parseRemoteUrl("https://bitbucket.org/foo/bar").host).toBe(
        "bitbucket"
      );
      expect(
        parseRemoteUrl("https://self-hosted.example.com/foo/bar").host
      ).toBe("other");
    });

    test("handles GitLab subgroups (multi-segment owner)", () => {
      const parsed = parseRemoteUrl("https://gitlab.com/foo/sub/bar.git");
      expect(parsed.owner).toBe("foo/sub");
      expect(parsed.name).toBe("bar");
    });

    test("returns all-null on garbage input", () => {
      const parsed = parseRemoteUrl("not a url");
      expect(parsed.host).toBeNull();
      expect(parsed.owner).toBeNull();
      expect(parsed.name).toBeNull();
    });
  });

  describe("hashRepoId", () => {
    test("produces a stable 16-char hex id for a given normalized url", () => {
      const id = hashRepoId("github.com/foo/bar");
      expect(id).toMatch(/^[0-9a-f]{16}$/);
      expect(hashRepoId("github.com/foo/bar")).toBe(id);
    });

    test("differs across different repos", () => {
      expect(hashRepoId("github.com/foo/bar")).not.toBe(
        hashRepoId("github.com/foo/baz")
      );
    });
  });

  describe("shouldShareRepoIdentity", () => {
    test("defaults to false", () => {
      expect(shouldShareRepoIdentity()).toBe(false);
    });

    test("honors the explicit CLI flag", () => {
      expect(shouldShareRepoIdentity(true)).toBe(true);
    });

    test("honors the env override", () => {
      process.env.ARCHGATE_SHARE_REPO_IDENTITY = "1";
      expect(shouldShareRepoIdentity()).toBe(true);

      process.env.ARCHGATE_SHARE_REPO_IDENTITY = "yes";
      expect(shouldShareRepoIdentity()).toBe(true);

      process.env.ARCHGATE_SHARE_REPO_IDENTITY = "0";
      expect(shouldShareRepoIdentity()).toBe(false);
    });
  });

  describe("getRepoContext", () => {
    test("returns isGit=false for a non-git directory", async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "archgate-repo-test-"));
      try {
        process.chdir(tempDir);
        _resetRepoContextCache();
        const ctx = await getRepoContext();
        expect(ctx.isGit).toBe(false);
        expect(ctx.repoId).toBeNull();
        expect(ctx.host).toBeNull();
      } finally {
        // Must leave the temp dir before removing it — Windows refuses to
        // delete a directory that is a process's CWD.
        process.chdir(originalCwd);
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test("populates host/repoId when the CWD is a git repo with a remote", async () => {
      // Using the CLI's own repo — it has a github.com/archgate/cli remote.
      _resetRepoContextCache();
      const ctx = await getRepoContext();
      expect(ctx.isGit).toBe(true);
      if (ctx.host) {
        expect(ctx.repoId).toMatch(/^[0-9a-f]{16}$/);
      }
    });
  });
});
