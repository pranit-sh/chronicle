import { ChronicleError } from "@chronicle/core";
import type { Command } from "commander";

import { color, print, printJson, shortId } from "../ui.js";
import { type GlobalOptions, openStore, resolveActor } from "../workspace.js";

export function registerLifecycle(program: Command): void {
  program
    .command("archive")
    .description("Keep an item for history but stop supplying it to agents")
    .argument("<reference>", "id, id prefix, or filename slug")
    .option("--reason <text>", "why it is being archived, recorded in the history log")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions & { reason?: string }>();
      const store = await openStore(options);
      const actor = await resolveActor(options);
      const item = await store.archive(reference, actor, options.reason);

      if (options.json) printJson(item);
      else print(`${color.gray("Archived")} ${item.title} ${color.gray(shortId(item.id))}`);
    });

  program
    .command("restore")
    .description("Bring an archived item back into active knowledge")
    .argument("<reference>", "id, id prefix, or filename slug")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const actor = await resolveActor(options);
      const item = await store.restore(reference, actor);

      if (options.json) printJson(item);
      else print(`${color.green("Restored")} ${item.title} ${color.gray(shortId(item.id))}`);
    });

  program
    .command("delete")
    .description("Permanently remove an item, losing its file (prefer archive)")
    .argument("<reference>", "id, id prefix, or filename slug")
    .option("-y, --yes", "confirm the deletion")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions & { yes?: boolean }>();
      const store = await openStore(options);
      const item = store.resolveRef(reference);
      if (!options.yes) {
        throw new ChronicleError(
          "invalid_input",
          `Refusing to delete "${item.title}" without --yes. Consider \`chronicle archive ${shortId(item.id)}\` instead, which keeps the history.`,
        );
      }
      const actor = await resolveActor(options);
      await store.remove(reference, actor);

      if (options.json) printJson({ deleted: item.id });
      else print(`${color.red("Deleted")} ${item.title} ${color.gray(shortId(item.id))}`);
    });
}
