/**
 * credential-store.ts — Secure credential storage using git's native credential helpers.
 *
 * Tokens are stored in the OS credential manager (macOS Keychain, Windows
 * Credential Manager, libsecret) via `git credential approve/fill/reject`.
 * A lightweight JSON metadata file at ~/.archgate/credentials stores only
 * non-sensitive data (github_user, created_at). Tokens are NEVER written
 * to disk in plaintext.
 *
 * @see https://git-scm.com/docs/git-credential
 */

import { chmodSync, unlinkSync } from "node:fs";

import { logDebug, logWarn } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";

const CREDENTIAL_HOST = "plugins.archgate.dev";
const METADATA_FILE = "credentials";
const CREDENTIAL_TIMEOUT_MS = 3_000;

/** Build env for git credential commands at call time (not import time). */
function gitCredentialEnv(): Record<string, string | undefined> {
  return { ...Bun.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

export interface StoredCredentials {
  token: string;
  github_user: string;
  created_at: string;
}

/** Metadata file shape (non-sensitive only). */
interface CredentialMetadata {
  github_user: string;
  created_at: string;
  /** @deprecated Legacy field — presence triggers re-login prompt. */
  token?: string;
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
// Metadata helpers
// ---------------------------------------------------------------------------

function metadataPath(): string {
  return internalPath(METADATA_FILE);
}

async function readMetadata(): Promise<CredentialMetadata | null> {
  const file = Bun.file(metadataPath());
  if (!(await file.exists())) return null;
  try {
    const data = (await file.json()) as CredentialMetadata;
    return data.github_user ? data : null;
  } catch {
    logDebug("Failed to parse credentials file");
    return null;
  }
}

async function writeMetadata(metadata: CredentialMetadata): Promise<void> {
  createPathIfNotExists(internalPath());
  const filePath = metadataPath();
  const clean: CredentialMetadata = {
    github_user: metadata.github_user,
    created_at: metadata.created_at,
  };
  await Bun.write(filePath, JSON.stringify(clean, null, 2) + "\n");
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // chmod may fail on Windows — NTFS uses ACLs instead
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const CREDENTIAL_HELPER_HINT =
  "Run `git config --global credential.helper` to check your configuration.";

/**
 * Persist archgate credentials securely.
 *
 * Token goes to the git credential manager; only non-sensitive metadata is
 * written to disk. A verification round-trip confirms the token was actually
 * persisted — `git credential approve` exits 0 even without a configured
 * helper, silently storing nothing.
 */
export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
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

  await writeMetadata({
    github_user: credentials.github_user,
    created_at: credentials.created_at,
  });
  logDebug("Credentials metadata saved to", metadataPath());
}

/**
 * Load stored archgate credentials, or null if none exist.
 *
 * Token is always read from the git credential manager — never from disk.
 * If a legacy metadata file contains a plaintext token, it is deleted and
 * the user is asked to run `archgate login` again.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  // Git credential manager is the authoritative token source — check it first
  // so credentials survive even if the metadata file is gone (e.g. after upgrade).
  const gitCreds = await gitCredentialFill();
  const metadata = await readMetadata();

  // If the metadata file contains a legacy plaintext token, delete it
  // regardless of whether git creds exist — plaintext tokens must not persist.
  if (metadata?.token) {
    logWarn(
      "Plaintext token found in credentials file — removing it.",
      "Run `archgate login` to re-authenticate."
    );
    unlinkSync(metadataPath());
    logDebug("Legacy credentials file with plaintext token removed");
    // Even if git creds exist, force re-login so the metadata file is
    // recreated cleanly without a token field.
    return null;
  }

  if (gitCreds) {
    return {
      token: gitCreds.password,
      github_user: gitCreds.username,
      created_at: metadata?.created_at ?? "",
    };
  }

  return null;
}

/**
 * Remove stored credentials (logout).
 * Clears both the git credential manager and the metadata file.
 */
export async function clearCredentials(): Promise<void> {
  const gitCreds = await gitCredentialFill();
  if (gitCreds) {
    await gitCredentialReject(gitCreds.username, gitCreds.password);
    logDebug("Token removed from git credential manager");
  }

  if (await Bun.file(metadataPath()).exists()) {
    unlinkSync(metadataPath());
    logDebug("Credentials file removed");
  }
}
