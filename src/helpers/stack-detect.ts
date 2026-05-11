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

/**
 * Detect the project's language, runtime, and framework from files present
 * in the project root. Used by the greenfield wizard to recommend packs.
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
  // Next.js: next.config.* (any extension)
  const nextConfigExtensions = ["js", "cjs", "mjs", "ts", "mts", "cts", "json"];
  if (
    nextConfigExtensions.some((ext) =>
      existsSync(join(projectRoot, `next.config.${ext}`))
    )
  ) {
    frameworks.push("nextjs");
  }

  // Remix: remix.config.*
  const remixConfigExtensions = ["js", "cjs", "mjs", "ts"];
  if (
    remixConfigExtensions.some((ext) =>
      existsSync(join(projectRoot, `remix.config.${ext}`))
    )
  ) {
    frameworks.push("remix");
  }

  // Vite: vite.config.*
  const viteConfigExtensions = ["js", "cjs", "mjs", "ts", "mts", "cts"];
  if (
    viteConfigExtensions.some((ext) =>
      existsSync(join(projectRoot, `vite.config.${ext}`))
    )
  ) {
    frameworks.push("vite");
  }

  // Fastify, Express, Hono from package.json dependencies
  if (deps.fastify) frameworks.push("fastify");
  if (deps.express) frameworks.push("express");
  if (deps.hono) frameworks.push("hono");

  // React from package.json dependencies
  if (deps.react) frameworks.push("react");

  logDebug("Detected stack:", { languages, runtimes, frameworks });

  return { languages, runtimes, frameworks };
}
