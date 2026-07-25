/// <reference path="../rules.d.ts" />

// Line-based heuristics mirroring the token-based oxlint rules in
// .archgate/lint/oxlint.ts — keep the two pattern sets in sync (GEN-004).

// Historical-narration phrases. Grammar notes live in GEN-004's Decision.
const NARRATION_PATTERN =
  /\b(used to|previously|no longer|originally|an earlier version|was tried|git blame|made things worse)\b/iu;

// Past-tense/passive relocation constructions; present-tense location prose
// (encouraged by GEN-004) deliberately does not match.
const RELOCATION_PATTERN =
  /\b(extracted (from|into|out of)|(was|were|has|have) been (moved|migrated|extracted|renamed|split|relocated|replaced|superseded|consolidated|refactored)|(was|were) (moved|migrated|extracted|renamed|split|relocated|superseded|consolidated|refactored)|moved (to|into) [`'"]?[\w./-]+\.tsx?\b|split out of|renamed from|used to live|formerly (lived|known|called|named)|has since|since been)\b/iu;

// Delimiter/divider/directive lines keep a run contiguous but carry no prose.
const DIVIDER_ONLY = /^[─-╿=—\-_*\s]{3,}$/u;
const NON_PROSE =
  /^(<reference\b|eslint-|oxlint-|biome-ignore|prettier-ignore|@ts-|archgate-ignore|istanbul\s|c8\s|v8\s|region\b|endregion\b|SPDX-License-Identifier|Copyright\s)/iu;

const OVERSIZED_BLOCK_THRESHOLD = 5;

// A leading `*` counts only when followed by space or end of line, so a
// generator declaration (`*method() {`) is not mistaken for a JSDoc body.
function looksLikeComment(trimmed: string): boolean {
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    /^\*(\s|\/|$)/u.test(trimmed)
  );
}

// The prose body of a whole-line comment, with markers stripped.
function commentBody(trimmed: string): string {
  return trimmed
    .replace(/^(\/\/\/|\/\*\*|\/\*|\*\/|\*|\/\/)/u, "")
    .replace(/\*\/$/u, "")
    .trim();
}

function countsAsProse(trimmed: string): boolean {
  const body = commentBody(trimmed);
  if (body === "" || DIVIDER_ONLY.test(body)) return false;
  return !NON_PROSE.test(body);
}

function isFixtureFile(file: string): boolean {
  return file.replaceAll("\\", "/").includes("tests/fixtures/");
}

function isTestFile(file: string): boolean {
  return file.replaceAll("\\", "/").startsWith("tests/");
}

export default {
  rules: {
    "no-narration-in-comments": {
      description:
        "Comments must describe current behavior only — no historical or relocation narration (GEN-004)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter((f) => !isFixtureFile(f));
        const checks = files.map(async (file) => {
          const content = await ctx.readFile(file);
          content.split(/\r?\n/u).forEach((line, index) => {
            const trimmed = line.trim();
            if (!looksLikeComment(trimmed)) return;
            for (const [pattern, kind] of [
              [NARRATION_PATTERN, "narrates history"],
              [RELOCATION_PATTERN, "narrates a relocation/refactor"],
            ] as const) {
              if (!pattern.test(trimmed)) continue;
              ctx.report.violation({
                message: `Comment ${kind} instead of describing current behavior (GEN-004)`,
                file,
                line: index + 1,
                fix: "Rewrite in present tense describing what the code does now — git history already records what changed",
              });
              // One diagnostic per comment, even when both patterns match.
              break;
            }
          });
        });
        await Promise.all(checks);
      },
    },

    "oversized-comment-blocks": {
      description:
        "Contiguous comment runs must carry at most 5 lines of prose — move deeper rationale to an ADR or memory file (GEN-004)",
      severity: "error",
      async check(ctx) {
        const files = ctx.scopedFiles.filter(
          (f) => !isTestFile(f) && !isFixtureFile(f)
        );
        const checks = files.map(async (file) => {
          const lines = (await ctx.readFile(file)).split(/\r?\n/u);
          let runStart = -1;
          let prose = 0;

          const flush = () => {
            if (prose > OVERSIZED_BLOCK_THRESHOLD) {
              ctx.report.violation({
                message: `Comment block carries ${prose} lines of prose; GEN-004 allows ${OVERSIZED_BLOCK_THRESHOLD} (roughly 1-3 sentences)`,
                file,
                line: runStart + 1,
                fix: "Trim to the current-behavior essentials, or replace the inlined explanation with a pointer to an ADR or agent-memory file",
              });
            }
            runStart = -1;
            prose = 0;
          };

          lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed !== "" && looksLikeComment(trimmed)) {
              if (runStart === -1) runStart = index;
              if (countsAsProse(trimmed)) prose++;
            } else {
              flush();
            }
          });
          flush();
        });
        await Promise.all(checks);
      },
    },
  },
} satisfies RuleSet;
