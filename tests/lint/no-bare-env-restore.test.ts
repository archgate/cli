// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test } from "bun:test";

import plugin from "../../lint/no-bare-env-restore";
import { parseJsModule } from "../../src/engine/js-parser";

/** Minimal ESTree-ish node shape, matching the plugin's own definition. */
type AstNode = { type: string } & Record<string, unknown>;

interface ReportedViolation {
  message: string;
}

/**
 * Run the `test-isolation/no-bare-env-restore` rule against a source
 * snippet and return every reported violation. Parses via the same
 * sanctioned in-process `meriyah` entry point (`parseJsModule`, ARCH-022)
 * the engine itself uses, rather than hand-authoring AST fixtures.
 */
function lint(source: string): ReportedViolation[] {
  const program = parseJsModule(source) as unknown as AstNode;
  const violations: ReportedViolation[] = [];
  const rule = plugin.rules["no-bare-env-restore"];
  const visitor = rule.create({
    report({ message }) {
      violations.push({ message });
    },
  });
  visitor.Program(program);
  return violations;
}

describe("no-bare-env-restore", () => {
  test("flags a same-scope, same-key bare restore", () => {
    const violations = lint(`
      const originalHome = Bun.env.HOME;
      Bun.env.HOME = originalHome;
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain(
      'restoreEnv("HOME", originalHome)'
    );
  });

  test("flags a same-key restore split across sibling closures (capture in one, restore in another)", () => {
    // The idiomatic beforeEach/afterEach shape: the capture is a bare
    // reassignment inside one arrow function, resolving to a `let` declared
    // in the shared enclosing scope; the restore reads it back inside a
    // second, sibling arrow function.
    const violations = lint(`
      describe("suite", () => {
        let originalHome;
        beforeEach(() => {
          originalHome = Bun.env.HOME;
        });
        afterEach(() => {
          Bun.env.HOME = originalHome;
        });
      });
    `);
    expect(violations).toHaveLength(1);
  });

  test("does not flag process.env alongside Bun.env", () => {
    const violations = lint(`
      const originalPath = process.env.PATH;
      process.env.PATH = originalPath;
    `);
    expect(violations).toHaveLength(1);
  });

  test("does not flag a cross-key override (issue archgate/cli#498)", () => {
    // `originalHome` was captured from HOME, not PATH — assigning it into a
    // DIFFERENT key is an override, not a restore of the captured key.
    const violations = lint(`
      const originalHome = Bun.env.HOME;
      Bun.env.PATH = originalHome;
    `);
    expect(violations).toHaveLength(0);
  });

  test("does not flag a shadowed binding that never held an env value (issue archgate/cli#498)", () => {
    // The inner `originalHome` shadows the outer capture and is never
    // itself read from `Bun.env` — restoring from it is not a leak.
    const violations = lint(`
      const originalHome = Bun.env.HOME;
      function helper() {
        const originalHome = "some-other-value";
        Bun.env.HOME = originalHome;
      }
    `);
    expect(violations).toHaveLength(0);
  });

  test("does not flag an override with an unrelated literal-sourced variable", () => {
    const violations = lint(`
      const tempDir = "/tmp/archgate-test";
      Bun.env.HOME = tempDir;
    `);
    expect(violations).toHaveLength(0);
  });

  test("does not flag computed access, the shape restoreEnv itself uses", () => {
    const violations = lint(`
      const key = "HOME";
      const original = Bun.env[key];
      Bun.env[key] = original;
    `);
    expect(violations).toHaveLength(0);
  });

  test("does not flag two same-named bindings in unrelated sibling scopes", () => {
    // Neither `originalHome` ever captures an env value, so even though the
    // names match across the two functions, there is nothing to restore.
    const violations = lint(`
      function first() {
        const originalHome = "a";
        Bun.env.HOME = originalHome;
      }
      function second() {
        const originalHome = "b";
        Bun.env.HOME = originalHome;
      }
    `);
    expect(violations).toHaveLength(0);
  });
});
