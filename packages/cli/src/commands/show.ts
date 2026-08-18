import type { Command } from "commander";

import { formatDetail, print, printJson } from "../ui.js";
import { type GlobalOptions, openStore } from "../workspace.js";

export function registerShow(program: Command): void {
  program
    .command("show")
    .description("Show one knowledge item in full, including provenance and evidence")
    .argument("<reference>", "id, id prefix, or filename slug")
    .action(async function (this: Command, reference: string) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const store = await openStore(options);
      const item = store.resolveRef(reference);

      if (options.json) printJson(item);
      else print(formatDetail(item));
    });
}
