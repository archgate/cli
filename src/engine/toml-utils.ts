// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

/** Parse TOML and add the project-relative path to parser failures. */
export function parseTomlDocument(source: string, relPath: string): unknown {
  try {
    return Bun.TOML.parse(source);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse "${relPath}" as TOML: ${detail}`);
  }
}
