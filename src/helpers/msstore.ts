// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import store from "../../distribution/msix/store.json";

/**
 * The command that updates a Microsoft Store install. An MSIX package
 * directory is read-only, so the Store — reached here through winget's
 * `msstore` source — is the only thing that can replace the binary.
 */
export const STORE_UPGRADE_COMMAND = `winget upgrade --id ${store.productId}`;
