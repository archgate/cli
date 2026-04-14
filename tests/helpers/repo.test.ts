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
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
  });

  afterEach(() => {
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

    test("parses Azure DevOps HTTPS URLs (modern dev.azure.com)", () => {
      const parsed = parseRemoteUrl(
        "https://dev.azure.com/myorg/myproject/_git/myrepo"
      );
      expect(parsed.host).toBe("azure-devops");
      // owner encodes both organization and project
      expect(parsed.owner).toBe("myorg/myproject");
      expect(parsed.name).toBe("myrepo");
      expect(parsed.normalized).toBe("dev.azure.com/myorg/myproject/myrepo");
    });

    test("parses Azure DevOps SSH URLs (ssh.dev.azure.com:v3/...)", () => {
      const parsed = parseRemoteUrl(
        "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo"
      );
      expect(parsed.host).toBe("azure-devops");
      expect(parsed.owner).toBe("myorg/myproject");
      expect(parsed.name).toBe("myrepo");
    });

    test("parses legacy Azure DevOps visualstudio.com URLs", () => {
      const parsed = parseRemoteUrl(
        "https://myorg.visualstudio.com/myproject/_git/myrepo"
      );
      expect(parsed.host).toBe("azure-devops");
      expect(parsed.owner).toBe("myorg/myproject");
      expect(parsed.name).toBe("myrepo");
      // Legacy host normalises to dev.azure.com so the same repo via both
      // URL shapes produces the same repo_id.
      expect(parsed.normalized).toBe("dev.azure.com/myorg/myproject/myrepo");
    });

    test("Azure DevOps HTTPS, SSH, and visualstudio.com hash to the same repo_id", () => {
      const https = parseRemoteUrl(
        "https://dev.azure.com/myorg/myproject/_git/myrepo"
      );
      const ssh = parseRemoteUrl(
        "git@ssh.dev.azure.com:v3/myorg/myproject/myrepo"
      );
      const vs = parseRemoteUrl(
        "https://myorg.visualstudio.com/myproject/_git/myrepo"
      );
      expect(https.normalized).toBe(ssh.normalized);
      expect(ssh.normalized).toBe(vs.normalized);
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
    test("shares identity for confirmed-public repos", () => {
      expect(shouldShareRepoIdentity(true)).toBe(true);
    });

    test("does NOT share for private repos", () => {
      expect(shouldShareRepoIdentity(false)).toBe(false);
    });

    test("does NOT share when public status is unknown (self-hosted/error/rate-limited)", () => {
      // `null` is the probe's "couldn't determine" signal — we must never
      // fall through to sharing on a "maybe". Users who want zero events
      // disable telemetry itself; there's no identity-specific opt-out.
      expect(shouldShareRepoIdentity(null)).toBe(false);
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
