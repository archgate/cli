// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Framework detection and caching tests — split from stack-detect.test.ts to
// stay under the 500-line lint limit.
// ---------------------------------------------------------------------------

import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectStack } from "../../src/helpers/stack-detect";
import { safeRmSync } from "../test-utils";

describe("detectStack — frameworks", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  // ---------------------------------------------------------------------------
  // JS/TS dependency-based
  // ---------------------------------------------------------------------------

  test("detects Express from package.json dependencies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { express: "^4" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("express");
  });

  test("detects Vue from package.json dependencies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { vue: "^3" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("vue");
  });

  test("detects Angular from @angular/core", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "@angular/core": "^17" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("angular");
  });

  test("detects Solid from solid-js", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "solid-js": "^1" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("solid");
  });

  test("detects NestJS from @nestjs/core", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "@nestjs/core": "^10" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("nestjs");
  });

  test("detects Koa", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { koa: "^2" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("koa");
  });

  test("detects Elysia", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { elysia: "^1" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("elysia");
  });

  // ---------------------------------------------------------------------------
  // Tailwind, MUI, TanStack
  // ---------------------------------------------------------------------------

  test("detects Tailwind CSS from tailwind.config.ts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "t" }));
    writeFileSync(join(tempDir, "tailwind.config.ts"), "export default {}");
    expect((await detectStack(tempDir)).frameworks).toContain("tailwindcss");
  });

  test("detects MUI from @mui/material", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "@mui/material": "^5" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("mui");
  });

  test("detects TanStack Query from @tanstack/react-query", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "t",
        dependencies: { "@tanstack/react-query": "^5" },
      })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("tanstack-query");
  });

  test("detects TanStack Router", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "t",
        dependencies: { "@tanstack/react-router": "^1" },
      })
    );
    expect((await detectStack(tempDir)).frameworks).toContain(
      "tanstack-router"
    );
  });

  test("detects TanStack Start", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { "@tanstack/start": "^1" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("tanstack-start");
  });

  test("detects TanStack Form", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "t",
        dependencies: { "@tanstack/react-form": "^0" },
      })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("tanstack-form");
  });

  // ---------------------------------------------------------------------------
  // Non-JS ecosystems
  // ---------------------------------------------------------------------------

  test("detects Rails from bin/rails", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Gemfile"), 'gem "rails"');
    mkdirSync(join(tempDir, "bin"), { recursive: true });
    writeFileSync(join(tempDir, "bin", "rails"), "#!/usr/bin/env ruby");
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("ruby");
    expect(s.frameworks).toContain("rails");
  });

  test("detects Rails from config/routes.rb", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "Gemfile"), 'gem "rails"');
    mkdirSync(join(tempDir, "config"), { recursive: true });
    writeFileSync(join(tempDir, "config", "routes.rb"), "Rails.routes {}");
    expect((await detectStack(tempDir)).frameworks).toContain("rails");
  });

  test("detects Django from manage.py", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "pyproject.toml"), "[project]\nname = 't'");
    writeFileSync(join(tempDir, "manage.py"), "#!/usr/bin/env python");
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("python");
    expect(s.frameworks).toContain("django");
  });

  test("detects Laravel from artisan file", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "composer.json"), '{"name":"v/p"}');
    writeFileSync(join(tempDir, "artisan"), "#!/usr/bin/env php");
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("php");
    expect(s.frameworks).toContain("laravel");
  });

  test("detects Flutter from pubspec.yaml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "pubspec.yaml"),
      "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n"
    );
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("dart");
    expect(s.frameworks).toContain("flutter");
  });

  test("does not detect Flutter for plain Dart", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "pubspec.yaml"), "name: cli\ndependencies:\n");
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("dart");
    expect(s.frameworks).not.toContain("flutter");
  });

  test("detects Phoenix from mix.exs", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "mix.exs"),
      'defmodule App do\n  [{:phoenix, "~> 1.7"}]\nend'
    );
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("elixir");
    expect(s.frameworks).toContain("phoenix");
  });

  test("does not detect Phoenix for plain Elixir", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "mix.exs"), "defmodule App do\nend");
    const s = await detectStack(tempDir);
    expect(s.languages).toContain("elixir");
    expect(s.frameworks).not.toContain("phoenix");
  });

  // ---------------------------------------------------------------------------
  // Python frameworks (FastAPI, Streamlit, Flask)
  // ---------------------------------------------------------------------------

  test("detects FastAPI from requirements.txt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "requirements.txt"), "fastapi>=0.100\n");
    expect((await detectStack(tempDir)).frameworks).toContain("fastapi");
  });

  test("detects Streamlit from requirements.txt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "requirements.txt"), "streamlit==1.30.0\n");
    expect((await detectStack(tempDir)).frameworks).toContain("streamlit");
  });

  test("detects FastAPI from pyproject.toml", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "pyproject.toml"),
      '[project]\nname = "api"\ndependencies = ["fastapi>=0.100"]\n'
    );
    expect((await detectStack(tempDir)).frameworks).toContain("fastapi");
  });

  test("detects Flask from requirements.txt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(join(tempDir, "requirements.txt"), "flask==3.0.0\n");
    expect((await detectStack(tempDir)).frameworks).toContain("flask");
  });

  // ---------------------------------------------------------------------------
  // Testing & tooling
  // ---------------------------------------------------------------------------

  test("detects Prisma from devDependencies", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", devDependencies: { prisma: "^5" } })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("prisma");
  });

  test("detects Playwright from @playwright/test", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "t",
        devDependencies: { "@playwright/test": "^1" },
      })
    );
    expect((await detectStack(tempDir)).frameworks).toContain("playwright");
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe("detectStack — caching", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  test("returns cached result on second call with unchanged files", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { express: "^4" } })
    );

    const first = await detectStack(tempDir);
    await Bun.sleep(50);
    const second = await detectStack(tempDir);

    expect(first).toEqual(second);
    expect(second.frameworks).toContain("express");
  });

  test("invalidates cache when a sentinel file changes", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "t", dependencies: { express: "^4" } })
    );

    const first = await detectStack(tempDir);
    await Bun.sleep(50);

    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({
        name: "t",
        dependencies: { express: "^4", react: "^18" },
      })
    );

    const second = await detectStack(tempDir);
    expect(first.frameworks).not.toContain("react");
    expect(second.frameworks).toContain("react");
  });
});
