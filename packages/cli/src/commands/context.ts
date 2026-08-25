import {
  type ContextPackage,
  type ResolutionRequest,
  renderContextPackage,
  resolveContextForStore,
} from "@codicil/core";
import type { Command } from "commander";

import { collect, parseInteger } from "../options.js";
import { color, print, printJson, shortId, table } from "../ui.js";
import { type GlobalOptions, currentBranch, openStore, resolveCwd } from "../workspace.js";

interface ContextOptions extends GlobalOptions {
  file?: string;
  dir?: string;
  task?: string;
  open?: string[];
  branch?: string;
  maxItems?: string;
  maxChars?: string;
  stale?: boolean;
  proposed?: boolean;
  trace?: boolean;
}

function renderTrace(pkg: ContextPackage): string {
  const lines: string[] = [];
  lines.push(color.bold("Why each item was included"));
  lines.push(
    table(
      pkg.entries.map((entry) => [
        `  ${color.gray(shortId(entry.item.id))}`,
        entry.score.toFixed(2),
        entry.item.title,
        color.gray(entry.reasons.join("; ")),
      ]),
    ),
  );

  if (pkg.trace.dropped.length) {
    lines.push("");
    lines.push(color.bold("What was left out"));
    lines.push(
      table(
        pkg.trace.dropped.map((entry) => [
          `  ${color.gray(shortId(entry.id))}`,
          entry.title,
          color.gray(entry.reason),
        ]),
      ),
    );
  }
  return lines.join("\n");
}

export function registerContext(program: Command): void {
  program
    .command("context")
    .description("Preview the Codicil context an AI agent resolves for a file and task")
    .option("-f, --file <path>", "the file being worked on")
    .option("-d, --dir <path>", "the directory being worked in")
    .option("-t, --task <text>", "what the agent has been asked to do")
    .option("--open <path>", "another open file, repeatable", collect, [])
    .option("--branch <name>", "override the detected Git branch")
    .option("--max-items <n>", "override the configured item budget")
    .option("--max-chars <n>", "override the configured character budget")
    .option("--no-stale", "leave stale knowledge out entirely")
    .option("--proposed", "include knowledge that is still only proposed")
    .option("--trace", "show per item scores and everything that was left out")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<ContextOptions>();
      const store = await openStore(options);

      const maxItems = parseInteger(options.maxItems, "max-items");
      const maxChars = parseInteger(options.maxChars, "max-chars");
      const request: ResolutionRequest = {
        ...(options.file ? { file: options.file } : {}),
        ...(options.dir ? { directory: options.dir } : {}),
        ...(options.task ? { task: options.task } : {}),
        ...(options.open?.length ? { openFiles: options.open } : {}),
        branch: options.branch ?? (await currentBranch(resolveCwd(options))),
        includeStale: options.stale,
        ...(options.proposed ? { includeProposed: true } : {}),
        ...(maxItems !== undefined || maxChars !== undefined
          ? { budget: { ...(maxItems !== undefined ? { maxItems } : {}), ...(maxChars !== undefined ? { maxChars } : {}) } }
          : {}),
      };

      const pkg = resolveContextForStore(store, request);

      if (options.json) {
        printJson({
          markdown: renderContextPackage(pkg),
          entries: pkg.entries.map((entry) => ({
            id: entry.item.id,
            title: entry.item.title,
            type: entry.item.type,
            score: entry.score,
            reasons: entry.reasons,
          })),
          trace: pkg.trace,
          stats: pkg.stats,
        });
        return;
      }

      print(renderContextPackage(pkg));

      if (options.trace) {
        print();
        print(renderTrace(pkg));
      } else if (pkg.trace.dropped.length) {
        print();
        print(color.gray(`${pkg.trace.dropped.length} item(s) left out. Run with --trace to see why.`));
      }
    });
}
