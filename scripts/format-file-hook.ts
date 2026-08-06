// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Archgate
/**
 * `PostToolUse` hook: formats the file a Write or Edit just touched.
 *
 * Formatting runs through the `format:file` package script rather than the
 * formatter binary, per GEN-003.
 *
 * Never fails the tool call: a file this hook cannot format is not a reason
 * to reject an edit that already succeeded.
 */
async function readFilePath(): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    const raw = await Bun.stdin.text();
    if (raw.trim() === "") return "";
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== "object" || payload === null) return "";
    const { tool_input: toolInput } = payload as { tool_input?: unknown };
    if (typeof toolInput !== "object" || toolInput === null) return "";
    const { file_path: filePath } = toolInput as { file_path?: unknown };
    return typeof filePath === "string" ? filePath : "";
  } catch {
    return "";
  }
}

const filePath = await readFilePath();
if (filePath !== "") {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "format:file", filePath],
    cwd: Bun.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
}
