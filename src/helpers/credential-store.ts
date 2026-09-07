// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Secure credential storage in the OS credential manager (macOS Keychain,
 * Windows Credential Manager, libsecret) via `git credential
 * approve/fill/reject` — nothing is written to disk. The platform token set
 * is filed under {@link AUTH_HOST} as a JSON `password`; a token issued
 * before platform sign-in sits under {@link PLUGINS_HOST} as-is.
 *
 * @see https://git-scm.com/docs/git-credential
 */

import { unlinkSync } from "node:fs";

import { z } from "zod";

import { logDebug, logWarn } from "./log";
import { internalPath } from "./paths";
import {
  AUTH_HOST,
  isExpired,
  platformAuth,
  type Session,
  type TokenSet,
  TokenSetSchema,
} from "./platform-auth";
import { PLUGINS_HOST } from "./plugin-install";
import { SessionExpiredError } from "./session-expired-error";
import { UserError } from "./user-error";

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

/**
 * Refuse a value that could forge protocol lines or truncate the record.
 *
 * A newline inside an account name would add a second `host=` line, and git
 * takes the later one, so the token set would be filed under that host.
 *
 * @throws {UserError} When the value holds a line break or NUL.
 */
function protocolValue(field: string, value: string): string {
  if (value.includes("\n") || value.includes("\r") || value.includes("\0")) {
    throw new UserError(
      `The credential ${field} contains a line break and cannot be stored.`
    );
  }
  return value;
}

function credentialInput(
  host: string,
  username?: string,
  password?: string
): string {
  const lines = ["protocol=https", `host=${protocolValue("host", host)}`];
  if (username !== undefined && username !== "")
    lines.push(`username=${protocolValue("username", username)}`);
  if (password !== undefined && password !== "")
    lines.push(`password=${protocolValue("password", password)}`);
  lines.push("", "");
  return lines.join("\n");
}

/**
 * Run `git credential approve` or `reject` for one record.
 *
 * @returns `true` when git exited 0. Output is ignored: nothing reads it, and
 * an unread pipe can fill and block git (ARCH-007).
 */
async function gitCredential(
  action: "approve" | "reject",
  host: string,
  username: string,
  password: string
): Promise<boolean> {
  const proc = Bun.spawn(["git", "credential", action], {
    stdin: new Blob([credentialInput(host, username, password)]),
    stdout: "ignore",
    stderr: "ignore",
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

/**
 * Ask git for the record filed under a host.
 *
 * @param host - Host the record is filed under.
 * @param account - When given, selects that account's record rather than
 * whichever the helper answers first.
 */
async function gitCredentialFill(
  host: string,
  account?: string
): Promise<FillResult> {
  try {
    // stderr is ignored rather than piped: nothing reads it, and an unread
    // pipe can fill and block the helper (ARCH-007).
    const proc = Bun.spawn(["git", "credential", "fill"], {
      stdin: new Blob([credentialInput(host, account)]),
      stdout: "pipe",
      stderr: "ignore",
      env: gitCredentialEnv(),
    });

    // The timer is cleared when git answers first: a pending `setTimeout`
    // keeps the event loop alive for its full duration, which would add 3s of
    // latency to every caller.
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

// ---------------------------------------------------------------------------
// Legacy metadata file cleanup
// ---------------------------------------------------------------------------

/**
 * Delete the legacy `~/.archgate/credentials` file if it exists.
 *
 * @returns `true` when a file was found and deleted, `false` when none existed.
 */
async function cleanupLegacyMetadata(): Promise<boolean> {
  const path = internalPath("credentials");
  if (!(await Bun.file(path).exists())) return false;
  unlinkSync(path);
  logDebug("Legacy credentials metadata file removed");
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CREDENTIAL_HELPER_HINT =
  "Run `git config --global credential.helper` to check your configuration.";

/**
 * Persist a platform token set in the OS credential manager.
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

  const serialized = JSON.stringify(tokens);
  const stored = await gitCredential("approve", AUTH_HOST, user, serialized);
  if (!stored) {
    logWarn(
      "git credential approve failed.",
      "Your git credential helper may not be configured.",
      CREDENTIAL_HELPER_HINT
    );
    return false;
  }

  // The read-back asks for this account and must return this very blob: a
  // helper may otherwise answer with an older record or another user's.
  const { credentials } = await gitCredentialFill(AUTH_HOST, user);
  if (credentials?.password === serialized) {
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
 * Read the stored platform session without renewing it.
 *
 * @returns The session, or `null` when none is stored.
 */
export async function loadTokenSet(): Promise<Session | null> {
  return (await readSession()).session;
}

/** {@link loadTokenSet}, also reporting whether the helper timed out. */
async function readSession(): Promise<{
  session: Session | null;
  timedOut: boolean;
}> {
  const { credentials, timedOut } = await gitCredentialFill(AUTH_HOST);
  if (!credentials) return { session: null, timedOut };

  const parsed = TokenSetSchema.safeParse(safeJsonParse(credentials.password));
  if (!parsed.success) {
    logDebug("Stored token set is unreadable");
    return { session: null, timedOut: false };
  }
  return {
    session: { user: credentials.username, tokens: parsed.data },
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
  const { session, timedOut } = await readSession();
  if (!session) return { credentials: null, timedOut };

  const credentials = isExpired(session.tokens.expiresAt)
    ? await renew(session)
    : { token: session.tokens.accessToken, github_user: session.user };
  return { credentials, timedOut: false };
}

/**
 * Exchange a refresh token, tolerating a sibling process having rotated it.
 *
 * Git invokes the credential helper many times for one operation, so several
 * processes can read the same expired session and refresh concurrently. The
 * platform rotates the refresh token, which makes every exchange after the
 * first fail; re-reading the store recovers the token the winner saved.
 *
 * @param stale - The expired session as read before renewal.
 * @returns Credentials from this renewal, or from whichever process won.
 * @throws {UserError} When no usable session exists afterwards.
 */
async function renew(stale: Session): Promise<StoredCredentials> {
  try {
    const renewed = await platformAuth.refreshAccessToken(
      stale.tokens.refreshToken
    );
    if (!(await saveTokenSet(stale.user, renewed))) {
      // The exchange rotated the refresh token, so the stored one is already
      // dead: this request can finish, but the session cannot be renewed again.
      logWarn(
        "Renewed credentials could not be stored.",
        "Run `archgate login` to sign in again."
      );
    }
    return { token: renewed.accessToken, github_user: stale.user };
  } catch (error) {
    const { session } = await readSession();
    if (
      session &&
      session.tokens.refreshToken !== stale.tokens.refreshToken &&
      !isExpired(session.tokens.expiresAt)
    ) {
      logDebug("token set was renewed by another process");
      return { token: session.tokens.accessToken, github_user: session.user };
    }
    throw error;
  }
}

/**
 * Load archgate credentials, renewing a lapsed access token on the way.
 *
 * A token issued before platform sign-in is filed under {@link PLUGINS_HOST}
 * and is returned unchanged, but only while no platform session is stored:
 * once the user has signed in, that session alone decides.
 *
 * @returns The stored credentials, or `null` when none are stored.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  // A legacy metadata file means a pre-platform install: remove it and
  // require a fresh sign-in.
  if (await cleanupLegacyMetadata()) {
    logWarn(
      "Legacy credentials file removed.",
      "Run `archgate login` to re-authenticate."
    );
    return null;
  }

  // A refused refresh token is an expected signed-out state, not a failure,
  // and it ends the lookup: the legacy store is not consulted for a user who
  // has signed in to the platform, and while archgate is git's helper for
  // the plugins host that lookup would only reach archgate itself. Anything
  // else — the service unreachable or failing — propagates.
  let resolved: StoredCredentials | null = null;
  let authLookupTimedOut = false;
  try {
    const outcome = await resolveWithStatus();
    resolved = outcome.credentials;
    authLookupTimedOut = outcome.timedOut;
  } catch (error) {
    if (!(error instanceof SessionExpiredError)) throw error;
    logDebug("stored session is signed out", { reason: error.message });
    return null;
  }
  if (resolved) return resolved;

  // A helper that timed out on the first host will time out on the second too,
  // so skip it rather than making every signed-out call wait twice over.
  if (authLookupTimedOut) return null;

  const { credentials: legacy } = await gitCredentialFill(PLUGINS_HOST);
  return legacy
    ? { token: legacy.password, github_user: legacy.username }
    : null;
}

/**
 * Remove stored credentials (logout).
 *
 * Clears both credential entries and any legacy metadata file. Callers
 * unregister the git credential helper first: while archgate answers for the
 * plugins host, the lookup for that host reaches archgate itself rather than
 * the store holding a legacy token, which would then outlive the logout.
 *
 * @returns `true` when every record found was removed.
 */
export async function clearCredentials(): Promise<boolean> {
  let cleared = true;
  /* oxlint-disable no-await-in-loop -- two fixed hosts, cleared in order */
  for (const host of [AUTH_HOST, PLUGINS_HOST]) {
    const { credentials, timedOut } = await gitCredentialFill(host);
    if (timedOut) {
      // Nothing is known about this host, so nothing can be called removed.
      logDebug("git credential fill timed out", { host });
      cleared = false;
      continue;
    }
    if (!credentials) continue;
    const rejected = await gitCredential(
      "reject",
      host,
      credentials.username,
      credentials.password
    );
    if (rejected) {
      logDebug("Credentials removed from git credential manager", { host });
    } else {
      logDebug("git credential reject failed", { host });
      cleared = false;
    }
  }
  /* oxlint-enable no-await-in-loop */
  await cleanupLegacyMetadata();
  return cleared;
}

/**
 * Mark the stored access token as lapsed, keeping the refresh token.
 *
 * Git erases credentials on any rejection, so discarding the refresh token
 * here would turn a single recoverable 401 into a full device-flow login.
 * The next lookup renews instead.
 *
 * @returns `true` when the lapsed token set was persisted; `false` when there
 * was nothing stored or the store could not be updated, in which case
 * {@link saveTokenSet} has already warned.
 */
export async function invalidateAccessToken(): Promise<boolean> {
  const session = await loadTokenSet();
  if (!session) return false;

  const saved = await saveTokenSet(session.user, {
    ...session.tokens,
    expiresAt: 0,
  });
  if (saved) logDebug("access token marked for renewal");
  return saved;
}

/** Parse JSON, returning `null` rather than throwing on malformed input. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
