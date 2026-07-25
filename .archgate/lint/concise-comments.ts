// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate

// Token-based comment rules for GEN-004, registered under the `archgate`
// plugin in oxlint.ts. Keep the pattern sets in sync with the line-based
// mirror in .archgate/adrs/GEN-004-concise-forward-only-code-comments.rules.ts.

// Historical-narration phrases (GEN-004 "Forward-only content").
const NARRATION_PATTERN =
  /\b(used to|previously|no longer|originally|an earlier version|was tried|git blame|made things worse)\b/iu;

// Past-tense/passive relocation constructions; present-tense location prose
// (encouraged by GEN-004) deliberately does not match.
const RELOCATION_PATTERN =
  /\b(extracted (from|into|out of)|(was|were|has|have) been (moved|migrated|extracted|renamed|split|relocated|replaced|superseded|consolidated|refactored)|(was|were) (moved|migrated|extracted|renamed|split|relocated|superseded|consolidated|refactored)|moved (to|into) [`'"]?[\w./-]+\.tsx?\b|split out of|renamed from|used to live|formerly (lived|known|called|named)|has since|since been)\b/iu;

// Divider/directive lines keep a run contiguous but carry no prose.
const DIVIDER_ONLY = /^[─-╿=—\-_*\s]{3,}$/u;
const NON_PROSE =
  /^(<reference\b|eslint-|oxlint-|biome-ignore|prettier-ignore|@ts-|archgate-ignore|istanbul\s|c8\s|v8\s|region\b|endregion\b|SPDX-License-Identifier|Copyright\s)/iu;

// TSDoc block tags whose length tracks the API surface — one entry per
// parameter, thrown type, or example — rather than narrative padding. The tag
// line and everything under it up to the next tag is exempt from the budget.
const STRUCTURAL_TAG =
  /^@(param|arg|argument|typeParam|template|returns?|throws|example|see|link|defaultValue|deprecated|internal|public|alpha|beta|experimental|module|packageDocumentation|typedef|callback|property|prop|overload|inheritDoc|label|satisfies)\b/iu;

// Prose containers: their content is narrative, so it keeps counting.
// Exempting these would reduce the bound to "write @remarks first".
const PROSE_TAG = /^@(remarks|description|summary|notes?|todo|fixme)\b/iu;

// GEN-004: at most this many prose lines per contiguous comment run.
const OVERSIZED_BLOCK_THRESHOLD = 5;

interface SourceLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface CommentToken {
  type: "Line" | "Block";
  value: string;
  loc: SourceLocation;
}

interface RuleContext {
  sourceCode: { lines: string[]; getAllComments(): CommentToken[] };
  report(descriptor: { loc: SourceLocation; message: string }): void;
}

// Prose lines of a single comment token, markers stripped. A TSDoc block tag
// opens a section: a structural tag's section is exempt, a prose tag's is not,
// and the untagged summary above the first tag always counts.
function proseLines(comment: CommentToken): string[] {
  const raw =
    comment.type === "Line"
      ? [comment.value.replace(/^\/+/u, "")]
      : comment.value.split(/\r?\n/u).map((l) => l.replace(/^\s*\*+\s?/u, ""));

  const kept: string[] = [];
  let inStructuralSection = false;
  for (const line of raw) {
    const text = line.trim();
    if (text.startsWith("@")) {
      inStructuralSection = STRUCTURAL_TAG.test(text) && !PROSE_TAG.test(text);
      continue;
    }
    if (inStructuralSection) continue;
    if (text === "" || DIVIDER_ONLY.test(text) || NON_PROSE.test(text))
      continue;
    kept.push(text);
  }
  return kept;
}

// True when the comment occupies its lines alone — nothing but whitespace
// before it and nothing but whitespace after it, so `/* c */ const x = 1`
// stays out of block runs.
function isWholeLine(comment: CommentToken, lines: string[]): boolean {
  const firstLine = lines[comment.loc.start.line - 1] ?? "";
  const lastLine = lines[comment.loc.end.line - 1] ?? "";
  return (
    firstLine.slice(0, comment.loc.start.column).trim() === "" &&
    lastLine.slice(comment.loc.end.column).trim() === ""
  );
}

const noNarrationInComments = {
  create(context: RuleContext) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          for (const [pattern, kind] of [
            [NARRATION_PATTERN, "narrates history"],
            [RELOCATION_PATTERN, "narrates a relocation/refactor"],
          ] as const) {
            if (!pattern.test(comment.value)) continue;
            context.report({
              loc: comment.loc,
              message: `Comment ${kind} instead of describing current behavior. Rewrite in present tense — git history already records what changed (GEN-004).`,
            });
            // One diagnostic per comment, even when both patterns match.
            break;
          }
        }
      },
    };
  },
};

const oversizedCommentBlocks = {
  create(context: RuleContext) {
    return {
      Program() {
        const { lines } = context.sourceCode;
        const comments = context.sourceCode
          .getAllComments()
          .filter((c) => isWholeLine(c, lines));

        let run: CommentToken[] = [];
        const flush = () => {
          const prose = run.reduce((n, c) => n + proseLines(c).length, 0);
          if (prose > OVERSIZED_BLOCK_THRESHOLD && run[0]) {
            context.report({
              loc: run[0].loc,
              message: `Comment block carries ${prose} lines of prose; GEN-004 allows ${OVERSIZED_BLOCK_THRESHOLD} (roughly 1-3 sentences). Trim to current-behavior essentials or point to an ADR/memory file.`,
            });
          }
          run = [];
        };

        for (const comment of comments) {
          const prev = run.at(-1);
          if (prev && comment.loc.start.line > prev.loc.end.line + 1) flush();
          run.push(comment);
        }
        flush();
      },
    };
  },
};

export const conciseCommentRules = {
  "no-narration-in-comments": noNarrationInComments,
  "oversized-comment-blocks": oversizedCommentBlocks,
};
