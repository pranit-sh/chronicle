import {
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  type KnowledgeFilter,
  type KnowledgeSourceName,
  type KnowledgeStatusName,
  type KnowledgeTypeName,
} from "@chronicle/core";
import type { Command } from "commander";

import { collect } from "../options.js";
import { color, formatListRow, print, printJson, table } from "../ui.js";
import { type GlobalOptions, openStore } from "../workspace.js";

interface ListOptions extends GlobalOptions {
  type?: string[];
  status?: string[];
  scope?: string;
  tag?: string[];
  source?: string[];
  query?: string;
  archived?: boolean;
}

export function summaryLine(counts: Record<KnowledgeStatusName, number>): string {
  const parts: string[] = [];
  if (counts.active) parts.push(color.green(`${counts.active} active`));
  if (counts.confirmed) parts.push(color.cyan(`${counts.confirmed} confirmed`));
  if (counts.proposed) parts.push(color.yellow(`${counts.proposed} proposed`));
  if (counts.stale) parts.push(color.red(`${counts.stale} stale`));
  if (counts.archived) parts.push(color.gray(`${counts.archived} archived`));
  return parts.length ? parts.join(color.gray(" \u00B7 ")) : color.gray("nothing recorded yet");
}

export function registerList(program: Command): void {
  program
    .command("list")
    .alias("ls")
    .description("List knowledge items")
    .option("--type <type>", `filter by type (${KNOWLEDGE_TYPES.join(", ")}), repeatable`, collect, [])
    .option("--status <status>", `filter by status (${KNOWLEDGE_STATUSES.join(", ")}), repeatable`, collect, [])
    .option("--scope <scope>", "filter to a scope and everything beneath it")
    .option("--tag <tag>", "filter by tag, repeatable", collect, [])
    .option("--source <source>", "filter by source (human, ai, observed, imported)", collect, [])
    .option("-q, --query <text>", "free text match against title, body and tags")
    .option("--archived", "include archived items")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<ListOptions>();
      const store = await openStore(options);

      const filter: KnowledgeFilter = {
        types: options.type?.length ? (options.type as KnowledgeTypeName[]) : undefined,
        statuses: options.status?.length ? (options.status as KnowledgeStatusName[]) : undefined,
        sources: options.source?.length ? (options.source as KnowledgeSourceName[]) : undefined,
        scope: options.scope,
        tags: options.tag?.length ? options.tag : undefined,
        query: options.query,
        includeArchived: options.archived,
      };
      const items = store.list(filter);

      if (options.json) {
        printJson({ items, stats: store.stats() });
        return;
      }

      if (items.length === 0) {
        print(color.gray("No knowledge items match that filter."));
        print(summaryLine(store.stats()));
        return;
      }

      print(table(items.map(formatListRow)));
      print();
      print(summaryLine(store.stats()));
    });
}
