import { ChronicleStore } from "@chronicle/core";
import type { Command } from "commander";

import { color, print, printJson } from "../ui.js";
import { type GlobalOptions, resolveActor, resolveCwd } from "../workspace.js";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Create the .context knowledge layer in this project")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<GlobalOptions>();
      const root = resolveCwd(options);
      const actor = await resolveActor(options);
      const store = await ChronicleStore.init(root, actor);

      if (options.json) {
        printJson({ root, contextDir: store.paths.contextDir });
        return;
      }

      print(`${color.green("Initialized")} the Chronicle knowledge layer in ${color.bold(".context/")}`);
      print();
      print("Next steps:");
      print(`  1. Describe your scopes in ${color.bold(".context/config.yaml")}`);
      print(`  2. Capture your first rule: ${color.bold('chronicle remember "Never edit generated/**"')}`);
      print(`  3. See what an agent would receive: ${color.bold("chronicle context --file src/index.ts")}`);
    });
}
