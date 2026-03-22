/**
 * credential-store.ts — Secure credential storage using OS credential manager.
 *
 * Tokens are stored securely in the OS credential manager via Bun.secrets
 * (macOS Keychain, Windows Credential Manager, Linux libsecret).
 * Non-sensitive metadata (github_user, created_at) is stored in a lightweight
 * JSON file at ~/.archgate/credentials.
 *
 * Falls back to the plaintext file if the OS credential manager is unavailable.
 */

import { chmodSync, unlinkSync } from "node:fs";

import { logDebug } from "./log";
import { internalPath, createPathIfNotExists } from "./paths";

const CREDENTIALS_FILE = "credentials";

/** Bun.secrets service name — identifies archgate in the OS credential manager. */
const SECRETS_SERVICE = "dev.archgate.plugins";
/** Bun.secrets key name for the archgate token. */
const SECRETS_TOKEN_NAME = "token";

export interface StoredCredentials {
  token: string;
  github_user: string;
  created_at: string;
}

function credentialsPath(): string {
  return internalPath(CREDENTIALS_FILE);
}

/**
 * Persist archgate credentials securely.
 *
 * - **Token** → OS credential manager via `Bun.secrets` (encrypted at rest)
 * - **Metadata** (github_user, created_at) → `~/.archgate/credentials` (non-sensitive)
 *
 * Falls back to the plaintext file if the OS credential manager is unavailable.
 */
export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
  // Store token securely in OS credential manager
  try {
    await Bun.secrets.set({
      service: SECRETS_SERVICE,
      name: SECRETS_TOKEN_NAME,
      value: credentials.token,
    });
    logDebug("Token stored in OS credential manager");
  } catch (err) {
    logDebug(
      "OS credential manager unavailable, falling back to file storage:",
      err instanceof Error ? err.message : String(err)
    );
    // Fall through — the token will be stored in the metadata file below
  }

  // Store metadata (and token as fallback) in ~/.archgate/credentials
  createPathIfNotExists(internalPath());
  const filePath = credentialsPath();
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
 * Reads the token from the OS credential manager first, falling back to the
 * plaintext file if the credential manager doesn't have it.
 */
export async function loadCredentials(): Promise<StoredCredentials | null> {
  const file = Bun.file(credentialsPath());
  if (!(await file.exists())) {
    return null;
  }

  try {
    const data = (await file.json()) as StoredCredentials;
    if (!data.github_user) {
      return null;
    }

    // Try to load token from OS credential manager first
    try {
      const secureToken = await Bun.secrets.get({
        service: SECRETS_SERVICE,
        name: SECRETS_TOKEN_NAME,
      });
      if (secureToken) {
        return { ...data, token: secureToken };
      }
    } catch {
      logDebug("OS credential manager unavailable, using file fallback");
    }

    // Fall back to token from the file (legacy or fallback)
    if (!data.token) {
      return null;
    }
    return data;
  } catch {
    logDebug("Failed to parse credentials file");
    return null;
  }
}

/**
 * Remove stored credentials (logout).
 *
 * Clears both the OS credential manager and the metadata file.
 */
export async function clearCredentials(): Promise<void> {
  // Remove from OS credential manager
  try {
    await Bun.secrets.delete({
      service: SECRETS_SERVICE,
      name: SECRETS_TOKEN_NAME,
    });
    logDebug("Token removed from OS credential manager");
  } catch {
    // Credential manager may not be available or token may not exist
  }

  // Remove metadata file
  if (await Bun.file(credentialsPath()).exists()) {
    unlinkSync(credentialsPath());
    logDebug("Credentials file removed");
  }
}
