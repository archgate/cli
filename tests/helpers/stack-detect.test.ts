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

  // ---------------------------------------------------------------------------
  // Languages — JS / TS
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Languages — Python, Go, Rust
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Languages — Ruby, Java, PHP, Swift, Elixir, Dart, C#, Scala, Zig
  // ---------------------------------------------------------------------------

  test("detects Ruby from Gemfile", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Gemfile"), 'source "https://rubygems.org"');

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("ruby");
  });

  test("detects Ruby from .ruby-version", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, ".ruby-version"), "3.3.0");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("ruby");
  });

  test("detects Java from pom.xml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "pom.xml"), "<project></project>");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("java");
  });

  test("detects Java from build.gradle", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "build.gradle"), "plugins {}");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("java");
  });

  test("detects Java from build.gradle.kts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "build.gradle.kts"), "plugins {}");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("java");
  });

  test("detects PHP from composer.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "composer.json"),
      JSON.stringify({ name: "vendor/pkg" })
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("php");
  });

  test("detects Swift from Package.swift", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Package.swift"), "// swift-tools-version:5.9");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("swift");
  });

  test("detects Elixir from mix.exs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "mix.exs"),
      "defmodule MyApp.MixProject do\nend"
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("elixir");
  });

  test("detects Dart from pubspec.yaml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "pubspec.yaml"), "name: my_app");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("dart");
  });

  test("detects C# from global.json", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "global.json"),
      JSON.stringify({ sdk: { version: "8.0.0" } })
    );

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("csharp");
  });

  test("detects C# from Directory.Build.props", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Directory.Build.props"), "<Project />");

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("csharp");
  });

  test("detects Scala from build.sbt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "build.sbt"), 'name := "my-app"');

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("scala");
  });

  test("detects Zig from build.zig", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "build.zig"), 'const std = @import("std");');

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("zig");
  });

  // ---------------------------------------------------------------------------
  // Runtimes
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Frameworks — JS/TS config-file-based
  // ---------------------------------------------------------------------------

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

  test("detects Vite framework from vite.config.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "vite.config.ts"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("vite");
  });

  test("detects Nuxt framework from nuxt.config.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "nuxt.config.ts"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("nuxt");
  });

  test("detects Astro framework from astro.config.mjs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "astro.config.mjs"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("astro");
  });

  test("detects Svelte from svelte.config.js", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "svelte.config.js"), "export default {}");

    const stack = await detectStack(tempDir);
    expect(stack.frameworks).toContain("svelte");
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

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
    writeFileSync(join(tempDir, "Gemfile"), 'source "https://rubygems.org"');

    const stack = await detectStack(tempDir);
    expect(stack.languages).toContain("typescript");
    expect(stack.languages).toContain("go");
    expect(stack.languages).toContain("python");
    expect(stack.languages).toContain("ruby");
  });
});
