// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { ReadYamlResult, YamlValue } from "../formats/rules";

/**
 * Leading `---`-delimited YAML frontmatter block. The block must start at the
 * very first character of the file (after an optional BOM, which is stripped
 * first), and BOTH fences must be a bare `---` occupying their whole line
 * (trailing spaces/tabs tolerated).
 *
 * Anchoring the closing fence to the line end is deliberate: a bare `\n---`
 * match would accept `----` or `---note` as the terminator, silently parsing
 * a truncated block and leaving the stray characters at the head of the body.
 * This is marginally stricter than `parseAdr`'s regex in
 * src/formats/adr.ts — the two agree on every well-formed file and differ
 * only on malformed fences, where this one reports "no frontmatter" rather
 * than parsing a partial block.
 */
const FRONTMATTER_REGEX = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;

/** Extensions parsed as whole YAML documents rather than frontmatter+body. */
const YAML_EXTENSIONS = [".yml", ".yaml"];

/** Strip a leading UTF-8 BOM, which would otherwise defeat the `^---` anchor. */
function stripBom(source: string): string {
  return source.codePointAt(0) === 0xfe_ff ? source.slice(1) : source;
}

/** Parse the extracted frontmatter block, enforcing the mapping convention. */
function parseFrontmatterBlock(
  block: string,
  relPath: string
): Record<string, YamlValue> {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(block);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse frontmatter of "${relPath}" as YAML: ${detail}`
    );
  }

  // An empty block parses to null/undefined — present but empty frontmatter.
  if (parsed === null || parsed === undefined) return {};

  if (typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, YamlValue>;
  }
  throw new Error(
    `Frontmatter of "${relPath}" is not a YAML mapping — got ${Array.isArray(parsed) ? "a sequence" : `a ${typeof parsed}`}`
  );
}

/**
 * Parse a file for `ctx.readYAML()`. Dispatch is extension-based, so a
 * multi-document YAML stream (whose `---` separators look exactly like a
 * frontmatter block) is never misdetected as frontmatter:
 *
 * - `.yml` / `.yaml`: the whole source parses as one YAML document —
 *   `frontmatter` is always `null`, `content` is the parsed value. Invalid
 *   YAML throws (fail-closed, like `ast()`), so a malformed file surfaces
 *   as a rule execution error instead of a false pass.
 * - Any other file (typically Markdown): the leading `---`-delimited block
 *   parses as `frontmatter` — `null` when absent, `{}` when present but
 *   empty, and a throw when it is invalid YAML or a non-mapping (scalar /
 *   sequence). `content` is the remaining body text (the whole file when
 *   there is no frontmatter), trimmed; it is NOT parsed as YAML.
 *
 * `relPath` is used only for error messages and the extension dispatch.
 */
export function parseYamlDocument(
  source: string,
  relPath: string
): ReadYamlResult {
  const text = stripBom(source);
  const lowerPath = relPath.toLowerCase();

  if (YAML_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))) {
    try {
      // `?? null` folds an empty document (undefined) into YamlValue's null.
      return {
        frontmatter: null,
        content: (Bun.YAML.parse(text) ?? null) as YamlValue,
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse "${relPath}" as YAML: ${detail}`);
    }
  }

  const match = text.match(FRONTMATTER_REGEX);
  if (!match) return { frontmatter: null, content: text.trim() };

  return {
    frontmatter: parseFrontmatterBlock(match[1], relPath),
    content: text.slice(match[0].length).trim(),
  };
}
