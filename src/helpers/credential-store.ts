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

import { z } from "zod";

import { logDebug, logWarn } from "./log";
import {
  isExpired,
  refreshAccessToken,
  type TokenSet,
  TokenSetSchema,
} from "./logto-auth";
import { internalPath } from "./paths";
import { UserError } from "./user-error";

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

/** Outcome of one `git credential fill`, distinguishing absent from unusable. */
const FillResultSchema = z.object({
  credentials: z
    .object({ username: z.string().min(1), password: z.string().min(1) })
    .nullable(),
  /** True when the helper had to be killed for exceeding the timeout. */
  timedOut: z.boolean(),
});

type FillResult = z.infer<typeof FillResultSchema>;

/** Empty outcome, used for every path that yields no credentials. */
function noCredentials(timedOut: boolean): FillResult {
  return { credentials: null, timedOut };
}

async function gitCredentialFill(host: string): Promise<FillResult> {
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

    if (result === null) return noCredentials(true);
    if (result.exitCode !== 0) return noCredentials(false);

    let username = "";
    let password = "";
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("username=")) username = line.slice(9);
      if (line.startsWith("password=")) password = line.slice(9);
    }

    // The helper is a subprocess, so its output is validated rather than trusted.
    const parsed = FillResultSchema.safeParse({
      credentials: { username, password },
      timedOut: false,
    });
    return parsed.success ? parsed.data : noCredentials(false);
  } catch {
    return noCredentials(false);
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
 * @returns `true` when the token set is retrievable afterwards.
 */
export async function saveTokenSet(
  user: string,
  tokens: TokenSet
): Promise<boolean> {
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
    return false;
  }

  if ((await gitCredentialFill(AUTH_HOST)).credentials) {
    logDebug("Token set verified in git credential manager");
    return true;
  }

  logWarn(
    "Token could not be verified in git credential manager.",
    "Your credential helper may not persist credentials.",
    CREDENTIAL_HELPER_HINT,
    "Without a working credential helper, you will need to re-login after each session."
  );
  return false;
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
  return (await readTokenSet()).stored;
}

/** {@link loadTokenSet}, also reporting whether the helper timed out. */
async function readTokenSet(): Promise<{
  stored: { user: string; tokens: TokenSet } | null;
  timedOut: boolean;
}> {
  const { credentials, timedOut } = await gitCredentialFill(AUTH_HOST);
  if (!credentials) return { stored: null, timedOut };

  const parsed = TokenSetSchema.safeParse(safeJsonParse(credentials.password));
  if (!parsed.success) {
    logDebug("Stored token set is unreadable");
    return { stored: null, timedOut: false };
  }
  return {
    stored: { user: credentials.username, tokens: parsed.data },
    timedOut: false,
  };
}

/**
 * Return a usable access token, renewing it when it has lapsed.
 *
 * @returns Credentials ready to send, or `null` when the user is signed out.
 */
export async function resolveAccessToken(): Promise<StoredCredentials | null> {
  return (await resolveWithStatus()).credentials;
}

/** {@link resolveAccessToken}, also reporting whether the helper timed out. */
async function resolveWithStatus(): Promise<{
  credentials: StoredCredentials | null;
  timedOut: boolean;
}> {
  const { stored, timedOut } = await readTokenSet();
  if (!stored) return { credentials: null, timedOut };

  if (!isExpired(stored.tokens.expiresAt)) {
    return {
      credentials: {
        token: stored.tokens.accessToken,
        github_user: stored.user,
      },
      timedOut: false,
    };
  }

  return {
    credentials: await renew(stored.user, stored.tokens.refreshToken),
    timedOut: false,
  };
}

/**
 * Exchange a refresh token, tolerating a sibling process having rotated it.
 *
 * Git invokes the credential helper many times for one operation, so several
 * processes can read the same expired token set and refresh concurrently.
 * Logto rotates the refresh token, which makes every exchange after the first
 * fail. Re-reading the store recovers the token the winner just saved.
 *
 * @param user - Account the token set belongs to.
 * @param refreshToken - The refresh token read before renewal.
 * @returns Credentials from this renewal, or from whichever process won.
 * @throws {UserError} When no usable token set exists afterwards.
 */
async function renew(
  user: string,
  refreshToken: string
): Promise<StoredCredentials> {
  try {
    const renewed = await refreshAccessToken(refreshToken);
    if (!(await saveTokenSet(user, renewed))) {
      // The exchange rotated the refresh token, so the one still on disk is
      // already dead. This request can finish with the token in hand, but the
      // session cannot be renewed again.
      logWarn(
        "Renewed credentials could not be stored.",
        "Run `archgate login` to sign in again."
      );
    }
    return { token: renewed.accessToken, github_user: user };
  } catch (error) {
    const { stored } = await readTokenSet();
    if (
      stored &&
      stored.tokens.refreshToken !== refreshToken &&
      !isExpired(stored.tokens.expiresAt)
    ) {
      logDebug("token set was renewed by another process");
      return { token: stored.tokens.accessToken, github_user: stored.user };
    }
    throw error;
  }
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

  // A rejected refresh token is an expected signed-out state, not a failure:
  // swallowing it here keeps the documented null contract and lets the legacy
  // lookup below still answer. Anything else is a real fault and propagates.
  let resolved: StoredCredentials | null = null;
  let authLookupTimedOut = false;
  try {
    const outcome = await resolveWithStatus();
    resolved = outcome.credentials;
    authLookupTimedOut = outcome.timedOut;
  } catch (error) {
    if (!(error instanceof UserError)) throw error;
    logDebug("stored session could not be renewed", { reason: error.message });
  }
  if (resolved) return resolved;

  // A helper that timed out on the first host will time out on the second too,
  // so skip it rather than making every signed-out call wait twice over.
  if (authLookupTimedOut) return null;

  const { credentials: legacy } = await gitCredentialFill(PLUGINS_HOST);
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
    const { credentials: stored } = await gitCredentialFill(host);
    if (stored) {
      await gitCredentialReject(host, stored.username, stored.password);
      logDebug("Credentials removed from git credential manager");
    }
  }
  /* oxlint-enable no-await-in-loop */
  await cleanupLegacyMetadata();
}

/**
 * Mark the stored access token as lapsed, keeping the refresh token.
 *
 * Git erases credentials on any rejection, so discarding the refresh token
 * here would turn a single recoverable 401 into a full device-flow login.
 * The next lookup renews instead.
 */
export async function invalidateAccessToken(): Promise<void> {
  const stored = await loadTokenSet();
  if (!stored) return;

  await saveTokenSet(stored.user, { ...stored.tokens, expiresAt: 0 });
  logDebug("access token marked for renewal");
}

/** Parse JSON, returning `null` rather than throwing on malformed input. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
