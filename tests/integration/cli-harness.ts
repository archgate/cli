// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * Integration test harness — runs the real CLI via Bun.spawn
 * against isolated temp project directories.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dir, "..", "..", "src", "cli.ts");

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a CLI command in the given project directory.
 * Returns captured stdout, stderr, and exit code.
 */
export async function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NO_COLOR: "1",
      CI: "1",
      ARCHGATE_TELEMETRY: "0",
      ...env,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Create an isolated temp project directory with optional .archgate scaffold.
 */
export function createTempProject(prefix = "archgate-integ-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Initialize a minimal .archgate project in the given directory.
 * Includes the adrs/ and lint/ directories.
 */
export function scaffoldProject(dir: string): void {
  mkdirSync(join(dir, ".archgate", "adrs"), { recursive: true });
  mkdirSync(join(dir, ".archgate", "lint"), { recursive: true });
}

/**
 * Write an ADR markdown file to the project's adrs directory.
 */
export function writeAdr(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, ".archgate", "adrs", filename), content);
}

/**
 * Write a companion .rules.ts file to the project's adrs directory.
 * Automatically wraps the content with required syntax conventions
 * (triple-slash reference + satisfies RuleSet) if missing.
 */
export function writeRules(
  dir: string,
  filename: string,
  content: string
): void {
  let wrapped = content;
  if (!content.includes("/// <reference")) {
    wrapped = `/// <reference path="../rules.d.ts" />\n\n${wrapped}`;
  }
  if (!content.includes("satisfies RuleSet")) {
    wrapped = wrapped.trimEnd().replace(/\};\s*$/u, "} satisfies RuleSet;\n");
  }
  writeFileSync(join(dir, ".archgate", "adrs", filename), wrapped);
}

/**
 * Build a minimal ADR markdown string.
 */
export function makeAdr(opts: {
  id: string;
  title: string;
  domain?: string;
  rules?: boolean;
  files?: string[];
  body?: string;
}): string {
  const fm = [
    "---",
    `id: ${opts.id}`,
    `title: ${opts.title}`,
    `domain: ${opts.domain ?? "general"}`,
    `rules: ${opts.rules ?? false}`,
  ];
  if (opts.files) {
    fm.push(`files: ${JSON.stringify(opts.files)}`);
  }
  fm.push("---");
  if (opts.body) fm.push("", opts.body);
  return fm.join("\n") + "\n";
}
