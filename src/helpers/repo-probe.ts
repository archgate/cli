/**
 * repo-probe.ts — Unauthenticated API probes to determine whether a Git
 * repository is public on its host (GitHub, GitLab, Bitbucket, Azure DevOps).
 *
 * Why it's a separate module: the probe code is network-y and host-specific,
 * while the rest of `repo.ts` is local-only git inspection. Keeping them apart
 * keeps each file small and testable, and keeps the network surface out of
 * the fast path for every command (the probe is only called from
 * `archgate init`).
 *
 * Privacy rationale: the probe is the gate that decides whether a repo's
 * owner / name / remote URL ship on the `project_initialized` event. Only
 * repos that a random anonymous user of the host can already see get their
 * identity shared.
 */

import { logDebug } from "./log";
// `import type` is erased at compile time, so there's no runtime circularity
// with `repo.ts` even though `repo.ts` imports the probe's runtime bindings.
import type { RepoContext, RepoHost } from "./repo";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** One network call per repo per process, shared across call sites. */
let cachedPublicProbe: Promise<boolean | null> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe the host's unauthenticated API to determine whether the repo is
 * public. Returns:
 *   - `true`  — confirmed public on a recognised host
 *   - `false` — confirmed private / not visible to anonymous users
 *   - `null`  — couldn't determine (self-hosted, network failure, timeout,
 *               rate-limited)
 *
 * Bounded by a 3s timeout — telemetry must not slow down the CLI when the
 * network is misbehaving. Errors are swallowed; we never probe again after
 * the first call in a given process.
 */
export function isPublicRepo(
  repo: Pick<RepoContext, "host" | "owner" | "name">
): Promise<boolean | null> {
  if (cachedPublicProbe) return cachedPublicProbe;
  cachedPublicProbe = probePublic(repo).catch(() => null);
  return cachedPublicProbe;
}

/** Reset the cached probe. For testing only. */
export function _resetPublicProbeCache(): void {
  cachedPublicProbe = null;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function probePublic(
  repo: Pick<RepoContext, "host" | "owner" | "name">
): Promise<boolean | null> {
  if (!repo.host || !repo.owner || !repo.name) return null;
  const { host, owner, name } = repo as {
    host: RepoHost;
    owner: string;
    name: string;
  };
  if (host === "other") return null;

  try {
    switch (host) {
      case "github":
        return await probeGitHub(owner, name);
      case "gitlab":
        return await probeGitLab(owner, name);
      case "bitbucket":
        return await probeBitbucket(owner, name);
      case "azure-devops":
        return await probeAzureDevOps(owner, name);
    }
  } catch (err) {
    logDebug("public-repo probe failed (ignored):", String(err));
    return null;
  }
}

// ---------------------------------------------------------------------------
// HTTP (timeout-bounded)
// ---------------------------------------------------------------------------

const PROBE_TIMEOUT_MS = 3000;

async function fetchWithTimeout(url: string): Promise<Response | null> {
  try {
    return await fetch(url, {
      headers: {
        "User-Agent": "archgate-cli",
        Accept: "application/vnd.github+json, application/json;q=0.9",
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-host probes
// ---------------------------------------------------------------------------

async function probeGitHub(
  owner: string,
  name: string
): Promise<boolean | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  if (res.status === 200) {
    try {
      const data = (await res.json()) as { private?: boolean };
      return data.private === false;
    } catch {
      return null;
    }
  }
  // 404 = either private or nonexistent — anonymous callers can't see it.
  if (res.status === 404) return false;
  // 403 = rate-limited; don't treat as private.
  if (res.status === 403) return null;
  return null;
}

async function probeGitLab(
  owner: string,
  name: string
): Promise<boolean | null> {
  const projectPath = encodeURIComponent(`${owner}/${name}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  if (res.status === 200) {
    try {
      const data = (await res.json()) as { visibility?: string };
      return data.visibility === "public";
    } catch {
      return null;
    }
  }
  if (res.status === 404) return false;
  return null;
}

async function probeBitbucket(
  owner: string,
  name: string
): Promise<boolean | null> {
  const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  if (res.status === 200) {
    try {
      const data = (await res.json()) as { is_private?: boolean };
      return data.is_private === false;
    } catch {
      return null;
    }
  }
  if (res.status === 404) return false;
  return null;
}

/**
 * Azure DevOps owner is `{organization}/{project}`. We probe the project's
 * visibility endpoint — a public Azure DevOps project returns the record
 * unauthenticated, a private project responds with 401.
 *
 * Note: this doesn't try to prove the specific repository is public; Azure
 * DevOps project visibility governs repo visibility, and individual repos
 * aren't separately togglable to public within a private project.
 */
async function probeAzureDevOps(
  owner: string,
  _name: string
): Promise<boolean | null> {
  const [organization, ...projectParts] = owner.split("/");
  const project = projectParts.join("/");
  if (!organization || !project) return null;

  const url = `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects/${encodeURIComponent(project)}?api-version=7.0`;
  const res = await fetchWithTimeout(url);
  if (!res) return null;
  if (res.status === 200) {
    try {
      const data = (await res.json()) as { visibility?: string };
      return data.visibility === "public";
    } catch {
      return null;
    }
  }
  // 401 = private project (needs auth); 404 = nonexistent. Either way, the
  // repo is invisible to anonymous users — that's what matters for sharing.
  if (res.status === 401 || res.status === 404) return false;
  return null;
}
