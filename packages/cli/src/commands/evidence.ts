import { ChronicleError, type Evidence, EvidenceSchema } from "@chronicle/core";
import type { Command } from "commander";

import { parseInteger } from "../options.js";
import { color, describeEvidence, print, printJson, shortId, table } from "../ui.js";
import { type GlobalOptions, openStore, resolveActor } from "../workspace.js";

interface AddOptions extends GlobalOptions {
  file?: string;
  glob?: string;
  grep?: string;
  in?: string;
  flags?: string;
  commit?: string;
  ref?: string;
  label?: string;
  expect?: string;
  min?: string;
  max?: string;
}

function buildEvidence(options: AddOptions): Evidence {
  const expect = options.expect ?? "present";
  const bounds = {
    ...(options.min !== undefined ? { minMatches: parseInteger(options.min, "min") } : {}),
    ...(options.max !== undefined ? { maxMatches: parseInteger(options.max, "max") } : {}),
  };

  const candidates = [options.file, options.glob, options.grep, options.commit, options.ref].filter(
    (value) => value !== undefined,
  );
  if (candidates.length === 0) {
    throw new ChronicleError(
      "invalid_input",
      "Say what to check: --file, --glob, --grep, --commit or --ref.",
    );
  }
  if (candidates.length > 1) {
    throw new ChronicleError("invalid_input", "Attach one predicate at a time.");
  }

  if (options.file) return EvidenceSchema.parse({ kind: "file", path: options.file, expect });
  if (options.glob) return EvidenceSchema.parse({ kind: "glob", glob: options.glob, expect, ...bounds });
  if (options.grep) {
    return EvidenceSchema.parse({
      kind: "grep",
      pattern: options.grep,
      ...(options.in ? { glob: options.in } : {}),
      ...(options.flags ? { flags: options.flags } : {}),
      expect,
      ...bounds,
    });
  }
  if (options.commit) return EvidenceSchema.parse({ kind: "commit", sha: options.commit, expect });
  return EvidenceSchema.parse({
    kind: "ref",
    url: options.ref,
    ...(options.label ? { label: options.label } : {}),
  });
}

export function registerEvidence(program: Command): void {
  const evidence = program
    .command("evidence")
    .description("Attach the checks that decide whether a piece of knowledge is still true");

  evidence
    .command("add")
    .description("Attach an evidence predicate to a knowledge item")
    .argument("<reference>", "id, id prefix, or filename slug")
    .option("--file <path>", "check that a file exists")
    .option("--glob <glob>", "check that files matching a glob exist")
    .option("--grep <pattern>", "check for a regular expression in the code")
    .option("--in <glob>", "restrict --grep to files matching this glob", "**/*")
    .option("--flags <flags>", "regular expression flags for --grep")
    .option("--commit <sha>", "check that a commit is still reachable")
    .option("--ref <url>", "record a reference that cannot be checked automatically")
    .option("--label <text>", "label for --ref")
    .option(
      "--expect <present|absent>",
      "whether the match should be there. absent turns the check into a contradiction detector",
      "present",
    )
    .option("--min <n>", "minimum number of matches")
    .option("--max <n>", "maximum number of matches")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<AddOptions>();
      if (options.expect !== "present" && options.expect !== "absent") {
        throw new ChronicleError("invalid_input", "--expect must be present or absent.");
      }
      const store = await openStore(options);
      const actor = await resolveActor(options);
      const current = store.resolveRef(reference);
      const added = buildEvidence(options);

      const item = await store.update(
        current.id,
        { evidence: [...current.evidence, added] },
        actor,
        { reason: `Attached evidence to "${current.title}"` },
      );

      if (options.json) {
        printJson(item);
        return;
      }
      print(`${color.green("Attached")} ${describeEvidence(added)}`);
      print(color.gray(`to ${item.title} (${shortId(item.id)})`));
      print();
      print(color.gray(`Check it now with chronicle verify ${shortId(item.id)}`));
    });

  evidence
    .command("list")
    .description("List the evidence attached to an item")
    .argument("<reference>", "id, id prefix, or filename slug")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const item = store.resolveRef(reference);

      if (options.json) {
        printJson(item.evidence);
        return;
      }
      if (item.evidence.length === 0) {
        print(color.gray(`No evidence attached to "${item.title}".`));
        return;
      }
      print(
        table(
          item.evidence.map((entry, index) => [
            color.gray(String(index)),
            describeEvidence(entry),
            color.gray(entry.lastResult ?? "unchecked"),
          ]),
        ),
      );
    });

  evidence
    .command("remove")
    .alias("rm")
    .description("Detach an evidence predicate by its index")
    .argument("<reference>", "id, id prefix, or filename slug")
    .argument("<index>", "index shown by chronicle evidence list")
    .action(async function (this: Command, reference: string, index: string) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const actor = await resolveActor(options);
      const current = store.resolveRef(reference);
      const position = parseInteger(index, "index") ?? -1;

      if (position < 0 || position >= current.evidence.length) {
        throw new ChronicleError(
          "invalid_input",
          `"${current.title}" has ${current.evidence.length} evidence entries, so ${index} is out of range.`,
        );
      }

      const removed = current.evidence[position] as Evidence;
      const item = await store.update(
        current.id,
        { evidence: current.evidence.filter((_, at) => at !== position) },
        actor,
        { reason: `Removed evidence from "${current.title}"` },
      );

      if (options.json) printJson(item);
      else print(`${color.red("Removed")} ${describeEvidence(removed)}`);
    });
}
