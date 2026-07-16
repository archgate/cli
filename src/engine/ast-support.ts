// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AstLanguage } from "../formats/rules";
import { logDebug } from "../helpers/log";
import { isWindows } from "../helpers/platform";
import { UserError } from "../helpers/user-error";
import { getFileAtRev } from "./git-files";

/** Guardrail-2 failure: the file's name does not match the requested language. */
export function implausibleLanguageError(
  language: AstLanguage,
  path: string
): UserError {
  return new UserError(
    `File "${path}" does not look like ${language} (expected ${AST_LANGUAGE_EXTENSIONS[language].join(", ")}) — refusing to parse`
  );
}

/** Guardrail-3 failure: no interpreter for the language on PATH. */
export function interpreterNotFoundError(
  language: "python" | "ruby",
  candidates: string[],
  path: string
): Error {
  return new Error(
    `${language === "python" ? "Python" : "Ruby"} interpreter not found on PATH (tried: ${candidates.join(", ")}) — ctx.ast("${path}", "${language}") requires it wherever \`archgate check\` runs`
  );
}

/**
 * Support code for `ctx.ast()` (ARCH-022). Definitions live here to keep
 * `runner.ts` focused; the mandated four-step guardrail ordering (path
 * safety → language plausibility → interpreter probe → guarded invocation)
 * is sequenced inside `createRuleContext()` in `runner.ts`, which is the
 * only caller of these helpers.
 */

/** Hard cap on a single AST parser subprocess, well under the rule timeout. */
export const AST_SUBPROCESS_TIMEOUT_MS = 15_000;

/** Timeout for the interpreter availability probe (shorter than a real parse). */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Guardrail 2 (language plausibility): extensions accepted per language.
 * Checked before any interpreter is invoked on the file.
 */
export const AST_LANGUAGE_EXTENSIONS: Record<AstLanguage, readonly string[]> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
  ruby: [".rb", ".rake", ".gemspec"],
};

/** Extensionless file basenames accepted as Ruby (Rakefile, Gemfile). */
export const RUBY_BASENAMES = new Set(["rakefile", "gemfile"]);

/**
 * Shared Python preamble: the `ast`-node → JSON `convert()` used by both
 * serializers below, plus reading the target file from argv (never
 * interpolated into the program) into `source`/`tree`. Non-finite floats,
 * bytes, and complex numbers fall back to `repr()` so output is strict JSON.
 */
const PY_PREAMBLE = `
def convert(node):
    if isinstance(node, ast.AST):
        out = {"_type": type(node).__name__}
        for name, value in ast.iter_fields(node):
            out[name] = convert(value)
        for attr in node._attributes:
            if hasattr(node, attr):
                out[attr] = convert(getattr(node, attr))
        return out
    if isinstance(node, list):
        return [convert(item) for item in node]
    if isinstance(node, float) and (node != node or node in (float("inf"), float("-inf"))):
        return repr(node)
    if isinstance(node, (str, int, float, bool)) or node is None:
        return node
    return repr(node)

with open(sys.argv[1], encoding="utf-8-sig") as handle:
    source = handle.read()
try:
    tree = ast.parse(source, filename=sys.argv[1])
except SyntaxError as exc:
    print(f"{exc.msg} (line {exc.lineno}, column {exc.offset})", file=sys.stderr)
    sys.exit(1)
`;

/** Serializer passed to `<python> -c`: prints the parsed tree as JSON. */
export const PYTHON_AST_PROGRAM = `
import ast, json, sys
sys.setrecursionlimit(10000)
${PY_PREAMBLE}
print(json.dumps(convert(tree)))
`;

/**
 * Serializer used for `{ comments: true }`: prints `{"_tree", "comments"}`,
 * where comments come from the `tokenize` module (the `ast` tree has none).
 * `value` strips the leading `#`; Python has only line comments. Tokenizer
 * errors on otherwise-parseable source degrade to an empty comment list rather
 * than failing the parse.
 */
export const PYTHON_AST_WITH_COMMENTS_PROGRAM = `
import ast, io, json, sys, tokenize
sys.setrecursionlimit(10000)
${PY_PREAMBLE}
comments = []
try:
    for tok in tokenize.generate_tokens(io.StringIO(source).readline):
        if tok.type == tokenize.COMMENT:
            s = tok.string
            comments.append({
                "type": "line",
                "value": s[1:] if s.startswith("#") else s,
                "loc": {
                    "start": {"line": tok.start[0], "column": tok.start[1]},
                    "end": {"line": tok.end[0], "column": tok.end[1]},
                },
            })
except (tokenize.TokenError, IndentationError):
    pass
print(json.dumps({"_tree": convert(tree), "comments": comments}))
`;

/**
 * Serializer passed to `ruby -rripper -rjson -e`. `Ripper.sexp` returns nil
 * on syntax errors (it never raises), so nil is mapped to a non-zero exit.
 * `max_nesting: false` because real-world ASTs exceed JSON's default depth.
 */
export const RUBY_AST_PROGRAM = `
source = File.read(ARGV[0], mode: "r:bom|utf-8")
sexp = Ripper.sexp(source)
if sexp.nil?
  warn "Ruby syntax error"
  exit 1
end
puts JSON.generate(sexp, max_nesting: false)
`;

/**
 * Serializer used for Ruby `{ comments: true }`: prints the same
 * `{"_tree", "comments"}` envelope as the Python with-comments program, with
 * comments from a second `Ripper.lex` pass (`Ripper.sexp` carries none).
 * `#` comments become `type: "line"` tokens (`#` stripped, newline chomped);
 * each `=begin`/`=end` region becomes ONE `type: "block"` token whose value is
 * the inner content (marker lines stripped, like TS/JS stripping the
 * delimiters) and whose loc spans the `=begin` line through the `=end` line.
 * Lex errors on otherwise-parseable source degrade to an empty comment list
 * rather than failing the parse, matching Python's tokenizer-error fallback.
 */
export const RUBY_AST_WITH_COMMENTS_PROGRAM = `
source = File.read(ARGV[0], mode: "r:bom|utf-8")
sexp = Ripper.sexp(source)
if sexp.nil?
  warn "Ruby syntax error"
  exit 1
end
comments = []
begin
  embdoc = nil
  Ripper.lex(source).each do |(line, col), event, tok, _state|
    case event
    when :on_comment
      comments << {
        type: "line",
        value: tok.sub(/\\A#/, "").chomp,
        loc: {
          start: { line: line, column: col },
          end: { line: line, column: col + tok.chomp.length },
        },
      }
    when :on_embdoc_beg
      embdoc = { line: line, col: col, value: +"" }
    when :on_embdoc
      embdoc[:value] << tok unless embdoc.nil?
    when :on_embdoc_end
      unless embdoc.nil?
        comments << {
          type: "block",
          value: embdoc[:value].chomp,
          loc: {
            start: { line: embdoc[:line], column: embdoc[:col] },
            end: { line: line, column: col + tok.chomp.length },
          },
        }
        embdoc = nil
      end
    end
  end
rescue StandardError
  comments = []
end
puts JSON.generate({ _tree: sexp, comments: comments }, max_nesting: false)
`;

/**
 * Candidate executable names per language, in probe order. `python3` is not
 * a universal PATH alias on Windows (the common installer exposes `python`),
 * so the order flips per platform (ARCH-009's isWindows()). Windows also
 * probes the `py` launcher last — the python.org installer registers it
 * unconditionally even when "Add python.exe to PATH" is left unchecked, and
 * the probe already rejects a stale launcher with no registered CPython
 * (`py --version` exits non-zero).
 */
export function interpreterCandidates(language: "python" | "ruby"): string[] {
  if (language === "ruby") return ["ruby"];
  return isWindows() ? ["python", "python3", "py"] : ["python3", "python"];
}

/**
 * Guardrail 3 (interpreter availability probe): spawn `<candidate> --version`
 * and use the first candidate that exits 0. A plain `Bun.which()` lookup is
 * not enough on Windows — the Microsoft Store ships a `python.exe` App
 * Execution Alias stub that exists on PATH but exits non-zero.
 *
 * Callers cache the returned promise once per `check` invocation.
 */
export async function probeInterpreter(
  candidates: string[]
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      const proc = Bun.spawn([candidate, "--version"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      let probeTimer: ReturnType<typeof setTimeout> | undefined;
      const probeTimeout = new Promise<"timeout">((resolve) => {
        probeTimer = setTimeout(() => resolve("timeout"), PROBE_TIMEOUT_MS);
      });
      // oxlint-disable-next-line no-await-in-loop -- candidates probed in priority order
      const raceResult = await Promise.race([
        proc.exited,
        probeTimeout,
      ]).finally(() => {
        if (probeTimer) clearTimeout(probeTimer);
      });
      if (raceResult === "timeout") {
        proc.kill();
        // oxlint-disable-next-line no-await-in-loop -- must confirm kill before trying next candidate
        await proc.exited;
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- drain stdout only for the winning candidate
      const version = await new Response(proc.stdout).text();
      if (raceResult === 0) {
        logDebug(
          `ctx.ast interpreter probe: ${candidate} -> ${version.trim()}`
        );
        return candidate;
      }
    } catch {
      // Executable not found — try the next candidate.
    }
  }
  return null;
}

/**
 * Guardrail 4 (guarded invocation): run an AST parser subprocess with
 * array-based arguments only (ARCH-007 — no shell interpolation of paths or
 * file contents), draining stdout/stderr concurrently with the exit wait so
 * large AST output cannot deadlock the pipe buffer.
 */
export async function runAstSubprocess(
  cmd: string[],
  timeoutMs: number = AST_SUBPROCESS_TIMEOUT_MS
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const result = await Promise.race([proc.exited, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (result === "timeout") {
    proc.kill();
    await proc.exited;
    throw new Error(`AST parser subprocess timed out after ${timeoutMs}ms`);
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { exitCode: result, stdout, stderr };
}

/**
 * Parse an AST subprocess's stdout as JSON, mapping malformed output to the
 * same throw contract as any other `ctx.ast()` failure. Subprocess stdout is
 * not a file read, so `Bun.file().json()` (ARCH-010) does not apply here.
 */
export function parseAstJson(
  stdout: string,
  path: string,
  language: string
): Record<string, unknown> | unknown[] {
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `Failed to parse "${path}" as ${language}: interpreter produced invalid JSON output`
    );
  }
}

/**
 * Read a file's source at the comparison base revision for
 * `ctx.ast(path, lang, { rev: "base" })`, throwing on the two cases the AST
 * contract must never paper over: no base is resolvable, or the path did not
 * exist at the base. Both throw rather than returning null — a silent miss
 * would let a rule report a false "no change." `displayPath` is the
 * caller-facing path used in error messages.
 */
export async function readBaseSourceOrThrow(
  projectRoot: string,
  baseRev: string | null,
  relPath: string,
  displayPath: string
): Promise<string> {
  if (!baseRev) {
    throw new Error(
      `ctx.ast("${displayPath}", …, { rev: "base" }) needs a base revision, but none is resolved — run \`archgate check --base <ref>\``
    );
  }
  const source = await getFileAtRev(projectRoot, baseRev, relPath);
  if (source === null) {
    throw new Error(
      `"${displayPath}" did not exist at the base revision (${baseRev.slice(0, 9)}) — nothing to parse at { rev: "base" }`
    );
  }
  return source;
}

/**
 * Write source to a throwaway temp file and return its path plus a cleanup
 * thunk. Used only for `ctx.ast(path, lang, { rev: "base" })` on Python/Ruby:
 * the base revision's content is not on disk, but the interpreter serializers
 * read a file path from argv. Writing it to a temp file lets the existing,
 * unchanged `PYTHON_AST_PROGRAM`/`RUBY_AST_PROGRAM` (and the mandatory `-I`
 * isolation) parse it without a second code path.
 *
 * Security: the file goes in a per-call private directory created with
 * `mkdtempSync` (0700, owner-only, unpredictable name), and is created
 * exclusively (`wx`) with mode `0600`. This closes the shared-`tmpdir` attacks
 * a predictable name would expose on a multi-user host: a pre-planted symlink
 * at the path can no longer redirect the write (exclusive create fails on an
 * existing entry, and the private parent is not writable by others), and the
 * base source — which may be sensitive — is never world-readable or left where
 * another user could read it. It also lives outside any interpreter's
 * cwd-derived load path even before `-I` is considered. `cleanup()` removes the
 * whole private directory, is best-effort, and never throws.
 */
export function writeTempSourceFile(
  content: string,
  ext: string
): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "archgate-ast-"));
  const cleanup = () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort — a leftover temp dir is harmless.
    }
  };
  try {
    const path = join(dir, `source${ext}`);
    writeFileSync(path, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return { path, cleanup };
  } catch (err) {
    // File creation failed after the dir was made — remove it before rethrowing
    // so a failed base parse never leaks the private directory.
    cleanup();
    throw err;
  }
}

/**
 * Resolve the file path the Python/Ruby serializer subprocess should read.
 *
 * For a working-tree parse this is just the on-disk file. For `{ rev: "base" }`
 * the base content is not on disk, so it is fetched from git and written to a
 * throwaway temp file, whose path is returned alongside a `cleanup` thunk the
 * caller MUST invoke in a `finally`.
 */
export async function materializeAstInput(args: {
  useBase: boolean;
  absPath: string;
  ext: string;
  projectRoot: string;
  baseRev: string | null;
  relPath: string;
  displayPath: string;
}): Promise<{ sourcePath: string; cleanup?: () => void }> {
  if (!args.useBase) return { sourcePath: args.absPath };
  const source = await readBaseSourceOrThrow(
    args.projectRoot,
    args.baseRev,
    args.relPath,
    args.displayPath
  );
  const tmp = writeTempSourceFile(source, args.ext);
  return { sourcePath: tmp.path, cleanup: tmp.cleanup };
}

/**
 * Fold the `{ comments: true }` Python/Ruby subprocess output back into the
 * shape `ctx.ast()` promises. Those serializers print `{ _tree, comments }`;
 * unwrap it to the tree with `comments` attached, so the return shape matches
 * the ESTree one (a tree carrying a `comments` array). Ruby's tree is an
 * array, so `comments` rides on it as a non-index property. For every other
 * case the subprocess output is already the tree — pass it through untouched.
 */
export function finalizeAstResult(
  parsed: Record<string, unknown> | unknown[],
  language: string,
  wantComments: boolean
): Record<string, unknown> | unknown[] {
  const hasEnvelope = language === "python" || language === "ruby";
  if (!hasEnvelope || !wantComments || Array.isArray(parsed)) {
    return parsed;
  }
  const tree = parsed._tree as Record<string, unknown> | unknown[] | undefined;
  if (!tree) return parsed;
  (tree as { comments?: unknown }).comments = parsed.comments;
  return tree;
}

/** Extract a readable message from Bun.Transpiler/meriyah parse errors. */
export function parseErrorMessage(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return String(err.errors[0]);
  }
  return err instanceof Error ? err.message : String(err);
}
