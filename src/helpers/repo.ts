/**
 * repo.ts — Detect the git repository context for telemetry enrichment.
 *
 * Every event carries:
 *   - `repo_host`: "github" | "gitlab" | "bitbucket" | "other" | null
 *   - `repo_id`: sha256 hash of the normalized remote URL, truncated to 16
 *     hex chars. Stable per repo, but non-reversible — you can count distinct
 *     repos using the CLI without learning any identity.
 *   - `repo_is_git`: whether the CWD is a git working tree at all
 *   - `git_default_branch`: best-effort "main" / "master" / etc.
 *
 * The raw remote URL and parsed owner/name are *not* sent by default — they
 * only reach PostHog via the opt-in `project_initialized` event when the user
 * sets `ARCHGATE_SHARE_REPO_IDENTITY=1` or passes `--share-repo-identity`
 * to `archgate init`. See {@link shouldShareRepoIdentity}.
 *
 * Cached per-process because the git remote and default branch are effectively
 * immutable over the lifetime of a single CLI invocation.
 */

import { createHash } from "node:crypto";

import { logDebug } from "./log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepoHost = "github" | "gitlab" | "bitbucket" | "other";

export interface RepoContext {
  /** True if the CWD sits inside a git working tree. */
  isGit: boolean;
  /** Detected hosting provider, derived from the remote URL. */
  host: RepoHost | null;
  /** Parsed `owner` segment of the remote URL (e.g., `archgate`). */
  owner: string | null;
  /** Parsed repo `name` segment of the remote URL (e.g., `cli`). */
  name: string | null;
  /**
   * Stable identifier derived from `sha256(normalizedRemoteUrl)`, truncated
   * to 16 hex chars. Safe to send in every event — lets us count distinct
   * repos without learning names.
   */
  repoId: string | null;
  /**
   * Raw `remote.origin.url` string. Present here so callers with explicit
   * user consent (the opt-in `project_initialized` event) can include it;
   * NEVER sent with common properties. The hashed `repoId` is the field
   * used for passive per-repo analytics.
   */
  remoteUrl: string | null;
  /**
   * Best-effort default branch name (`main`, `master`, ...). May be null if
   * the repo has no remote HEAD configured.
   */
  defaultBranch: string | null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: RepoContext | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the repo context for the current working directory.
 *
 * Returns an all-null / `isGit=false` shape if git is missing, the CWD is not
 * a repo, or the commands fail. Never throws — telemetry must not break the
 * command that spawned it.
 */
export async function getRepoContext(): Promise<RepoContext> {
  if (cached) return cached;

  const cwd = process.cwd();
  const isGit = await runGitCheck(["rev-parse", "--is-inside-work-tree"], cwd);
  if (!isGit) {
    cached = emptyContext(false);
    return cached;
  }

  const remoteUrl = await runGitCapture(
    ["config", "--get", "remote.origin.url"],
    cwd
  );
  const defaultBranch = await resolveDefaultBranch(cwd);

  if (!remoteUrl) {
    cached = {
      isGit: true,
      host: null,
      owner: null,
      name: null,
      repoId: null,
      remoteUrl: null,
      defaultBranch,
    };
    return cached;
  }

  const parsed = parseRemoteUrl(remoteUrl);
  cached = {
    isGit: true,
    host: parsed.host,
    owner: parsed.owner,
    name: parsed.name,
    repoId: parsed.normalized ? hashRepoId(parsed.normalized) : null,
    remoteUrl,
    defaultBranch,
  };
  return cached;
}

/**
 * Should the CLI include owner / name / full remote URL in the opt-in
 * `project_initialized` event? Opt-in via env var or CLI flag.
 */
export function shouldShareRepoIdentity(flag?: boolean): boolean {
  if (flag) return true;
  const env = Bun.env.ARCHGATE_SHARE_REPO_IDENTITY;
  if (env === undefined) return false;
  return ["1", "true", "yes", "on"].includes(env.toLowerCase());
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedRemote {
  host: RepoHost | null;
  owner: string | null;
  name: string | null;
  /** Canonical form used for hashing — lowercase host, `owner/name`, no suffix. */
  normalized: string | null;
}

/**
 * Parse a git remote URL into host + owner + name.
 *
 * Handles:
 *   - `https://github.com/foo/bar.git`
 *   - `git@github.com:foo/bar.git`
 *   - `ssh://git@gitlab.com/foo/bar`
 *   - GitLab subgroups (`gitlab.com/foo/sub/bar` → owner=`foo/sub`, name=`bar`)
 */
export function parseRemoteUrl(raw: string): ParsedRemote {
  const trimmed = raw.trim();
  if (!trimmed)
    return { host: null, owner: null, name: null, normalized: null };

  let host: string | null = null;
  let path: string | null = null;

  // SCP-like: git@github.com:foo/bar.git
  const scpMatch = trimmed.match(/^[^@\s]+@([^:]+):(.+)$/);
  if (scpMatch) {
    host = scpMatch[1];
    path = scpMatch[2];
  } else {
    try {
      const url = new URL(trimmed);
      host = url.hostname;
      path = url.pathname.replace(/^\//, "");
    } catch {
      return { host: null, owner: null, name: null, normalized: null };
    }
  }

  if (!host || !path) {
    return { host: null, owner: null, name: null, normalized: null };
  }

  // Strip trailing .git, .git/, or /
  path = path.replace(/\.git\/?$/, "").replace(/\/$/, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) {
    return {
      host: classifyHost(host),
      owner: null,
      name: null,
      normalized: null,
    };
  }

  const name = segments.at(-1)!;
  const owner = segments.slice(0, -1).join("/");
  const lowerHost = host.toLowerCase();

  return {
    host: classifyHost(lowerHost),
    owner,
    name,
    normalized: `${lowerHost}/${owner.toLowerCase()}/${name.toLowerCase()}`,
  };
}

function classifyHost(hostname: string): RepoHost {
  const h = hostname.toLowerCase();
  if (h === "github.com" || h.endsWith(".github.com")) return "github";
  if (h === "gitlab.com" || h.endsWith(".gitlab.com")) return "gitlab";
  if (h === "bitbucket.org" || h.endsWith(".bitbucket.org")) return "bitbucket";
  return "other";
}

export function hashRepoId(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Git execution (safe, silent)
// ---------------------------------------------------------------------------

async function runGitCapture(
  args: string[],
  cwd: string
): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch (err) {
    logDebug("git command failed (ignored):", args.join(" "), String(err));
    return null;
  }
}

async function runGitCheck(args: string[], cwd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Drain stdout so Bun doesn't leak the handle
    await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

async function resolveDefaultBranch(cwd: string): Promise<string | null> {
  // Prefer the remote HEAD symbolic ref (e.g., `origin/main`)
  const symRef = await runGitCapture(
    ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    cwd
  );
  if (symRef) {
    const slash = symRef.indexOf("/");
    return slash >= 0 ? symRef.slice(slash + 1) : symRef;
  }
  // Fallback: whatever branch is currently checked out. Not strictly the
  // "default" branch, but better than null for a single-user local repo.
  return runGitCapture(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function emptyContext(isGit: boolean): RepoContext {
  return {
    isGit,
    host: null,
    owner: null,
    name: null,
    repoId: null,
    remoteUrl: null,
    defaultBranch: null,
  };
}

// ---------------------------------------------------------------------------
// Testing helpers
// ---------------------------------------------------------------------------

/** Reset the cached context. For testing only. */
export function _resetRepoContextCache(): void {
  cached = null;
}
