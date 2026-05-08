/**
 * repo.ts — Detect the git repository context for telemetry enrichment.
 *
 * Every event carries:
 *   - `repo_host`: "github" | "gitlab" | "bitbucket" | "azure-devops" | "other" | null
 *   - `repo_id`: sha256 hash of the normalized remote URL, truncated to 16
 *     hex chars. Stable per repo, but non-reversible — you can count distinct
 *     repos using the CLI without learning any identity.
 *   - `repo_is_git`: whether the CWD is a git working tree at all
 *   - `git_default_branch`: best-effort "main" / "master" / etc.
 *
 * The raw remote URL and parsed owner/name are *only* sent on the one-time
 * `project_initialized` event, and *only* when the repository is confirmed
 * public via the host's unauthenticated API. See `repo-probe.ts` for that
 * logic; this module stays local-only (git + URL parsing).
 *
 * Cached per-process because the git remote and default branch are effectively
 * immutable over the lifetime of a single CLI invocation.
 */

import { createHash } from "node:crypto";

import { logDebug } from "./log";
import { _resetPublicProbeCache, isPublicRepo } from "./repo-probe";

// Re-export the public-visibility probe so commands / telemetry can import
// everything repo-related from one place.
export { isPublicRepo };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepoHost =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "azure-devops"
  | "other";

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
   * user consent (the `project_initialized` event on a confirmed-public
   * repo) can include it; NEVER sent with common properties.
   */
  remoteUrl: string | null;
  /**
   * Best-effort default branch name (`main`, `master`, ...). May be null if
   * the repo has no remote HEAD configured.
   */
  defaultBranch: string | null;
}

export interface ParsedRemote {
  host: RepoHost | null;
  owner: string | null;
  name: string | null;
  /** Canonical form used for hashing — lowercase host, `owner/name`, no suffix. */
  normalized: string | null;
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

  // Fire all four git probes concurrently. On Windows each subprocess costs
  // ~25ms, so running them in parallel instead of gating on
  // `rev-parse --is-inside-work-tree` saves one serial spawn on the happy
  // path. In a non-git directory the extras exit non-zero quickly and their
  // results are discarded.
  const [isGit, remoteUrl, symRef, currentBranch] = await Promise.all([
    runGitCheck(["rev-parse", "--is-inside-work-tree"], cwd),
    runGitCapture(["config", "--get", "remote.origin.url"], cwd),
    runGitCapture(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd),
    runGitCapture(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
  ]);

  if (!isGit) {
    cached = emptyContext(false);
    return cached;
  }

  const defaultBranch = pickDefaultBranch(symRef, currentBranch);

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
 * Pick the most informative default-branch signal: prefer the remote HEAD
 * symbolic ref (e.g. `origin/main` → `main`), fall back to the currently
 * checked-out branch.
 */
function pickDefaultBranch(
  symRef: string | null,
  currentBranch: string | null
): string | null {
  if (symRef) {
    const slash = symRef.indexOf("/");
    return slash >= 0 ? symRef.slice(slash + 1) : symRef;
  }
  return currentBranch;
}

/**
 * Should the CLI include owner / name / full remote URL in the
 * `project_initialized` event?
 *
 * Rule: share iff the repository is confirmed public on a recognised host.
 * Private, unknown, and self-hosted repos always return false.
 *
 * There's no identity-specific opt-out knob — if a user doesn't want *any*
 * telemetry, including the identity event, they disable telemetry itself
 * (`ARCHGATE_TELEMETRY=0` or `archgate telemetry disable`). The whole event
 * is then suppressed upstream. Adding a separate identity opt-out would be
 * redundant and asymmetric with how every other field is gated.
 */
export function shouldShareRepoIdentity(repoPublic: boolean | null): boolean {
  return repoPublic === true;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a git remote URL into host + owner + name.
 *
 * Handles:
 *   - GitHub / GitLab / Bitbucket HTTPS and SCP-style SSH URLs
 *   - GitLab subgroups (`gitlab.com/foo/sub/bar` → owner=`foo/sub`, name=`bar`)
 *   - Azure DevOps (`dev.azure.com`) HTTPS and SSH URLs, including the
 *     `_git` path infix and the `v3` SSH prefix
 *   - Legacy Azure DevOps `{org}.visualstudio.com` URLs where the org is
 *     encoded in the subdomain rather than the path
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

  const lowerHost = host.toLowerCase();
  const classified = classifyHost(lowerHost);

  // Strip trailing .git, .git/, or /
  path = path.replace(/\.git\/?$/, "").replace(/\/$/, "");
  let segments = path.split("/").filter(Boolean);

  // Azure DevOps URL quirks:
  //   - HTTPS  (modern):  /{org}/{project}/_git/{repo}
  //   - HTTPS  (legacy):  /{project}/_git/{repo} on {org}.visualstudio.com
  //   - SSH    (v3 path): v3/{org}/{project}/{repo}
  // Strip the structural markers (`_git`, `v3`) and, for legacy URLs, pull
  // the org out of the subdomain.
  if (classified === "azure-devops") {
    segments = segments.filter((s) => s !== "_git" && s !== "v3");

    const vsHostMatch = lowerHost.match(/^([^.]+)\.visualstudio\.com$/);
    if (vsHostMatch && !segments.some((s) => s === vsHostMatch[1])) {
      segments = [vsHostMatch[1], ...segments];
    }
  }

  if (segments.length < 2) {
    return { host: classified, owner: null, name: null, normalized: null };
  }

  const name = segments.at(-1)!;
  const owner = segments.slice(0, -1).join("/");

  // Normalize the host for hashing. Azure DevOps URLs come in three shapes
  // (HTTPS `dev.azure.com`, SSH `ssh.dev.azure.com`, legacy
  // `{org}.visualstudio.com`) — all three should hash to the same repo_id,
  // so collapse them onto a single canonical host string.
  const normalizedHost =
    classified === "azure-devops" ? "dev.azure.com" : lowerHost;

  return {
    host: classified,
    owner,
    name,
    normalized: `${normalizedHost}/${owner.toLowerCase()}/${name.toLowerCase()}`,
  };
}

function classifyHost(hostname: string): RepoHost {
  const h = hostname.toLowerCase();
  if (h === "github.com" || h.endsWith(".github.com")) return "github";
  if (h === "gitlab.com" || h.endsWith(".gitlab.com")) return "gitlab";
  if (h === "bitbucket.org" || h.endsWith(".bitbucket.org")) return "bitbucket";
  if (
    h === "dev.azure.com" ||
    h === "ssh.dev.azure.com" ||
    h.endsWith(".visualstudio.com")
  ) {
    return "azure-devops";
  }
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

/**
 * Reset the cached context AND the public-probe cache. For testing only —
 * most tests only need one or the other, but resetting both here keeps the
 * test setup boilerplate small.
 */
export function _resetRepoContextCache(): void {
  cached = null;
  _resetPublicProbeCache();
}
