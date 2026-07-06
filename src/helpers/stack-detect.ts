// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { existsSync } from "node:fs";
import { join } from "node:path";

import { logDebug } from "./log";

export interface DetectedStack {
  languages: string[];
  runtimes: string[];
  frameworks: string[];
}

/** Config file extensions commonly used by JS/TS frameworks. */
const JS_CONFIG_EXTENSIONS = ["js", "cjs", "mjs", "ts", "mts", "cts"];

/** Check whether any of `<basename>.<ext>` exists in `dir`. */
function hasConfig(dir: string, basename: string, exts: string[]): boolean {
  return exts.some((ext) => existsSync(join(dir, `${basename}.${ext}`)));
}

/**
 * Detect the project's language, runtime, and framework from files present
 * in the project root. Used by the greenfield wizard to recommend packs and
 * by telemetry to track ecosystem adoption.
 */
export async function detectStack(projectRoot: string): Promise<DetectedStack> {
  const languages: string[] = [];
  const runtimes: string[] = [];
  const frameworks: string[] = [];

  const pkgJsonPath = join(projectRoot, "package.json");
  const hasPkgJson = existsSync(pkgJsonPath);
  let pkgJson: Record<string, unknown> | null = null;

  if (hasPkgJson) {
    try {
      pkgJson = (await Bun.file(pkgJsonPath).json()) as Record<string, unknown>;
    } catch {
      logDebug("Failed to parse package.json");
    }
  }

  const deps = {
    ...(pkgJson?.dependencies as Record<string, string> | undefined),
    ...(pkgJson?.devDependencies as Record<string, string> | undefined),
  };

  // --- Languages ---

  // TypeScript / JavaScript (mutually exclusive — TS wins when both present)
  const hasTsConfig = existsSync(join(projectRoot, "tsconfig.json"));
  const hasTsDep = Boolean(deps.typescript);
  if (hasTsConfig || hasTsDep) {
    languages.push("typescript");
  } else if (hasPkgJson) {
    languages.push("javascript");
  }

  if (
    existsSync(join(projectRoot, "pyproject.toml")) ||
    existsSync(join(projectRoot, "requirements.txt")) ||
    existsSync(join(projectRoot, "setup.py"))
  ) {
    languages.push("python");
  }

  if (existsSync(join(projectRoot, "go.mod"))) {
    languages.push("go");
  }

  if (existsSync(join(projectRoot, "Cargo.toml"))) {
    languages.push("rust");
  }

  if (
    existsSync(join(projectRoot, "Gemfile")) ||
    existsSync(join(projectRoot, ".ruby-version"))
  ) {
    languages.push("ruby");
  }

  if (
    existsSync(join(projectRoot, "pom.xml")) ||
    existsSync(join(projectRoot, "build.gradle")) ||
    existsSync(join(projectRoot, "build.gradle.kts"))
  ) {
    languages.push("java");
  }

  if (existsSync(join(projectRoot, "composer.json"))) {
    languages.push("php");
  }

  if (existsSync(join(projectRoot, "Package.swift"))) {
    languages.push("swift");
  }

  if (existsSync(join(projectRoot, "mix.exs"))) {
    languages.push("elixir");
  }

  if (existsSync(join(projectRoot, "pubspec.yaml"))) {
    languages.push("dart");
  }

  if (
    existsSync(join(projectRoot, "global.json")) ||
    existsSync(join(projectRoot, "Directory.Build.props"))
  ) {
    languages.push("csharp");
  }

  if (existsSync(join(projectRoot, "build.sbt"))) {
    languages.push("scala");
  }

  if (existsSync(join(projectRoot, "build.zig"))) {
    languages.push("zig");
  }

  // --- Runtimes ---

  if (hasPkgJson) {
    runtimes.push("node");
  }

  if (
    existsSync(join(projectRoot, "bun.lock")) ||
    existsSync(join(projectRoot, "bunfig.toml"))
  ) {
    runtimes.push("bun");
  }

  if (
    existsSync(join(projectRoot, "deno.json")) ||
    existsSync(join(projectRoot, "deno.jsonc"))
  ) {
    runtimes.push("deno");
  }

  // --- Frameworks ---

  // JS/TS config-file-based detection
  if (
    hasConfig(projectRoot, "next.config", [...JS_CONFIG_EXTENSIONS, "json"])
  ) {
    frameworks.push("nextjs");
  }

  if (hasConfig(projectRoot, "remix.config", JS_CONFIG_EXTENSIONS)) {
    frameworks.push("remix");
  }

  if (hasConfig(projectRoot, "vite.config", JS_CONFIG_EXTENSIONS)) {
    frameworks.push("vite");
  }

  if (hasConfig(projectRoot, "nuxt.config", JS_CONFIG_EXTENSIONS)) {
    frameworks.push("nuxt");
  }

  if (hasConfig(projectRoot, "astro.config", JS_CONFIG_EXTENSIONS)) {
    frameworks.push("astro");
  }

  if (hasConfig(projectRoot, "svelte.config", ["js", "cjs", "mjs"])) {
    frameworks.push("svelte");
  }

  // JS/TS dependency-based detection
  if (deps.react) frameworks.push("react");
  if (deps.vue) frameworks.push("vue");
  if (deps["solid-js"]) frameworks.push("solid");
  if (deps["@angular/core"]) frameworks.push("angular");
  if (deps["ember-source"]) frameworks.push("ember");
  if (deps.express) frameworks.push("express");
  if (deps.fastify) frameworks.push("fastify");
  if (deps.hono) frameworks.push("hono");
  if (deps.koa) frameworks.push("koa");
  if (deps.elysia) frameworks.push("elysia");
  if (deps["@nestjs/core"]) frameworks.push("nestjs");
  if (deps.gatsby) frameworks.push("gatsby");

  // Ruby — Rails detection via conventional directory structure
  if (
    existsSync(join(projectRoot, "bin", "rails")) ||
    existsSync(join(projectRoot, "config", "routes.rb"))
  ) {
    frameworks.push("rails");
  }

  // Python — Django detection via manage.py
  if (existsSync(join(projectRoot, "manage.py"))) {
    frameworks.push("django");
  }

  // PHP — Laravel detection via artisan
  if (existsSync(join(projectRoot, "artisan"))) {
    frameworks.push("laravel");
  }

  // Dart — Flutter detection via pubspec.yaml flutter dependency
  if (existsSync(join(projectRoot, "pubspec.yaml"))) {
    try {
      const pubspec = await Bun.file(join(projectRoot, "pubspec.yaml")).text();
      if (/^\s*flutter:/mu.test(pubspec)) {
        frameworks.push("flutter");
      }
    } catch {
      logDebug("Failed to read pubspec.yaml");
    }
  }

  // Elixir — Phoenix detection via mix.exs phoenix dependency
  if (existsSync(join(projectRoot, "mix.exs"))) {
    try {
      const mixContent = await Bun.file(join(projectRoot, "mix.exs")).text();
      if (/:phoenix\b/u.test(mixContent)) {
        frameworks.push("phoenix");
      }
    } catch {
      logDebug("Failed to read mix.exs");
    }
  }

  logDebug("Detected stack:", { languages, runtimes, frameworks });

  return { languages, runtimes, frameworks };
}
