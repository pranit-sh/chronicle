import {
  type ItemVerification,
  type VerificationOutcome,
  suggestedActions,
  verify,
} from "@codicil/core";
import type { Command } from "commander";

import { color, print, printJson, shortId, table } from "../ui.js";
import { type GlobalOptions, openStore, resolveActor } from "../workspace.js";

const OUTCOME_LABEL: Record<VerificationOutcome, string> = {
  verified: "verified",
  stale: "stale",
  contradicted: "contradicted",
  violated: "violated",
  expired: "expired",
  unverifiable: "unchecked",
  error: "error",
};

function paint(outcome: VerificationOutcome, text: string): string {
  switch (outcome) {
    case "verified":
      return color.green(text);
    case "violated":
      return color.magenta(text);
    case "contradicted":
    case "stale":
      return color.red(text);
    case "expired":
      return color.yellow(text);
    case "error":
      return color.yellow(text);
    case "unverifiable":
      return color.gray(text);
  }
}

/** Headline for a group of results, phrased as what the developer should do. */
const GROUP_HEADING: Partial<Record<VerificationOutcome, string>> = {
  violated: "The code breaks these rules",
  contradicted: "The repository disagrees with these",
  stale: "The evidence behind these has gone",
  expired: "These have passed their expiry date",
  error: "These evidence checks could not run",
};

function renderGroup(outcome: VerificationOutcome, results: readonly ItemVerification[]): string[] {
  const lines: string[] = [];
  lines.push(paint(outcome, GROUP_HEADING[outcome] ?? OUTCOME_LABEL[outcome]));
  for (const result of results) {
    lines.push(`  ${color.bold(result.item.title)} ${color.gray(shortId(result.item.id))}`);
    lines.push(`    ${result.summary}`);
    // The summary already quotes the first failing check, so only list the rest.
    const failing = result.checks.filter(
      (check) => check.result === "fail" || check.result === "error",
    );
    for (const check of failing.slice(1)) {
      lines.push(color.gray(`    · ${check.detail}`));
    }
    const actions = suggestedActions(outcome);
    if (actions.length) lines.push(color.gray(`    ${actions.join("  ·  ")}`));
  }
  return lines;
}

export function registerVerify(program: Command): void {
  program
    .command("verify")
    .description("Re-check stored knowledge against the code and mark what no longer holds")
    .argument("[references...]", "specific items to verify; omit to verify everything with evidence")
    .option("--all", "also list items that carry no machine checkable evidence")
    .option("--dry-run", "report without writing any status change")
    .option("--archived", "include archived items")
    .action(async function (this: Command, references: string[]) {
      const options = this.optsWithGlobals<
        GlobalOptions & { all?: boolean; dryRun?: boolean; archived?: boolean }
      >();
      const store = await openStore(options);
      const actor = await resolveActor(options);

      const report = await verify(store, actor, {
        references,
        ...(options.dryRun ? { dryRun: true } : {}),
        ...(options.all ? { includeUnverifiable: true } : {}),
        ...(options.archived ? { includeArchived: true } : {}),
      });

      if (options.json) {
        printJson({
          checkedAt: report.checkedAt,
          counts: report.counts,
          filesScanned: report.filesScanned,
          results: report.results.map((result) => ({
            id: result.item.id,
            title: result.item.title,
            outcome: result.outcome,
            summary: result.summary,
            statusChanged: result.statusChanged,
            checks: result.checks.map((check) => ({
              kind: check.evidence.kind,
              expect: check.evidence.expect,
              result: check.result,
              detail: check.detail,
            })),
          })),
        });
        return;
      }

      if (report.results.length === 0) {
        print(color.gray("Nothing to verify: no knowledge item has machine checkable evidence yet."));
        print(color.gray("Attach some with codicil evidence add <id> --grep <pattern> --in <glob>"));
        return;
      }

      const order: VerificationOutcome[] = ["violated", "contradicted", "stale", "expired", "error"];
      const problems = order.flatMap((outcome) => {
        const group = report.results.filter((result) => result.outcome === outcome);
        return group.length ? [...renderGroup(outcome, group), ""] : [];
      });

      if (problems.length) print(problems.join("\n").trimEnd());
      else print(color.green("Everything still holds."));

      const unverifiable = report.results.filter((result) => result.outcome === "unverifiable");
      if (unverifiable.length) {
        print();
        print(color.gray("No evidence attached, so not checked:"));
        print(
          table(
            unverifiable.map((result) => [
              `  ${color.gray(shortId(result.item.id))}`,
              result.item.title,
            ]),
          ),
        );
      }

      print();
      const summary = (Object.entries(report.counts) as Array<[VerificationOutcome, number]>)
        .filter(([, count]) => count > 0)
        .map(([outcome, count]) => paint(outcome, `${count} ${OUTCOME_LABEL[outcome]}`))
        .join(color.gray(" · "));
      print(`${summary}${color.gray(`  (${report.filesScanned} files scanned)`)}`);
      if (options.dryRun) print(color.gray("Dry run: nothing was written."));
    });
}
