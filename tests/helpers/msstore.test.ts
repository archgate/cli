// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import store from "../../distribution/msix/store.json";
import { STORE_UPGRADE_COMMAND } from "../../src/helpers/msstore";

describe("STORE_UPGRADE_COMMAND", () => {
  test("upgrades the Store product through winget", () => {
    expect(STORE_UPGRADE_COMMAND).toBe(
      `winget upgrade --id ${store.productId}`
    );
  });
});
