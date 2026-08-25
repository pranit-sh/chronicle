import { CODICIL_DIR, CodicilStore } from "@codicil/core";
import type { Command } from "commander";

import { color, print, printJson } from "../ui.js";
import { type GlobalOptions, resolveActor, resolveCwd } from "../workspace.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description(`Create the ${CODICIL_DIR} knowledge layer in this project`)
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const root = resolveCwd(options);
      const actor = await resolveActor(options);
      const store = await CodicilStore.init(root, actor);

      if (options.json) {
        printJson({ root, codicilDir: store.paths.codicilDir });
        return;
      }

      print(
        `${color.green("Initialized")} the Codicil knowledge layer in ${color.bold(`${CODICIL_DIR}/`)}`,
      );
      print();
      print("Next steps:");
      print(`  1. Describe your scopes in ${color.bold(`${CODICIL_DIR}/config.yaml`)}`);
      print(`  2. Capture durable human-authored knowledge: ${color.bold('codicil remember "Never edit generated/**"')}`);
      print(`  3. Connect your coding agent to MCP with: ${color.bold("codicil serve")}`);
      print(`  4. Preview resolved agent context with: ${color.bold("codicil context --file src/index.ts")}`);
    });
}
