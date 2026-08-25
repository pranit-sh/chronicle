import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import { ensureDir, listFilesRecursive } from "./fs-utils.js";
import type { CodicilPaths } from "./paths.js";
import { type Actor, type HistoryEvent, HistoryEventSchema, type HistoryOp } from "./schema.js";

/**
 * Git is the real version store. This append-only log exists so a changelog can
 * be rendered without shelling out to `git log`, and because it is committed it
 * follows branches the same way the knowledge does.
 */

function dayFile(paths: CodicilPaths, timestamp: string): string {
  const day = timestamp.slice(0, 10);
  return path.join(paths.historyDir, `${day}.jsonl`);
}

export interface HistoryInput {
  op: HistoryOp;
  actor: Actor;
  summary: string;
  itemId?: string;
  proposalId?: string;
  before?: unknown;
  after?: unknown;
  ts?: string;
}

export async function appendHistory(paths: CodicilPaths, input: HistoryInput): Promise<HistoryEvent> {
  const event = HistoryEventSchema.parse({ ...input, ts: input.ts ?? new Date().toISOString() });
  await ensureDir(paths.historyDir);
  await appendFile(dayFile(paths, event.ts), `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

export interface HistoryQuery {
  since?: Date;
  until?: Date;
  itemId?: string;
  op?: HistoryOp;
  limit?: number;
}

export async function readHistory(
  paths: CodicilPaths,
  query: HistoryQuery = {},
): Promise<HistoryEvent[]> {
  const files = await listFilesRecursive(paths.historyDir, ".jsonl");
  const events: HistoryEvent[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const result = HistoryEventSchema.safeParse(parsed);
      if (result.success) events.push(result.data);
    }
  }

  const filtered = events.filter((event) => {
    const at = Date.parse(event.ts);
    if (query.since && at < query.since.getTime()) return false;
    if (query.until && at > query.until.getTime()) return false;
    if (query.itemId && event.itemId !== query.itemId) return false;
    if (query.op && event.op !== query.op) return false;
    return true;
  });

  filtered.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return query.limit ? filtered.slice(-query.limit) : filtered;
}

/** Groups events by calendar day, newest day first, for changelog rendering. */
export function groupByDay(events: readonly HistoryEvent[]): Array<[string, HistoryEvent[]]> {
  const byDay = new Map<string, HistoryEvent[]>();
  for (const event of events) {
    const day = event.ts.slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(event);
    else byDay.set(day, [event]);
  }
  return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}
