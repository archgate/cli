// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { logDebug } from "./log";
import { internalPath } from "./paths";

export interface DetectedStack {
  languages: string[];
  runtimes: string[];
  frameworks: string[];
}

const DetectedStackSchema = z.object({
  languages: z.array(z.string()),
  runtimes: z.array(z.string()),
  frameworks: z.array(z.string()),
});

const StackCacheSchema = z.object({
  fingerprint: z.string(),
  stack: DetectedStackSchema,
});

/** Loose schema for the subset of package.json we inspect. */
const PackageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});

/** PEP 621 pyproject.toml — only the [project].dependencies list. */
const PyprojectSchema = z.object({
  project: z
    .object({ dependencies: z.array(z.string()).optional() })
    .optional(),
});

/** Config file extensions commonly used by JS/TS frameworks. */
const JS_CONFIG_EXTENSIONS = ["js", "cjs", "mjs", "ts", "mts", "cts"];

/** Check whether any of `<basename>.<ext>` exists in `dir`. */
function hasConfig(dir: string, basename: string, exts: string[]): boolean {
  return exts.some((ext) => existsSync(join(dir, `${basename}.${ext}`)));
}

// ---------------------------------------------------------------------------
// Sentinel-based disk cache
// ---------------------------------------------------------------------------

/**
 * Files whose presence/absence or modification signals a stack change.
 * Covers every marker that detectStackUncached() inspects so cached
 * results stay fresh. Adding a file here is cheap (~0.05ms per stat).
 */
const SENTINEL_FILES = [
  // Languages
  "package.json",
  "tsconfig.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
  ".ruby-version",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Package.swift",
  "mix.exs",
  "pubspec.yaml",
  "global.json",
  "Directory.Build.props",
  "build.sbt",
  "build.zig",
  // Runtimes
  "bun.lock",
  "bunfig.toml",
  "deno.json",
  "deno.jsonc",
  // Frameworks — config files
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "remix.config.ts",
  "remix.config.js",
  "vite.config.ts",
  "vite.config.js",
  "nuxt.config.ts",
  "nuxt.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "svelte.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  // Frameworks — non-JS markers
  "manage.py",
  "artisan",
  "bin/rails",
  "config/routes.rb",
];

type StackCache = z.infer<typeof StackCacheSchema>;

/**
 * Build a fingerprint from sentinel file stats. Two projects with identical
 * sentinel states produce the same fingerprint. This is fast — ~20 stat
 * syscalls (~1ms total) vs the full detection scan (~10ms).
 */
function buildFingerprint(projectRoot: string): string {
  const parts: string[] = [];
  for (const file of SENTINEL_FILES) {
    try {
      const st = statSync(join(projectRoot, file));
      parts.push(`${file}:${st.mtimeMs}`);
    } catch {
      parts.push(`${file}:-`);
    }
  }
  return createHash("sha256")
    .update(parts.join("|"))
    .digest("hex")
    .slice(0, 16);
}

/** Stable short hash of the project root path for cache filename. */
function projectHash(projectRoot: string): string {
  return createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
}

function getCachePath(projectRoot: string): string {
  return internalPath("cache", `stack-${projectHash(projectRoot)}.json`);
}

async function readCache(projectRoot: string): Promise<StackCache | null> {
  const cachePath = getCachePath(projectRoot);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = await Bun.file(cachePath).json();
    const result = StackCacheSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function writeCache(
  projectRoot: string,
  fingerprint: string,
  stack: DetectedStack
): Promise<void> {
  const cachePath = getCachePath(projectRoot);
  try {
    const data: StackCache = { fingerprint, stack };
    // Bun.write() auto-creates parent directories since Bun v1.0.16
    await Bun.write(cachePath, JSON.stringify(data));
    logDebug("Stack cache written:", cachePath);
  } catch {
    logDebug("Failed to write stack cache (ignored)");
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the project's language, runtime, and framework from files present
 * in the project root. Results are cached to disk and invalidated when any
 * sentinel file (package.json, Gemfile, go.mod, etc.) is added, removed, or
 * modified. Typical cached lookup: ~1ms; full detection: ~5-10ms.
 */
export async function detectStack(projectRoot: string): Promise<DetectedStack> {
  const fingerprint = buildFingerprint(projectRoot);

  // Check disk cache
  const cached = await readCache(projectRoot);
  if (cached && cached.fingerprint === fingerprint) {
    logDebug("Stack cache hit for", projectRoot);
    return cached.stack;
  }

  logDebug("Stack cache miss — running full detection");
  const stack = await detectStackUncached(projectRoot);

  // Write cache in the background — don't block the caller
  writeCache(projectRoot, fingerprint, stack).catch(() => {});

  return stack;
}

/**
 * Run the full stack detection without caching. Exported for testing and
 * for callers that need a fresh read (e.g. after `archgate init` modifies
 * the project).
 */
export async function detectStackUncached(
  projectRoot: string
): Promise<DetectedStack> {
  const languages: string[] = [];
  const runtimes: string[] = [];
  const frameworks: string[] = [];

  const pkgJsonPath = join(projectRoot, "package.json");
  const hasPkgJson = existsSync(pkgJsonPath);
  let pkgJson: z.infer<typeof PackageJsonSchema> | null = null;

  if (hasPkgJson) {
    try {
      const raw = await Bun.file(pkgJsonPath).json();
      const result = PackageJsonSchema.safeParse(raw);
      pkgJson = result.success ? result.data : null;
    } catch {
      logDebug("Failed to parse package.json");
    }
  }

  const deps: Record<string, string> = {
    ...pkgJson?.dependencies,
    ...pkgJson?.devDependencies,
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

  if (
    hasConfig(projectRoot, "tailwind.config", JS_CONFIG_EXTENSIONS) ||
    existsSync(join(projectRoot, "tailwind.config.json"))
  ) {
    frameworks.push("tailwindcss");
  }

  // JS/TS dependency-based detection — UI frameworks & libraries
  if (deps.react) frameworks.push("react");
  if (deps.vue) frameworks.push("vue");
  if (deps["solid-js"]) frameworks.push("solid");
  if (deps["@angular/core"]) frameworks.push("angular");
  if (deps["ember-source"]) frameworks.push("ember");
  if (deps["@mui/material"]) frameworks.push("mui");
  if (deps["@tanstack/react-query"] || deps["@tanstack/vue-query"])
    frameworks.push("tanstack-query");
  if (deps["@tanstack/react-router"] || deps["@tanstack/router"])
    frameworks.push("tanstack-router");
  if (deps["@tanstack/start"]) frameworks.push("tanstack-start");
  if (deps["@tanstack/react-form"] || deps["@tanstack/form"])
    frameworks.push("tanstack-form");
  if (deps["@tanstack/react-table"] || deps["@tanstack/table"])
    frameworks.push("tanstack-table");
  if (deps["@chakra-ui/react"]) frameworks.push("chakra-ui");
  if (deps["@shadcn/ui"] || deps["shadcn-ui"]) frameworks.push("shadcn");
  if (deps["@headlessui/react"] || deps["@headlessui/vue"])
    frameworks.push("headless-ui");
  if (deps["@radix-ui/react-slot"] || deps["@radix-ui/themes"])
    frameworks.push("radix");

  // JS/TS dependency-based detection — server frameworks
  if (deps.express) frameworks.push("express");
  if (deps.fastify) frameworks.push("fastify");
  if (deps.hono) frameworks.push("hono");
  if (deps.koa) frameworks.push("koa");
  if (deps.elysia) frameworks.push("elysia");
  if (deps["@nestjs/core"]) frameworks.push("nestjs");
  if (deps.gatsby) frameworks.push("gatsby");
  if (deps["@trpc/server"]) frameworks.push("trpc");
  if (deps.prisma || deps["@prisma/client"]) frameworks.push("prisma");
  if (deps.drizzle || deps["drizzle-orm"]) frameworks.push("drizzle");

  // JS/TS dependency-based detection — testing & tooling
  if (deps.jest || deps["@jest/core"]) frameworks.push("jest");
  if (deps.vitest) frameworks.push("vitest");
  if (deps.playwright || deps["@playwright/test"])
    frameworks.push("playwright");
  if (deps.cypress) frameworks.push("cypress");
  if (deps.storybook || deps["@storybook/react"]) frameworks.push("storybook");

  // Ruby — Rails detection via conventional directory structure
  if (
    existsSync(join(projectRoot, "bin", "rails")) ||
    existsSync(join(projectRoot, "config", "routes.rb"))
  ) {
    frameworks.push("rails");
  }

  // Python — framework detection via manage.py / pyproject.toml deps
  if (existsSync(join(projectRoot, "manage.py"))) {
    frameworks.push("django");
  }

  // Python — FastAPI / Streamlit / Flask from pyproject.toml or requirements.txt
  const pyDeps = await readPythonDeps(projectRoot);
  if (pyDeps.has("fastapi")) frameworks.push("fastapi");
  if (pyDeps.has("streamlit")) frameworks.push("streamlit");
  if (pyDeps.has("flask")) frameworks.push("flask");

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

// ---------------------------------------------------------------------------
// Python dependency helpers
// ---------------------------------------------------------------------------

/** Normalize a Python package name: lowercase, underscores → hyphens. */
function normalizePyName(name: string): string {
  return name.toLowerCase().replaceAll("_", "-");
}

/** Extract the bare package name before any version specifier or extras. */
function extractPyPackageName(spec: string): string | null {
  const match = /^([a-z0-9][a-z0-9._-]*)/iu.exec(spec.trim());
  return match ? normalizePyName(match[1]) : null;
}

/**
 * Best-effort extraction of Python dependency names from pyproject.toml
 * (via Bun's built-in TOML parser) and requirements.txt.
 * Returns a Set of lowercase, hyphen-normalized package names.
 */
async function readPythonDeps(projectRoot: string): Promise<Set<string>> {
  const deps = new Set<string>();

  // requirements.txt — one package per line, format: `name[==version]`
  const reqPath = join(projectRoot, "requirements.txt");
  if (existsSync(reqPath)) {
    try {
      const text = await Bun.file(reqPath).text();
      for (const line of text.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-"))
          continue;
        const name = extractPyPackageName(trimmed);
        if (name) deps.add(name);
      }
    } catch {
      logDebug("Failed to read requirements.txt");
    }
  }

  // pyproject.toml — use Bun's built-in TOML parser for reliable extraction
  const pyprojectPath = join(projectRoot, "pyproject.toml");
  if (existsSync(pyprojectPath)) {
    try {
      const toml = await Bun.file(pyprojectPath).text();
      const result = PyprojectSchema.safeParse(Bun.TOML.parse(toml));
      if (result.success) {
        for (const spec of result.data.project?.dependencies ?? []) {
          const name = extractPyPackageName(spec);
          if (name) deps.add(name);
        }
      }
    } catch {
      logDebug("Failed to parse pyproject.toml");
    }
  }

  return deps;
}
