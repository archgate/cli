// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { z } from "zod";

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

/**
 * Mirrors {@link YamlValue}'s recursive shape so a `Bun.YAML.parse()` result
 * (typed `unknown`) can be validated in one call instead of a hand-walked
 * recursive type guard.
 */
const yamlValueSchema: z.ZodType<YamlValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(yamlValueSchema),
    z.record(z.string(), yamlValueSchema),
  ])
);

/**
 * Structural check that a `Bun.YAML.parse()` result is expressible as
 * `YamlValue` — true by construction for any successfully parsed YAML/JSON
 * document, but not provable to the type checker without validating it.
 */
function isYamlValue(value: unknown): value is YamlValue {
  return yamlValueSchema.safeParse(value).success;
}

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

  if (
    typeof parsed === "object" &&
    isYamlValue(parsed) &&
    !Array.isArray(parsed)
  ) {
    return parsed;
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
      const parsed: unknown = Bun.YAML.parse(text) ?? null;
      if (!isYamlValue(parsed)) {
        throw new Error("Parsed YAML value has an unsupported shape");
      }
      return { frontmatter: null, content: parsed };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse "${relPath}" as YAML: ${detail}`);
    }
  }

  const match = FRONTMATTER_REGEX.exec(text);
  if (!match) return { frontmatter: null, content: text.trim() };

  return {
    // `?? ""` covers a fully empty block, where the optional body group did
    // not participate in the match and `match[1]` is undefined at runtime —
    // TS's RegExpExecArray numeric indexing doesn't model per-group
    // optionality, so this is required despite the lint claiming it isn't.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    frontmatter: parseFrontmatterBlock(match[1] ?? "", relPath),
    content: text.slice(match[0].length).trim(),
  };
}
