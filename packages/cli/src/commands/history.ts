import {
  type HistoryEvent,
  type HistoryOp,
  groupByDay,
  readHistory,
} from "@chronicle/core";
import type { Command } from "commander";

import { parseInteger } from "../options.js";
import { color, print, printJson, shortId, table } from "../ui.js";
import { type GlobalOptions, openStore } from "../workspace.js";

/** Past tense verbs, because the changelog is a record of what already happened. */
const OP_LABEL: Record<HistoryOp, string> = {
  init: "initialized",
  create: "created",
  update: "updated",
  archive: "archived",
  restore: "restored",
  delete: "deleted",
  propose: "proposed",
  accept: "accepted",
  reject: "rejected",
  verify: "verified",
  stale: "went stale",
  expire: "expired",
};

function paintOp(op: HistoryOp): string {
  switch (op) {
    case "create":
    case "accept":
    case "restore":
      return color.green(OP_LABEL[op]);
    case "delete":
    case "stale":
    case "expire":
      return color.red(OP_LABEL[op]);
    case "reject":
    case "archive":
      return color.yellow(OP_LABEL[op]);
    case "propose":
      return color.cyan(OP_LABEL[op]);
    default:
      return color.gray(OP_LABEL[op]);
  }
}

function actorLabel(event: HistoryEvent): string {
  const { kind, id } = event.actor;
  return kind === "agent" ? color.magenta(`${id} (agent)`) : color.gray(id);
}

/**
 * Parses `--since`, accepting either a relative window like `7d` or an ISO date.
 */
function parseSince(input: string): Date {
  const relative = /^(\d+)\s*([dwmh])$/i.exec(input.trim());
  if (relative) {
    const amount = Number(relative[1]);
    const unit = (relative[2] ?? "d").toLowerCase();
    const hours = unit === "h" ? amount : unit === "d" ? amount * 24 : unit === "w" ? amount * 168 : amount * 720;
    return new Date(Date.now() - hours * 3_600_000);
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Cannot read "${input}" as a date. Use 7d, 2w, or 2026-08-01.`);
  }
  return parsed;
}

/** `2026-08-18` reads better as a weekday once it is more than a few days old. */
function dayHeading(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return `${day} ${color.gray("(today)")}`;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (day === yesterday) return `${day} ${color.gray("(yesterday)")}`;
  const weekday = new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  return `${day} ${color.gray(`(${weekday})`)}`;
}

export function registerHistory(program: Command): void {
  program
    .command("history")
    .description("Show the changelog of everything that has happened to this knowledge layer")
    .option("--item <ref>", "only events for one knowledge item")
    .option("--op <op>", `only one kind of event (${Object.keys(OP_LABEL).join(", ")})`)
    .option("--since <when>", "only events after this point, e.g. 7d, 2w, 2026-08-01")
    .option("-n, --limit <count>", "how many events to show, newest last", "40")
    .option("--all", "show every event, ignoring the limit")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<
        GlobalOptions & {
          item?: string;
          op?: string;
          since?: string;
          limit: string;
          all?: boolean;
        }
      >();
      const store = await openStore(options);
      const limit = parseInteger(options.limit, "limit") ?? 40;

      const itemId = options.item ? store.resolveRef(options.item).id : undefined;
      if (options.op && !(options.op in OP_LABEL)) {
        throw new Error(`Unknown event kind "${options.op}". Try one of: ${Object.keys(OP_LABEL).join(", ")}`);
      }

      const events = await readHistory(store.paths, {
        ...(itemId ? { itemId } : {}),
        ...(options.op ? { op: options.op as HistoryOp } : {}),
        ...(options.since ? { since: parseSince(options.since) } : {}),
        ...(options.all ? {} : { limit }),
      });

      if (options.json) {
        printJson(events);
        return;
      }

      if (events.length === 0) {
        print(color.gray("No history yet. It fills up as you remember, verify and review knowledge."));
        return;
      }

      const days = groupByDay(events);
      const lines: string[] = [];
      for (const [day, dayEvents] of days) {
        lines.push(color.bold(dayHeading(day)));
        lines.push(
          table(
            [...dayEvents].reverse().map((event) => [
              `  ${color.gray(event.ts.slice(11, 16))}`,
              paintOp(event.op),
              event.summary,
              actorLabel(event),
              color.gray(event.itemId ? shortId(event.itemId) : (event.proposalId ?? "")),
            ]),
          ),
        );
        lines.push("");
      }
      print(lines.join("\n").trimEnd());

      if (!options.all && events.length === limit) {
        print();
        print(color.gray(`Showing the last ${limit} events. Use --all or -n to see more.`));
      }
    });
}
