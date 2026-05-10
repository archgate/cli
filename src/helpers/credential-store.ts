// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * credential-store.ts — Secure credential storage using git's native credential helpers.
 *
 * Tokens are stored exclusively in the OS credential manager (macOS Keychain,
 * Windows Credential Manager, libsecret) via `git credential approve/fill/reject`.
 * Nothing is written to disk — no metadata files, no plaintext tokens.
 *
 * The `username` field in the git credential protocol carries the GitHub username,
 * and the `password` field carries the archgate plugin token.
 *
 * @see https://git-scm.com/docs/git-credential
 */

import { unlinkSync } from "node:fs";

import { logDebug, logWarn } from "./log";
import { internalPath } from "./paths";

const CREDENTIAL_HOST = "plugins.archgate.dev";
const CREDENTIAL_TIMEOUT_MS = 3_000;

/**
 * Build env for git credential commands at call time (not import time).
 *
 * Suppresses ALL interactive prompts — terminal, GUI, and askpass — across
 * platforms and Git Credential Manager (GCM) versions:
 *
 * - GIT_TERMINAL_PROMPT=0  — git's own terminal prompt
 * - GCM_INTERACTIVE=never  — GCM interactive mode (terminal + GUI)
 * - GCM_GUI_PROMPT=false   — GCM GUI-only prompt (Windows toast/dialog)
 * - GIT_ASKPASS=""          — external askpass program
 * - SSH_ASKPASS=""          — SSH askpass fallback (some helpers reuse it)
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

function credentialInput(username?: string, password?: string): string {
  const lines = ["protocol=https", `host=${CREDENTIAL_HOST}`];
  if (username) lines.push(`username=${username}`);
  if (password) lines.push(`password=${password}`);
  lines.push("", "");
  return lines.join("\n");
}

async function gitCredentialApprove(
  username: string,
  password: string
): Promise<boolean> {
  const proc = Bun.spawn(["git", "credential", "approve"], {
    stdin: new Blob([credentialInput(username, password)]),
    stdout: "pipe",
    stderr: "pipe",
    env: gitCredentialEnv(),
  });
  return (await proc.exited) === 0;
}

async function gitCredentialFill(): Promise<{
  username: string;
  password: string;
} | null> {
  try {
    const proc = Bun.spawn(["git", "credential", "fill"], {
      stdin: new Blob([credentialInput()]),
      stdout: "pipe",
      stderr: "pipe",
      env: gitCredentialEnv(),
    });

    // The timeout MUST be cancelled when the spawn wins the race —
    // `Bun.sleep` / `setTimeout` both keep the event loop alive for
    // their full duration, which used to add 3s of latency to
    // commands that call `loadCredentials()` (e.g. `archgate doctor`).
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

    if (!result || result.exitCode !== 0) return null;

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
  username: string,
  password: string
): Promise<void> {
  const proc = Bun.spawn(["git", "credential", "reject"], {
    stdin: new Blob([credentialInput(username, password)]),
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
 * Delete the legacy ~/.archgate/credentials file if it exists.
 * Returns true if a file was found and deleted.
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
 * Persist archgate credentials in the OS credential manager.
 *
 * A verification round-trip (`git credential fill`) confirms the token was
 * actually persisted — `git credential approve` exits 0 even without a
 * configured helper, silently storing nothing.
 */
export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
  // Clean up any legacy metadata file from previous versions.
  await cleanupLegacyMetadata();

  const stored = await gitCredentialApprove(
    credentials.github_user,
    credentials.token
  );

  if (stored) {
    const verified = await gitCredentialFill();
    if (verified) {
      logDebug("Token verified in git credential manager");
    } else {
      logWarn(
        "Token could not be verified in git credential manager.",
        "Your credential helper may not persist credentials.",
        CREDENTIAL_HELPER_HINT,
        "Without a working credential helper, you will need to re-login after each session."
      );
    }
  } else {
    logWarn(
      "git credential approve failed.",
      "Your git credential helper may not be configured.",
      CREDENTIAL_HELPER_HINT
    );
  }
}

/**
 * Load stored archgate credentials from the OS credential manager.
 * Returns null if no credentials are stored.
 *
 * If a legacy ~/.archgate/credentials file exists, it is deleted and
 * the user is asked to re-login.
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

  const gitCreds = await gitCredentialFill();
  if (gitCreds) {
    return { token: gitCreds.password, github_user: gitCreds.username };
  }
  return null;
}

/**
 * Remove stored credentials (logout).
 * Clears the OS credential manager and any legacy metadata file.
 */
export async function clearCredentials(): Promise<void> {
  const gitCreds = await gitCredentialFill();
  if (gitCreds) {
    await gitCredentialReject(gitCreds.username, gitCreds.password);
    logDebug("Token removed from git credential manager");
  }
  await cleanupLegacyMetadata();
}
