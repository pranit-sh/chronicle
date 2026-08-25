import {
  CodicilStore,
  type Diagnosis,
  type DiagnosisLevel,
  codicilSizeBytes,
  isHealthy,
  runDoctor,
} from "@codicil/core";
import type { Command } from "commander";

import { color, print, printJson, table } from "../ui.js";
import { type GlobalOptions, resolveCwd } from "../workspace.js";

const LEVEL_HEADING: Record<DiagnosisLevel, string> = {
  error: "Problems that stop Codicil working",
  warning: "Worth fixing",
  info: "Notes",
};

function paint(level: DiagnosisLevel, text: string): string {
  if (level === "error") return color.red(text);
  if (level === "warning") return color.yellow(text);
  return color.gray(text);
}

function renderGroup(level: DiagnosisLevel, group: readonly Diagnosis[]): string[] {
  const lines = [paint(level, LEVEL_HEADING[level])];
  for (const diagnosis of group) {
    lines.push(`  ${diagnosis.message}`);
    if (diagnosis.file) lines.push(color.gray(`    in ${diagnosis.file}`));
    if (diagnosis.fix) lines.push(color.gray(`    ${diagnosis.fix}`));
  }
  return lines;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check the knowledge layer for merge conflicts, broken files and dangling references")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const cwd = resolveCwd(options);
      const report = await runDoctor(cwd);

      if (options.json) {
        printJson({ ...report, sizeBytes: report.initialized ? await codicilSizeBytes(cwd) : 0 });
        process.exitCode = isHealthy(report) ? 0 : 1;
        return;
      }

      const levels: DiagnosisLevel[] = ["error", "warning", "info"];
      const groups = levels.flatMap((level) => {
        const group = report.diagnoses.filter((diagnosis) => diagnosis.level === level);
        return group.length ? [...renderGroup(level, group), ""] : [];
      });

      if (groups.length) print(groups.join("\n").trimEnd());
      else print(color.green("The knowledge layer is healthy."));

      if (!report.initialized) {
        process.exitCode = 1;
        return;
      }

      // A store that opens is the real proof the layer is usable.
      let storeOpens = true;
      let itemCount = 0;
      let openError = "";
      try {
        const store = await CodicilStore.openAt(report.root);
        itemCount = store.all().length;
      } catch (error) {
        storeOpens = false;
        openError = error instanceof Error ? error.message : String(error);
      }

      print();
      const facts: string[][] = [
        [color.gray("items"), `${report.itemsChecked} checked`],
        [color.gray("size"), humanBytes(await codicilSizeBytes(cwd))],
        [
          color.gray("store"),
          storeOpens
            ? color.green(`opens with ${itemCount} item${itemCount === 1 ? "" : "s"}`)
            : color.red("will not open"),
        ],
      ];
      print(table(facts));

      if (!storeOpens) {
        print();
        print(color.red(openError));
      }

      const { error, warning } = report.counts;
      if (error || warning) {
        print();
        print(
          [
            error ? color.red(`${error} error${error === 1 ? "" : "s"}`) : "",
            warning ? color.yellow(`${warning} warning${warning === 1 ? "" : "s"}`) : "",
          ]
            .filter(Boolean)
            .join(color.gray(" · ")),
        );
      }

      process.exitCode = error > 0 || !storeOpens ? 1 : 0;
    });
}
