import {
  ChronicleError,
  type DiffLine,
  type Proposal,
  acceptProposal,
  classifyStatement,
  listProposals,
  proposalDiff,
  proposeChange,
  proposeCreate,
  rejectProposal,
  resolveProposal,
} from "@chronicle/core";
import type { Command } from "commander";

import { collect } from "../options.js";
import { color, formatDetail, print, printJson, relativeTime, shortId, table } from "../ui.js";
import { type GlobalOptions, openStore, resolveActor } from "../workspace.js";

function colorizeDiff(lines: readonly DiffLine[]): string {
  return lines
    .map((line) => {
      const text = `${line.marker} ${line.text}`;
      if (line.marker === "+") return color.green(text);
      if (line.marker === "-") return color.red(text);
      if (line.marker === "~") return color.yellow(text);
      return color.gray(text);
    })
    .join("\n");
}

function proposalHeadline(proposal: Proposal): string {
  if (proposal.op === "create") return `new ${proposal.payload?.type}: ${proposal.payload?.title}`;
  return `${proposal.op} ${proposal.targetId ? shortId(proposal.targetId) : ""}`.trim();
}

export function registerProposals(program: Command): void {
  program
    .command("proposals")
    .alias("ps")
    .description("List knowledge changes staged by agents for your review")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const proposals = await listProposals(store.paths);

      if (options.json) {
        printJson(proposals);
        return;
      }

      if (proposals.length === 0) {
        print(color.gray("No proposals are waiting for review."));
        return;
      }

      print(
        table(
          proposals.map((proposal) => [
            color.gray(shortId(proposal.id)),
            proposal.op === "create"
              ? color.green(proposal.op)
              : proposal.op === "archive"
                ? color.red(proposal.op)
                : color.yellow(proposal.op),
            proposalHeadline(proposal),
            color.gray(`${proposal.proposedBy.id}, ${relativeTime(proposal.createdAt)}`),
          ]),
        ),
      );
      print();
      print(
        color.gray(
          `Review with chronicle diff <id>, then chronicle accept <id> or chronicle reject <id>.`,
        ),
      );
    });

  program
    .command("diff")
    .description("Show exactly what accepting a proposal would change")
    .argument("[reference]", "proposal id or prefix; omit to show every pending proposal")
    .action(async function (this: Command, reference: string | undefined) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const proposals = reference
        ? [await resolveProposal(store.paths, reference)]
        : await listProposals(store.paths);

      if (proposals.length === 0) {
        print(color.gray("No proposals are waiting for review."));
        return;
      }

      const rendered = proposals.map((proposal) => {
        const target = proposal.targetId ? store.get(proposal.targetId) : undefined;
        return { proposal, target, diff: proposalDiff(proposal, target) };
      });

      if (options.json) {
        printJson(rendered.map(({ proposal, diff }) => ({ proposal, diff })));
        return;
      }

      rendered.forEach(({ proposal, diff }, index) => {
        if (index > 0) print();
        print(`${color.bold(shortId(proposal.id))} ${color.gray(`from ${proposal.proposedBy.id}`)}`);
        print(color.gray(`  ${proposal.reason}`));
        print();
        print(colorizeDiff(diff));
      });
      print();
      print(color.gray("chronicle accept <id> · chronicle accept <id> --title \"...\" --scope <scope> · chronicle reject <id>"));
    });

  program
    .command("accept")
    .description("Apply a staged proposal to the knowledge layer, optionally correcting it first")
    .argument("<reference>", "proposal id or prefix")
    .option("--title <text>", "correct the title before accepting")
    .option("--scope <scope>", "correct the scope before accepting, repeatable", collect, [])
    .option("--tag <tag>", "correct the tags before accepting, repeatable", collect, [])
    .option("--type <type>", "correct the knowledge type before accepting")
    .option("--priority <n>", "set the priority before accepting")
    .option("--pin", "pin the item as it is accepted")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<
        GlobalOptions & {
          title?: string;
          scope?: string[];
          tag?: string[];
          type?: string;
          priority?: string;
          pin?: boolean;
        }
      >();
      const store = await openStore(options);
      const actor = await resolveActor(options);

      const overrides: Record<string, unknown> = {};
      if (options.title) overrides.title = options.title;
      if (options.scope?.length) overrides.scopes = options.scope;
      if (options.tag?.length) overrides.tags = options.tag;
      if (options.type) overrides.type = options.type;
      if (options.priority) overrides.priority = Number(options.priority);
      if (options.pin) overrides.pinned = true;

      const { proposal, item } = await acceptProposal(store, reference, actor, { overrides });

      if (options.json) {
        printJson({ proposal, item });
        return;
      }

      const edited = Object.keys(overrides).length > 0;
      print(`${color.green("Accepted")} ${proposal.op} proposal ${color.gray(shortId(proposal.id))}${edited ? color.gray(" with your edits") : ""}`);
      if (item) {
        print();
        print(formatDetail(item));
      }
    });

  program
    .command("reject")
    .description("Discard a staged proposal, recording the decision in the history log")
    .argument("<reference>", "proposal id or prefix")
    .option("--reason <text>", "why it was rejected")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions & { reason?: string }>();
      const store = await openStore(options);
      const actor = await resolveActor(options);
      const proposal = await rejectProposal(store, reference, actor, options.reason);

      if (options.json) printJson(proposal);
      else print(`${color.red("Rejected")} ${proposal.op} proposal ${color.gray(shortId(proposal.id))}`);
    });

  program
    .command("propose")
    .description("Stage a change for review instead of writing it straight into the knowledge layer")
    .argument("[statement...]", "the knowledge to propose, for a new item")
    .option("--update <reference>", "propose a change to an existing item instead")
    .option("--archive <reference>", "propose archiving an existing item")
    .option("--title <text>", "new title, with --update")
    .option("--scope <scope>", "scope, repeatable", collect, [])
    .option("--type <type>", "force the knowledge type")
    .option("--reason <text>", "why this is being proposed")
    .option("--as-agent <name>", "stage it as though an agent proposed it, to test the review flow")
    .action(async function (this: Command, statement: string[]) {
      const options = this.optsWithGlobals<
        GlobalOptions & {
          update?: string;
          archive?: string;
          title?: string;
          scope?: string[];
          type?: string;
          reason?: string;
          asAgent?: string;
        }
      >();
      const store = await openStore(options);
      const human = await resolveActor(options);
      const proposedBy = options.asAgent ? ({ kind: "agent", id: options.asAgent } as const) : human;
      const reason = options.reason ?? "Staged from the command line";

      let proposal: Proposal;
      if (options.archive) {
        proposal = await proposeChange(store, {
          targetRef: options.archive,
          op: "archive",
          proposedBy,
          reason,
        });
      } else if (options.update) {
        const patch: Record<string, unknown> = {};
        if (options.title) patch.title = options.title;
        if (options.scope?.length) patch.scopes = options.scope;
        if (statement.length) patch.body = statement.join(" ");
        proposal = await proposeChange(store, {
          targetRef: options.update,
          op: "update",
          patch,
          proposedBy,
          reason,
        });
      } else {
        if (statement.length === 0) {
          throw new ChronicleError("invalid_input", "Say what to propose, or pass --update / --archive.");
        }
        const text = statement.join(" ");
        const classified = classifyStatement(text, Object.keys(store.config.scopes));
        proposal = await proposeCreate(store, {
          draft: {
            type: (options.type as never) ?? classified.type,
            title: classified.title,
            body: classified.body,
            scopes: options.scope?.length ? options.scope : classified.scopes,
            ...(classified.enforcement ? { enforcement: classified.enforcement } : {}),
            provenance: { origin: "command", ref: "chronicle propose" },
          },
          proposedBy,
          reason,
        });
      }

      if (options.json) {
        printJson(proposal);
        return;
      }

      print(`${color.yellow("Staged")} ${proposal.op} proposal ${color.gray(shortId(proposal.id))}`);
      print();
      print(colorizeDiff(proposalDiff(proposal, proposal.targetId ? store.get(proposal.targetId) : undefined)));
      print();
      print(color.gray(`Review it with chronicle diff ${shortId(proposal.id)}`));
    });
}
