import { mkdir, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { LOGS_DIR } from "../paths.js";

export interface LogEntry {
  ts: string;
  tool: string;
  args: unknown;
  status: "ok" | "error";
  durationMs: number;
  recordCount?: number;
  error?: string;
}

function logPathFor(date: Date): string {
  return path.join(LOGS_DIR, `mcp-${date.toISOString().slice(0, 10)}.jsonl`);
}

export async function logCall(entry: LogEntry): Promise<void> {
  await mkdir(LOGS_DIR, { recursive: true });
  await appendFile(logPathFor(new Date(entry.ts)), JSON.stringify(entry) + "\n", "utf8");
}

/** Wraps a tool handler with timing + structured logging, recording success/failure of every call. */
export function withLogging<Args, Result>(
  toolName: string,
  handler: (args: Args) => Promise<Result>,
  recordCountOf?: (result: Result) => number
) {
  return async (args: Args): Promise<Result> => {
    const start = Date.now();
    try {
      const result = await handler(args);
      await logCall({
        ts: new Date().toISOString(),
        tool: toolName,
        args,
        status: "ok",
        durationMs: Date.now() - start,
        recordCount: recordCountOf ? recordCountOf(result) : undefined,
      });
      return result;
    } catch (err) {
      await logCall({
        ts: new Date().toISOString(),
        tool: toolName,
        args,
        status: "error",
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}

/** Reads the most recent N log entries, newest first, across today's and (if needed) yesterday's log file. */
export async function readRecentLogs(limit = 50): Promise<LogEntry[]> {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const paths = [logPathFor(today), logPathFor(yesterday)];

  const entries: LogEntry[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const content = await readFile(path, "utf8");
    for (const line of content.trim().split("\n")) {
      if (!line) continue;
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed line
      }
    }
  }

  entries.sort((a, b) => b.ts.localeCompare(a.ts));
  return entries.slice(0, limit);
}
