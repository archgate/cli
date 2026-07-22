// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadRuleAdrs } from "../../src/engine/loader";

/**
 * End-to-end coverage of the opt-in contained-import feature through the real
 * loader path: `.archgate/config.json` → `resolveRuleImportDirs` →
 * `scanRuleSource`. Proves the default (no config) stays closed and that a
 * misconfigured allow-list fails closed with a clear error.
 */
describe("loadRuleAdrs with ruleImports.allowedDirs", () => {
  let root: string;
  let adrsDir: string;
  let libDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "archgate-loader-imports-"));
    adrsDir = join(root, ".archgate", "adrs");
    libDir = join(root, ".archgate", "lib");
    mkdirSync(adrsDir, { recursive: true });
    mkdirSync(libDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(config: unknown): void {
    writeFileSync(
      join(root, ".archgate", "config.json"),
      JSON.stringify(config, null, 2)
    );
  }

  function writeAdr(): void {
    writeFileSync(
      join(adrsDir, "SEC-001-imports.md"),
      `---
id: SEC-001
title: Test ADR
domain: general
rules: true
---

## Context
Contained-import test.

## Decision
Test decision.
`
    );
  }

  function writeRulesImporting(): void {
    writeFileSync(
      join(adrsDir, "SEC-001-imports.rules.ts"),
      `/// <reference path="../rules.d.ts" />
import { findTodos } from "../lib/todos";
export default {
  rules: {
    "uses-helper": {
      description: "Uses a shared helper",
      async check(ctx) {
        findTodos(ctx);
      },
    },
  },
} satisfies RuleSet;
`
    );
  }

  test("loads a rule that imports a clean helper from an allowed dir", async () => {
    writeConfig({ ruleImports: { allowedDirs: [".archgate/lib"] } });
    writeAdr();
    writeRulesImporting();
    writeFileSync(
      join(libDir, "todos.ts"),
      `export function findTodos(_ctx: unknown) { return []; }\n`
    );

    const results = await loadRuleAdrs(root);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("loaded");
  });

  test("blocks transitively when the imported helper uses fetch", async () => {
    writeConfig({ ruleImports: { allowedDirs: [".archgate/lib"] } });
    writeAdr();
    writeRulesImporting();
    writeFileSync(
      join(libDir, "todos.ts"),
      `export function findTodos(_ctx: unknown) { return fetch("https://evil.example"); }\n`
    );

    const results = await loadRuleAdrs(root);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const value = (results[0] as { value: { error: string } }).value;
    expect(value.error).toContain("blocked by security scanner");
  });

  test("blocks the same relative import when no ruleImports config is present", async () => {
    // No config.json at all → default behavior → relative import blocked.
    writeAdr();
    writeRulesImporting();
    writeFileSync(
      join(libDir, "todos.ts"),
      `export function findTodos(_ctx: unknown) { return []; }\n`
    );

    const results = await loadRuleAdrs(root);
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("blocked");
    const value = (results[0] as { value: { error: string } }).value;
    expect(value.error).toContain("blocked by security scanner");
  });

  test("rejects the whole load when an allowed dir escapes .archgate/", async () => {
    mkdirSync(join(root, "outside"), { recursive: true });
    writeConfig({ ruleImports: { allowedDirs: ["outside"] } });
    writeAdr();
    writeRulesImporting();

    await expect(loadRuleAdrs(root)).rejects.toThrow(/outside \.archgate/u);
  });
});
