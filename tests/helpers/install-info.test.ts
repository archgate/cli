// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach } from "bun:test";

import {
  detectInstallMethod,
  getProjectContext,
  _resetInstallInfoCaches,
} from "../../src/helpers/install-info";

describe("install-info", () => {
  afterEach(() => {
    _resetInstallInfoCaches();
  });

  describe("detectInstallMethod", () => {
    test("returns a valid install method string", () => {
      const method = detectInstallMethod();
      expect(["binary", "proto", "local", "global-pm"]).toContain(method);
    });

    test("result is cached across calls", () => {
      const first = detectInstallMethod();
      const second = detectInstallMethod();
      expect(first).toBe(second);
    });
  });

  describe("getProjectContext", () => {
    test("detects the current archgate project", () => {
      // Running from the CLI repo root, which has .archgate/adrs/
      const ctx = getProjectContext();
      expect(ctx.hasProject).toBe(true);
      expect(ctx.adrCount).toBeGreaterThan(0);
      expect(ctx.adrWithRulesCount).toBeGreaterThan(0);
      expect(ctx.domains.length).toBeGreaterThan(0);
    });

    test("returns equal (not identical) contexts across calls", () => {
      // getProjectContext is no longer cached — each call re-reads the
      // filesystem so post-init events reflect newly-created ADRs.
      const first = getProjectContext();
      const second = getProjectContext();
      expect(first).toEqual(second);
    });

    test("domains are sorted alphabetically", () => {
      const ctx = getProjectContext();
      const sorted = [...ctx.domains].sort();
      expect(ctx.domains).toEqual(sorted);
    });
  });
});
