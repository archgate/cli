// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * `WorktreeCreate` hook: prepares a git worktree under `.claude/worktrees/`
 * and installs its dependencies.
 *
 * Prints the worktree directory on stdout, which is the hook's contract; all
 * other output goes to stderr. Shell-free invocation: see CONTRIBUTING.md.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Routes a subprocess's own output to stderr, keeping stdout for the path. */
function run(cmd: string[], cwd: string): number {
  const result = Bun.spawnSync({ cmd, cwd, stdout: "pipe", stderr: "pipe" });
  if (result.stdout.length > 0) process.stderr.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  return result.exitCode;
}

/** Reads the hook payload, tolerating absent or malformed stdin. */
async function readName(): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    const raw = await Bun.stdin.text();
    if (raw.trim() === "") return "";
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== "object" || payload === null) return "";
    const { name } = payload as { name?: unknown };
    return typeof name === "string" ? name.replaceAll("\r", "") : "";
  } catch {
    return "";
  }
}

const projectDir = Bun.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const name = (await readName()) || `wt-${process.pid}`;

// A separator or traversal segment would place the worktree outside the
// worktrees directory, so reject rather than silently relocate it.
if (
  name.includes("/") ||
  name.includes("\\") ||
  name === "." ||
  name === ".."
) {
  process.stderr.write(`error: refusing unsafe worktree name '${name}'\n`);
  process.exit(1);
}

const dir = join(projectDir, ".claude", "worktrees", name);
const branch = `claude/${name}`;

// A directory without `.git` is the residue of a pruned or interrupted
// worktree; `git worktree add` refuses to reuse it.
if (existsSync(dir) && !existsSync(join(dir, ".git"))) {
  rmSync(dir, { recursive: true, force: true });
}

if (!existsSync(dir)) {
  run(["git", "worktree", "prune"], projectDir);
  if (run(["git", "worktree", "add", dir, "-B", branch], projectDir) !== 0) {
    process.exit(1);
  }
}

// Missing dependencies leave a usable worktree, so warn rather than fail.
if (run(["bun", "install", "--silent"], dir) !== 0) {
  process.stderr.write(
    `warning: bun install failed in ${dir} -- dependencies may be missing, run 'bun install' manually\n`
  );
}

process.stdout.write(`${dir}\n`);
