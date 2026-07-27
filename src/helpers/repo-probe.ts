// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * repo-probe.ts — Unauthenticated API probes deciding whether a repo is
 * public on its host (GitHub, GitLab, Bitbucket, Azure DevOps). This is the
 * privacy gate for sharing owner/name/URL on `project_initialized`: only
 * repos an anonymous user can already see get their identity shared. Called
 * only from `archgate init`; `repo.ts` stays local-only.
 */

import { z } from "zod";

import { logDebug } from "./log";
// `import type` is erased at compile time, so there's no runtime circularity
// with `repo.ts` even though `repo.ts` imports the probe's runtime bindings.
import type { RepoContext } from "./repo";

// Zod schemas for external API responses
const GitHubRepoSchema = z.object({ private: z.boolean().optional() });
const GitLabProjectSchema = z.object({ visibility: z.string().optional() });
const BitbucketRepoSchema = z.object({ is_private: z.boolean().optional() });
const AzureProjectSchema = z.object({ visibility: z.string().optional() });

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** One network call per repo per process, shared across call sites. */
let cachedPublicProbe: Promise<boolean | null> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Probe the host's unauthenticated API for repo visibility: `true` =
 * confirmed public, `false` = private/not anonymously visible, `null` =
 * undetermined (self-hosted, network failure, timeout, rate-limited).
 * Bounded by a 3s timeout with errors swallowed — telemetry must not slow
 * the CLI down; probes once per process.
 */
export async function isPublicRepo(
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
  if (
    !repo.host ||
    repo.owner === null ||
    repo.owner === "" ||
    repo.name === null ||
    repo.name === ""
  )
    return null;
  const { host, owner, name } = repo;
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
      default:
        return null;
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
      const data = GitHubRepoSchema.parse(await res.json());
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
      const data = GitLabProjectSchema.parse(await res.json());
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
      const data = BitbucketRepoSchema.parse(await res.json());
      return data.is_private === false;
    } catch {
      return null;
    }
  }
  if (res.status === 404) return false;
  return null;
}

/**
 * Azure DevOps owner is `{organization}/{project}`; the project visibility
 * endpoint answers unauthenticated for public projects and 401 for private.
 * Project visibility governs repo visibility, so the specific repository
 * needs no separate check.
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
      const data = AzureProjectSchema.parse(await res.json());
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
