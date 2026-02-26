import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Encode a project root path into the Cursor projects directory name. */
function encodeProjectPath(projectRoot: string): string {
  return projectRoot.replaceAll("/", "-");
}

/** Roles we care about from the Cursor transcript. */
const RELEVANT_ROLES = new Set(["user", "assistant"]);

interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface TranscriptEntry {
  role: string;
  message?: {
    content?: unknown;
  };
  [key: string]: unknown;
}

interface SessionSummary {
  sessionId: string;
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{
    role: string;
    contentPreview: string;
  }>;
}

/** Extract a concise content preview from a transcript entry. */
function getContentPreview(entry: TranscriptEntry): string {
  const content = entry.message?.content;
  if (typeof content === "string") {
    return content.length > 500 ? content.slice(0, 500) + "..." : content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as ContentBlock[]) {
      if (typeof block !== "object" || block === null) continue;
      if (block.type === "text" && typeof block.text === "string") {
        const text = block.text;
        parts.push(text.length > 300 ? text.slice(0, 300) + "..." : text);
      } else if (block.type === "tool_use") {
        parts.push(`[tool_use: ${block.name}]`);
      } else if (block.type === "tool_result") {
        parts.push(
          `[tool_result: ${String(block.tool_use_id ?? "").slice(0, 20)}]`
        );
      }
    }
    return parts.join(" | ");
  }
  return "";
}

export function registerCursorSessionContextTool(
  server: McpServer,
  projectRoot: string | null
) {
  server.registerTool(
    "cursor_session_context",
    {
      description:
        "Read Cursor agent session transcripts for the project. Returns filtered entries (user + assistant messages) from Cursor's agent-transcripts JSONL files. Use this to access context from Cursor agent conversations.",
      inputSchema: {
        maxEntries: z
          .number()
          .optional()
          .describe(
            "Maximum number of relevant entries to return (default: 200). Returns the most recent entries."
          ),
        sessionId: z
          .string()
          .optional()
          .describe(
            "Specific session UUID to read. If omitted, reads the most recent session."
          ),
      },
    },
    async ({ maxEntries, sessionId }) => {
      const limit = maxEntries ?? 200;
      const encodedPath = encodeProjectPath(projectRoot ?? process.cwd());
      const transcriptsDir = join(
        homedir(),
        ".cursor",
        "projects",
        encodedPath,
        "agent-transcripts"
      );

      // Find all session directories sorted by modification time (most recent first)
      let sessionDirs: Array<{ name: string; mtime: number }>;
      try {
        sessionDirs = readdirSync(transcriptsDir)
          .map((name) => {
            const fullPath = join(transcriptsDir, name);
            try {
              const stat = statSync(fullPath);
              return stat.isDirectory() ? { name, mtime: stat.mtimeMs } : null;
            } catch {
              return null;
            }
          })
          .filter((d): d is { name: string; mtime: number } => d !== null)
          .sort((a, b) => b.mtime - a.mtime);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No Cursor agent-transcripts directory found",
                path: transcriptsDir,
              }),
            },
          ],
        };
      }

      if (sessionDirs.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No session directories found",
                path: transcriptsDir,
              }),
            },
          ],
        };
      }

      // Pick the target session
      const targetDir = sessionId
        ? sessionDirs.find((d) => d.name === sessionId)
        : sessionDirs[0];

      if (!targetDir) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Session not found: ${sessionId}`,
                available: sessionDirs.map((d) => d.name),
              }),
            },
          ],
        };
      }

      // Read the JSONL file inside the session directory (<uuid>/<uuid>.jsonl)
      const sessionFile = join(
        transcriptsDir,
        targetDir.name,
        `${targetDir.name}.jsonl`
      );

      let entries: TranscriptEntry[];
      try {
        const raw = await Bun.file(sessionFile).text();
        entries = Bun.JSONL.parse(raw) as TranscriptEntry[];
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Failed to read session file",
                file: sessionFile,
              }),
            },
          ],
        };
      }

      // Filter for relevant roles
      const relevant: Array<{ role: string; contentPreview: string }> = [];

      for (const entry of entries) {
        if (!RELEVANT_ROLES.has(entry.role)) continue;
        relevant.push({
          role: entry.role,
          contentPreview: getContentPreview(entry),
        });
      }

      // Return the most recent entries up to the limit
      const trimmed =
        relevant.length > limit ? relevant.slice(-limit) : relevant;

      const summary: SessionSummary = {
        sessionId: targetDir.name,
        sessionFile: basename(sessionFile),
        totalEntries: entries.length,
        relevantEntries: relevant.length,
        transcript: trimmed,
      };

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(summary, null, 2) },
        ],
      };
    }
  );
}
