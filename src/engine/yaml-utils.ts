// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { ReadYamlResult, YamlValue } from "../formats/rules";

/**
 * Leading `---`-delimited frontmatter. Both fences must be a bare `---` on
 * their own line (trailing spaces/tabs tolerated), which keeps `----` and
 * `---note` from terminating the block. The body group is OPTIONAL so a fully
 * empty `---`/`---` block matches and yields `{}`; `match[1]` is `undefined`
 * there, so callers coalesce.
 *
 * @see tests/engine/yaml-utils.test.ts — the fence and empty-block cases
 */
const FRONTMATTER_REGEX =
  /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/u;

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
 * multi-document YAML stream's `---` separators are never misread as
 * frontmatter. `relPath` drives that dispatch and the error messages.
 *
 * @throws {Error} On invalid YAML, or a frontmatter block that is not a mapping.
 * @see RuleContext.readYAML in src/formats/rules.ts — the full contract
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
    // `?? ""` covers a fully empty block, where the optional body group did
    // not participate in the match and `match[1]` is undefined.
    frontmatter: parseFrontmatterBlock(match[1] ?? "", relPath),
    content: text.slice(match[0].length).trim(),
  };
}
