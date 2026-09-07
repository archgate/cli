// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * user-agent.ts — one versioned identity for every outbound request.
 *
 * Services attribute each request to the installed CLI version through this
 * header. `fetchWithUserAgent` is the only `fetch` production code may call
 * (`http/no-bare-fetch` enforces it); `gitUserAgentEnv` covers git
 * subprocesses via `GIT_HTTP_USER_AGENT`.
 */
import packageJson from "../../package.json";
import { getPlatformInfo } from "./platform";

/** `archgate-cli/<version> (<platform>; <arch>)`, e.g. `archgate-cli/0.57.0 (linux; x64)`. */
export const USER_AGENT = `archgate-cli/${packageJson.version} (${getPlatformInfo().runtime}; ${process.arch})`;

/**
 * `fetch` with the CLI's `User-Agent` set, unless the caller provided one.
 *
 * Every other field of `init` passes through untouched, so timeouts,
 * redirect policy and auth headers are still decided at the call site.
 */
export async function fetchWithUserAgent(
  url: string | URL,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("User-Agent")) headers.set("User-Agent", USER_AGENT);
  // oxlint-disable-next-line http/no-bare-fetch -- the one sanctioned call
  return fetch(url, { ...init, headers });
}

/**
 * Environment for a subprocess that may run git over HTTP.
 *
 * Git reads `GIT_HTTP_USER_AGENT` from its environment, and the editor CLIs
 * the installers spawn pass theirs down, so this reaches a grandchild clone.
 * Passed explicitly: `Bun.spawn` snapshots the environment at startup.
 */
export function gitUserAgentEnv(
  base: Record<string, string | undefined> = Bun.env
): Record<string, string | undefined> {
  return { ...base, GIT_HTTP_USER_AGENT: USER_AGENT };
}
