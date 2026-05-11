// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectStack } from "../../src/helpers/stack-detect";
import { safeRmSync } from "../test-utils";

describe("detectStack", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  test("detects TypeScript from tsconfig.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "tsconfig.json"), "{}");
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test" })
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("typescript");
    expect(stack.languages).not.toContain("javascript");
    expect(stack.runtimes).toContain("node");
  });

  test("detects TypeScript from devDependencies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "test",
        devDependencies: { typescript: "^5.0.0" },
      })
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("typescript");
    expect(stack.languages).not.toContain("javascript");
  });

  test("detects JavaScript when package.json exists without TypeScript", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test" })
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("javascript");
    expect(stack.languages).not.toContain("typescript");
  });

  test("detects Python from pyproject.toml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]\nname = 'test'");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("python");
  });

  test("detects Python from requirements.txt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "requirements.txt"), "flask==2.0.0");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("python");
  });

  test("detects Go from go.mod", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "go.mod"), "module example.com/test");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("go");
  });

  test("detects Rust from Cargo.toml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Cargo.toml"), '[package]\nname = "test"');

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("rust");
  });

  test("detects Bun runtime from bun.lock", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "bun.lock"), "# bun lockfile");

    const stack = await detectStack(tempDir);
    expect(stack.runtimes).toContain("bun");
    expect(stack.runtimes).toContain("node");
  });

  test("detects Deno runtime from deno.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "deno.json"), "{}");

    const stack = await detectStack(tempDir);
    expect(stack.runtimes).toContain("deno");
  });

  test("detects Next.js framework from next.config.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { react: "^18" } })
    );
    writeFileSync(join(tempDir, "next.config.ts"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("nextjs");
    expect(stack.frameworks).toContain("react");
  });

  test("detects Express framework from package.json dependencies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test", dependencies: { express: "^4.0.0" } })
    );

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("express");
  });

  test("detects Vite framework from vite.config.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "vite.config.ts"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("vite");
  });

  test("returns empty arrays for empty directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));

    const stack = await detectStack(tempDir);
    expect(stack.languages).toEqual([]);
    expect(stack.runtimes).toEqual([]);
    expect(stack.frameworks).toEqual([]);
  });

  test("detects multiple languages in a polyglot project", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "tsconfig.json"), "{}");
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "test" })
    );
    writeFileSync(join(tempDir, "go.mod"), "module example.com/test");
    writeFileSync(join(tempDir, "requirements.txt"), "flask");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("typescript");
    expect(stack.languages).toContain("go");
    expect(stack.languages).toContain("python");
  });
});
