// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// ---------------------------------------------------------------------------
// Framework detection and caching tests. They live apart from
// stack-detect.test.ts so each file stays under the 500-line lint limit.
// ---------------------------------------------------------------------------

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectStack } from "../../src/helpers/stack-detect";
import { safeRmSync } from "../test-utils";

describe("detectStack — frameworks", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "archgate-stack-"));
  });

  afterEach(() => {
    if (tempDir) safeRmSync(tempDir);
  });

  // ---------------------------------------------------------------------------
  // Single-signal framework detections: write one fixture, expect one
  // framework to show up in `frameworks`.
  // ---------------------------------------------------------------------------

  const packageJsonWith =
    (
      deps: Record<string, string>,
      key: "dependencies" | "devDependencies" = "dependencies"
    ) =>
    (dir: string) => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "t", [key]: deps })
      );
    };

  const frameworkCases: Array<{
    name: string;
    setup: (dir: string) => void;
    framework: string;
  }> = [
    {
      name: "Express from package.json dependencies",
      setup: packageJsonWith({ express: "^4" }),
      framework: "express",
    },
    {
      name: "Vue from package.json dependencies",
      setup: packageJsonWith({ vue: "^3" }),
      framework: "vue",
    },
    {
      name: "Angular from @angular/core",
      setup: packageJsonWith({ "@angular/core": "^17" }),
      framework: "angular",
    },
    {
      name: "Solid from solid-js",
      setup: packageJsonWith({ "solid-js": "^1" }),
      framework: "solid",
    },
    {
      name: "NestJS from @nestjs/core",
      setup: packageJsonWith({ "@nestjs/core": "^10" }),
      framework: "nestjs",
    },
    { name: "Koa", setup: packageJsonWith({ koa: "^2" }), framework: "koa" },
    {
      name: "Elysia",
      setup: packageJsonWith({ elysia: "^1" }),
      framework: "elysia",
    },
    {
      name: "Tailwind CSS from tailwind.config.ts",
      setup: (dir) => {
        writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "t" }));
        writeFileSync(join(dir, "tailwind.config.ts"), "export default {}");
      },
      framework: "tailwindcss",
    },
    {
      name: "MUI from @mui/material",
      setup: packageJsonWith({ "@mui/material": "^5" }),
      framework: "mui",
    },
    {
      name: "TanStack Query from @tanstack/react-query",
      setup: packageJsonWith({ "@tanstack/react-query": "^5" }),
      framework: "tanstack-query",
    },
    {
      name: "TanStack Router",
      setup: packageJsonWith({ "@tanstack/react-router": "^1" }),
      framework: "tanstack-router",
    },
    {
      name: "TanStack Start",
      setup: packageJsonWith({ "@tanstack/start": "^1" }),
      framework: "tanstack-start",
    },
    {
      name: "TanStack Form",
      setup: packageJsonWith({ "@tanstack/react-form": "^0" }),
      framework: "tanstack-form",
    },
    {
      name: "FastAPI from requirements.txt",
      setup: (dir) =>
        writeFileSync(join(dir, "requirements.txt"), "fastapi>=0.100\n"),
      framework: "fastapi",
    },
    {
      name: "Streamlit from requirements.txt",
      setup: (dir) =>
        writeFileSync(join(dir, "requirements.txt"), "streamlit==1.30.0\n"),
      framework: "streamlit",
    },
    {
      name: "FastAPI from pyproject.toml",
      setup: (dir) =>
        writeFileSync(
          join(dir, "pyproject.toml"),
          '[project]\nname = "api"\ndependencies = ["fastapi>=0.100"]\n'
        ),
      framework: "fastapi",
    },
    {
      name: "Flask from requirements.txt",
      setup: (dir) =>
        writeFileSync(join(dir, "requirements.txt"), "flask==3.0.0\n"),
      framework: "flask",
    },
    {
      name: "Prisma from devDependencies",
      setup: packageJsonWith({ prisma: "^5" }, "devDependencies"),
      framework: "prisma",
    },
    {
      name: "Playwright from @playwright/test",
      setup: packageJsonWith({ "@playwright/test": "^1" }, "devDependencies"),
      framework: "playwright",
    },
  ];

  test.each(frameworkCases)("detects $name", async ({ setup, framework }) => {
    setup(tempDir);
    expect((await detectStack(tempDir)).frameworks).toContain(framework);
  });

  // ---------------------------------------------------------------------------
  // Non-JS ecosystems: these also assert on detected `languages`, and a
  // couple assert a framework is deliberately *not* detected without the
  // framework's own marker file present.
  // ---------------------------------------------------------------------------

  const ecosystemCases: Array<{
    name: string;
    setup: (dir: string) => void;
    language?: string;
    framework?: string;
    notFramework?: string;
  }> = [
    {
      name: "Rails from bin/rails",
      setup: (dir) => {
        writeFileSync(join(dir, "Gemfile"), 'gem "rails"');
        mkdirSync(join(dir, "bin"), { recursive: true });
        writeFileSync(join(dir, "bin", "rails"), "#!/usr/bin/env ruby");
      },
      language: "ruby",
      framework: "rails",
    },
    {
      name: "Rails from config/routes.rb",
      setup: (dir) => {
        writeFileSync(join(dir, "Gemfile"), 'gem "rails"');
        mkdirSync(join(dir, "config"), { recursive: true });
        writeFileSync(join(dir, "config", "routes.rb"), "Rails.routes {}");
      },
      framework: "rails",
    },
    {
      name: "Django from manage.py",
      setup: (dir) => {
        writeFileSync(join(dir, "pyproject.toml"), "[project]\nname = 't'");
        writeFileSync(join(dir, "manage.py"), "#!/usr/bin/env python");
      },
      language: "python",
      framework: "django",
    },
    {
      name: "Laravel from artisan file",
      setup: (dir) => {
        writeFileSync(join(dir, "composer.json"), '{"name":"v/p"}');
        writeFileSync(join(dir, "artisan"), "#!/usr/bin/env php");
      },
      language: "php",
      framework: "laravel",
    },
    {
      name: "Flutter from pubspec.yaml",
      setup: (dir) => {
        writeFileSync(
          join(dir, "pubspec.yaml"),
          "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n"
        );
      },
      language: "dart",
      framework: "flutter",
    },
    {
      name: "does not detect Flutter for plain Dart",
      setup: (dir) => {
        writeFileSync(join(dir, "pubspec.yaml"), "name: cli\ndependencies:\n");
      },
      language: "dart",
      notFramework: "flutter",
    },
    {
      name: "Phoenix from mix.exs",
      setup: (dir) => {
        writeFileSync(
          join(dir, "mix.exs"),
          'defmodule App do\n  [{:phoenix, "~> 1.7"}]\nend'
        );
      },
      language: "elixir",
      framework: "phoenix",
    },
    {
      name: "does not detect Phoenix for plain Elixir",
      setup: (dir) => {
        writeFileSync(join(dir, "mix.exs"), "defmodule App do\nend");
      },
      language: "elixir",
      notFramework: "phoenix",
    },
  ];

  test.each(ecosystemCases)(
    "$name",
    async ({ setup, language, framework, notFramework }) => {
      setup(tempDir);
      const s = await detectStack(tempDir);
      if (language) expect(s.languages).toContain(language);
      if (framework) expect(s.frameworks).toContain(framework);
      if (notFramework) expect(s.frameworks).not.toContain(notFramework);
    }
  );
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
