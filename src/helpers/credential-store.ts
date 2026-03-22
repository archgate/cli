/**
 * credential-store.ts — Secure credential storage using git's native credential helpers.
 *
 * Stores archgate tokens in the user's configured git credential manager
 * (macOS Keychain, Windows Credential Manager, libsecret, etc.) using the
 * standard `git credential approve/fill/reject` protocol.
 *
 * This means:
 * - Tokens are encrypted at rest by the OS
 * - `git clone https://plugins.archgate.dev/archgate.git` works transparently
 *   (git retrieves the stored credentials automatically)
 * - No custom credential helper command needed — git already knows how to do this
 *
 * A lightweight JSON file at ~/.archgate/credentials stores non-sensitive
 * metadata (github_user, created_at) for `archgate login status` display.
 *
 * @see https://git-scm.com/docs/git-credential
 */

import { chmodSync, unlinkSync } from "node:fs";

import { logDebug } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";

const CREDENTIAL_HOST = "plugins.archgate.dev";
const METADATA_FILE = "credentials";

/**
 * Environment variables for git credential commands.
 * - GIT_TERMINAL_PROMPT=0 → suppress terminal prompts
 * - GCM_INTERACTIVE=never → suppress GUI prompts (Git Credential Manager on Windows)
 */
const GIT_CREDENTIAL_ENV = {
  ...Bun.env,
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
};

export interface StoredCredentials {
  token: string;
  github_user: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Git credential protocol helpers
// ---------------------------------------------------------------------------

/**
 * Store credentials in the user's git credential manager.
 * Uses `git credential approve` which writes to the configured credential.helper.
 */
async function gitCredentialApprove(
  username: string,
  password: string
): Promise<boolean> {
  const input = [
    "protocol=https",
    `host=${CREDENTIAL_HOST}`,
    `username=${username}`,
    `password=${password}`,
    "",
    "",
  ].join("\n");

  const proc = Bun.spawn(["git", "credential", "approve"], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_CREDENTIAL_ENV,
  });
  return (await proc.exited) === 0;
}

/** Timeout for git credential operations (3 seconds). */
const CREDENTIAL_TIMEOUT_MS = 3_000;

/**
 * Retrieve credentials from the user's git credential manager.
 * Uses `git credential fill` which reads from the configured credential.helper.
 *
 * GIT_TERMINAL_PROMPT=0 prevents git from prompting interactively.
 * A timeout guard prevents hangs when the credential manager is unresponsive.
 */
async function gitCredentialFill(): Promise<{
  username: string;
  password: string;
} | null> {
  const input = ["protocol=https", `host=${CREDENTIAL_HOST}`, "", ""].join(
    "\n"
  );

  try {
    const proc = Bun.spawn(["git", "credential", "fill"], {
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
      env: GIT_CREDENTIAL_ENV,
    });

    const result = await Promise.race([
      (async () => {
        const stdout = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        return { stdout, exitCode };
      })(),
      Bun.sleep(CREDENTIAL_TIMEOUT_MS).then(() => {
        proc.kill();
        return null;
      }),
    ]);

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

/**
 * Remove credentials from the user's git credential manager.
 * Uses `git credential reject` which tells the configured helper to erase them.
 */
async function gitCredentialReject(
  username: string,
  password: string
): Promise<void> {
  const input = [
    "protocol=https",
    `host=${CREDENTIAL_HOST}`,
    `username=${username}`,
    `password=${password}`,
    "",
    "",
  ].join("\n");

  const proc = Bun.spawn(["git", "credential", "reject"], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    env: GIT_CREDENTIAL_ENV,
  });
  await proc.exited;
}

// ---------------------------------------------------------------------------
// Metadata file (non-sensitive: github_user, created_at)
// ---------------------------------------------------------------------------

function metadataPath(): string {
  return internalPath(METADATA_FILE);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist archgate credentials securely.
 *
 * - **Token** → git credential manager (encrypted at rest by the OS)
 * - **Metadata** (github_user, created_at) → `~/.archgate/credentials`
 *
 * After this, `git clone https://plugins.archgate.dev/archgate.git` will
 * automatically use the stored token — no credentials in the URL needed.
 */
export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
  // Store token in git credential manager
  const stored = await gitCredentialApprove(
    credentials.github_user,
    credentials.token
  );
  if (stored) {
    logDebug("Token stored in git credential manager");
  } else {
    logDebug("git credential approve failed — token may not be persisted");
  }

  // Store metadata in ~/.archgate/credentials (for `login status` display)
  createPathIfNotExists(internalPath());
  const filePath = metadataPath();
  await Bun.write(filePath, JSON.stringify(credentials, null, 2) + "\n");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on Windows — NTFS uses ACLs instead
  }
  logDebug("Credentials metadata saved to", filePath);
}

/**
 * Load stored archgate credentials, or null if none exist.
 *
 * Reads the token from git's credential manager first, falling back to
 * the plaintext file for legacy installs.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  const file = Bun.file(metadataPath());
  if (!(await file.exists())) {
    return null;
  }

  let data: StoredCredentials;
  try {
    data = (await file.json()) as StoredCredentials;
    if (!data.github_user) return null;
  } catch {
    logDebug("Failed to parse credentials file");
    return null;
  }

  // Try to load token from git credential manager
  const gitCreds = await gitCredentialFill();
  if (gitCreds) {
    return {
      token: gitCreds.password,
      github_user: gitCreds.username,
      created_at: data.created_at,
    };
  }

  // Fall back to token in the file (legacy plaintext storage)
  if (!data.token) return null;
  return data;
}

/**
 * Remove stored credentials (logout).
 *
 * Clears both the git credential manager and the metadata file.
 */
export async function clearCredentials(): Promise<void> {
  // Remove from git credential manager (need current credentials to reject)
  const gitCreds = await gitCredentialFill();
  if (gitCreds) {
    await gitCredentialReject(gitCreds.username, gitCreds.password);
    logDebug("Token removed from git credential manager");
  }

  // Remove metadata file
  if (await Bun.file(metadataPath()).exists()) {
    unlinkSync(metadataPath());
    logDebug("Credentials file removed");
  }
}
