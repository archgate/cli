// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Secure credential storage in the OS credential manager (macOS Keychain,
 * Windows Credential Manager, libsecret) via `git credential
 * approve/fill/reject` — nothing is written to disk. In the protocol,
 * `username` carries the GitHub username and `password` the plugin token.
 *
 * @see https://git-scm.com/docs/git-credential
 */

import { unlinkSync } from "node:fs";

import { logDebug, logWarn } from "./log";
import {
  isExpired,
  refreshAccessToken,
  type TokenSet,
  TokenSetSchema,
} from "./logto-auth";
import { internalPath } from "./paths";

/** Host git itself authenticates against for plugin repositories. */
export const PLUGINS_HOST = "plugins.archgate.dev";

/**
 * Host the Logto token set is filed under.
 *
 * archgate registers itself as git's credential helper for {@link PLUGINS_HOST},
 * so storing its own tokens there would make every read re-enter this process.
 */
export const AUTH_HOST = "auth.archgate.dev";

const CREDENTIAL_TIMEOUT_MS = 3_000;

/**
 * Build env for git credential commands at call time (not import time),
 * suppressing every interactive prompt across platforms and Git Credential
 * Manager versions: git's terminal prompt, GCM terminal/GUI modes, and the
 * external/SSH askpass programs.
 */
function gitCredentialEnv(): Record<string, string | undefined> {
  return {
    ...Bun.env,
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GCM_GUI_PROMPT: "false",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
  };
}

export interface StoredCredentials {
  token: string;
  github_user: string;
}

// ---------------------------------------------------------------------------
// Git credential protocol helpers
// ---------------------------------------------------------------------------

function credentialInput(
  host: string,
  username?: string,
  password?: string
): string {
  const lines = ["protocol=https", `host=${host}`];
  if (username !== undefined && username !== "")
    lines.push(`username=${username}`);
  if (password !== undefined && password !== "")
    lines.push(`password=${password}`);
  lines.push("", "");
  return lines.join("\n");
}

async function gitCredentialApprove(
  host: string,
  username: string,
  password: string
): Promise<boolean> {
  const proc = Bun.spawn(["git", "credential", "approve"], {
    stdin: new Blob([credentialInput(host, username, password)]),
    stdout: "pipe",
    stderr: "pipe",
    env: gitCredentialEnv(),
  });
  return (await proc.exited) === 0;
}

async function gitCredentialFill(
  host: string
): Promise<{ username: string; password: string } | null> {
  try {
    const proc = Bun.spawn(["git", "credential", "fill"], {
      stdin: new Blob([credentialInput(host)]),
      stdout: "pipe",
      stderr: "pipe",
      env: gitCredentialEnv(),
    });

    // The timeout MUST be cancelled when the spawn wins the race —
    // `Bun.sleep` / `setTimeout` both keep the event loop alive for their
    // full duration, adding 3s of latency to every `loadCredentials()`
    // caller (e.g. `archgate doctor`) if left running.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      (async () => {
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        return { stdout, exitCode };
      })(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          proc.kill();
          resolve(null);
        }, CREDENTIAL_TIMEOUT_MS);
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer);
    });

    if (result?.exitCode !== 0) return null;

    let username = "";
    let password = "";
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("username=")) username = line.slice(9);
      if (line.startsWith("password=")) password = line.slice(9);
    }
    return username && password ? { username, password } : null;
  } catch {
    return null;
  }
}

async function gitCredentialReject(
  host: string,
  username: string,
  password: string
): Promise<void> {
  const proc = Bun.spawn(["git", "credential", "reject"], {
    stdin: new Blob([credentialInput(host, username, password)]),
    stdout: "pipe",
    stderr: "pipe",
    env: gitCredentialEnv(),
  });
  await proc.exited;
}

// ---------------------------------------------------------------------------
// Legacy metadata file cleanup
// ---------------------------------------------------------------------------

/** Path to the legacy metadata file (~/.archgate/credentials). */
function legacyMetadataPath(): string {
  return internalPath("credentials");
}

/**
 * Delete the legacy `~/.archgate/credentials` file if it exists.
 *
 * @returns `true` when a file was found and deleted, `false` when none existed.
 */
async function cleanupLegacyMetadata(): Promise<boolean> {
  const file = Bun.file(legacyMetadataPath());
  if (await file.exists()) {
    unlinkSync(legacyMetadataPath());
    logDebug("Legacy credentials metadata file removed");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CREDENTIAL_HELPER_HINT =
  "Run `git config --global credential.helper` to check your configuration.";

/**
 * Persist a Logto token set in the OS credential manager.
 *
 * A verification round-trip (`git credential fill`) confirms the blob was
 * actually persisted — `git credential approve` exits 0 even without a
 * configured helper, silently storing nothing.
 *
 * @param user - Display name shown by `archgate login status`.
 * @param tokens - Access token, refresh token and absolute expiry.
 */
export async function saveTokenSet(
  user: string,
  tokens: TokenSet
): Promise<void> {
  await cleanupLegacyMetadata();

  const stored = await gitCredentialApprove(
    AUTH_HOST,
    user,
    JSON.stringify(tokens)
  );

  if (!stored) {
    logWarn(
      "git credential approve failed.",
      "Your git credential helper may not be configured.",
      CREDENTIAL_HELPER_HINT
    );
    return;
  }

  if (await gitCredentialFill(AUTH_HOST)) {
    logDebug("Token set verified in git credential manager");
  } else {
    logWarn(
      "Token could not be verified in git credential manager.",
      "Your credential helper may not persist credentials.",
      CREDENTIAL_HELPER_HINT,
      "Without a working credential helper, you will need to re-login after each session."
    );
  }
}

/**
 * Read the stored Logto token set without renewing it.
 *
 * @returns The token set and the user it belongs to, or `null` when absent.
 */
export async function loadTokenSet(): Promise<{
  user: string;
  tokens: TokenSet;
} | null> {
  const stored = await gitCredentialFill(AUTH_HOST);
  if (!stored) return null;

  const parsed = TokenSetSchema.safeParse(safeJsonParse(stored.password));
  if (!parsed.success) {
    logDebug("Stored token set is unreadable");
    return null;
  }
  return { user: stored.username, tokens: parsed.data };
}

/**
 * Return a usable access token, renewing it when it has lapsed.
 *
 * @returns Credentials ready to send, or `null` when the user is signed out.
 */
export async function resolveAccessToken(): Promise<StoredCredentials | null> {
  const stored = await loadTokenSet();
  if (!stored) return null;

  if (!isExpired(stored.tokens.expiresAt)) {
    return { token: stored.tokens.accessToken, github_user: stored.user };
  }

  const renewed = await refreshAccessToken(stored.tokens.refreshToken);
  await saveTokenSet(stored.user, renewed);
  return { token: renewed.accessToken, github_user: stored.user };
}

/**
 * Load archgate credentials, renewing a lapsed access token on the way.
 *
 * Tokens issued before Logto sign-in are filed under {@link PLUGINS_HOST} and
 * are returned unchanged; they keep working until the user signs in again.
 *
 * @returns The stored credentials, or `null` when none are stored.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  // Delete legacy metadata file — force re-login for a clean slate.
  const hadLegacy = await cleanupLegacyMetadata();
  if (hadLegacy) {
    logWarn(
      "Legacy credentials file removed.",
      "Run `archgate login` to re-authenticate."
    );
    return null;
  }

  const resolved = await resolveAccessToken();
  if (resolved) return resolved;

  const legacy = await gitCredentialFill(PLUGINS_HOST);
  if (legacy) {
    return { token: legacy.password, github_user: legacy.username };
  }
  return null;
}

/**
 * Remove stored credentials (logout).
 * Clears both credential entries and any legacy metadata file.
 */
export async function clearCredentials(): Promise<void> {
  /* oxlint-disable no-await-in-loop -- two fixed hosts, cleared in order */
  for (const host of [AUTH_HOST, PLUGINS_HOST]) {
    const stored = await gitCredentialFill(host);
    if (stored) {
      await gitCredentialReject(host, stored.username, stored.password);
      logDebug("Credentials removed from git credential manager");
    }
  }
  /* oxlint-enable no-await-in-loop */
  await cleanupLegacyMetadata();
}

/** Parse JSON, returning `null` rather than throwing on malformed input. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
