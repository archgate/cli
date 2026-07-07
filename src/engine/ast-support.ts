// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
import type { AstLanguage } from "../formats/rules";
import { logDebug } from "../helpers/log";
import { isWindows } from "../helpers/platform";

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
 * Serializer passed to `<python> -c`. Reads the target file from argv (never
 * interpolated into the program), parses it with the standard `ast` module,
 * and prints the tree as JSON. Non-finite floats, bytes, and complex numbers
 * fall back to `repr()` so the output is always strict JSON.
 */
export const PYTHON_AST_PROGRAM = `
import ast, json, sys

sys.setrecursionlimit(10000)

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
print(json.dumps(convert(tree)))
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

/** Extract a readable message from Bun.Transpiler/meriyah parse errors. */
export function parseErrorMessage(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    return String(err.errors[0]);
  }
  return err instanceof Error ? err.message : String(err);
}
