// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * credential-store.ts — Public API for credential storage.
 *
 * Re-exports from credential-store-impl.ts so that existing consumers keep
 * working with `import { ... } from "./credential-store"`. The separate
 * implementation file exists to isolate the real functions from mock.module()
 * calls in login-flow.test.ts — see credential-store-impl.ts header for details.
 */

export {
  saveCredentials,
  loadCredentials,
  clearCredentials,
} from "./credential-store-impl";
export type { StoredCredentials } from "./credential-store-impl";
