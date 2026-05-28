// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * credential-store.ts — Public API for credential storage.
 *
 * Wraps credential-store-impl.ts with delegate functions (NOT live re-exports)
 * so that mock.module("credential-store") in login-flow.test.ts does NOT follow
 * the ESM binding chain into credential-store-impl.ts. A live
 * `export { X } from "./Y"` creates a binding that Bun's mock.module replaces
 * at the source, poisoning credential-store-impl.ts for other test files.
 * Wrapper functions are their own bindings — mocking credential-store.ts
 * replaces the wrappers, leaving credential-store-impl.ts untouched.
 */

import {
  saveCredentials as saveCredentialsImpl,
  loadCredentials as loadCredentialsImpl,
  clearCredentials as clearCredentialsImpl,
} from "./credential-store-impl";
import type { StoredCredentials } from "./credential-store-impl";

export type { StoredCredentials } from "./credential-store-impl";

export async function saveCredentials(
  credentials: StoredCredentials
): Promise<void> {
  return await saveCredentialsImpl(credentials);
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  return await loadCredentialsImpl();
}

export async function clearCredentials(): Promise<void> {
  return await clearCredentialsImpl();
}
