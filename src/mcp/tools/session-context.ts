import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Encode a project root path into the Claude projects directory name. */
function encodeProjectPath(projectRoot: string): string {
  return projectRoot.replaceAll("/", "-");
}

/** Types we care about from the JSONL transcript. */
const RELEVANT_TYPES = new Set(["user", "assistant"]);

interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
  [key: string]: unknown;
}

interface SessionSummary {
  sessionFile: string;
  totalEntries: number;
  relevantEntries: number;
  transcript: Array<{
    type: string;
    role?: string;
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
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        const text = b.text as string;
        parts.push(text.length > 300 ? text.slice(0, 300) + "..." : text);
      } else if (b.type === "tool_use") {
        parts.push(`[tool_use: ${b.name}]`);
      } else if (b.type === "tool_result") {
        parts.push(
          `[tool_result: ${String(b.tool_use_id ?? "").slice(0, 20)}]`
        );
      }
    }
    return parts.join(" | ");
  }
  return "";
}

export function registerSessionContextTool(
  server: McpServer,
  projectRoot: string
) {
  server.registerTool(
    "session_context",
    {
      description:
        "Read the current Claude Code session transcript for the project. Returns filtered entries (user + assistant messages only) from the most recent session JSONL file. Use this to recover session context that may have been compacted from the conversation.",
      inputSchema: {
        maxEntries: z
          .number()
          .optional()
          .describe(
            "Maximum number of relevant entries to return (default: 200). Returns the most recent entries."
          ),
      },
    },
    async ({ maxEntries }) => {
      const limit = maxEntries ?? 200;
      const encodedPath = encodeProjectPath(projectRoot);
      const projectsDir = join(homedir(), ".claude", "projects", encodedPath);

      // Find all JSONL files sorted by modification time (most recent first)
      let files: string[];
      try {
        files = readdirSync(projectsDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => ({
            name: f,
            mtime: statSync(join(projectsDir, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime)
          .map((f) => f.name);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No session files found",
                path: projectsDir,
              }),
            },
          ],
        };
      }

      if (files.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "No JSONL session files found",
                path: projectsDir,
              }),
            },
          ],
        };
      }

      // Read and parse the most recent session file using Bun's native JSONL parser
      const sessionFile = join(projectsDir, files[0]);
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

      // Filter for relevant types
      const relevant: Array<{
        type: string;
        role?: string;
        contentPreview: string;
      }> = [];

      for (const entry of entries) {
        if (!RELEVANT_TYPES.has(entry.type)) continue;
        relevant.push({
          type: entry.type,
          role: entry.message?.role,
          contentPreview: getContentPreview(entry),
        });
      }

      // Return the most recent entries up to the limit
      const trimmed =
        relevant.length > limit ? relevant.slice(-limit) : relevant;

      const summary: SessionSummary = {
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
