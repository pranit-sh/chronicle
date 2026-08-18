import { ChronicleError } from "@chronicle/core";
import { Command, CommanderError } from "commander";

import { registerContext } from "./commands/context.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerEvidence } from "./commands/evidence.js";
import { registerHistory } from "./commands/history.js";
import { registerInit } from "./commands/init.js";
import { registerLifecycle } from "./commands/lifecycle.js";
import { registerList } from "./commands/list.js";
import { registerProposals } from "./commands/proposals.js";
import { registerRemember } from "./commands/remember.js";
import { registerServe } from "./commands/serve.js";
import { registerShow } from "./commands/show.js";
import { registerVerify } from "./commands/verify.js";
import { color } from "./ui.js";

export const VERSION = "0.1.0";

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("chronicle")
    .description(
      [
        "A developer-controlled, versioned knowledge layer for AI coding agents.",
        "",
        "Knowledge lives as Markdown in .context/ and is committed alongside your code,",
        "so it follows branches, reviews and merges exactly like the code does.",
      ].join("\n"),
    )
    .version(VERSION)
    .option("--cwd <dir>", "run as if started in this directory")
    .option("--actor <name>", "attribute the change to this person")
    .option("--json", "emit machine readable JSON instead of formatted output")
    .showHelpAfterError()
    .enablePositionalOptions();

  registerInit(program);
  registerRemember(program);
  registerList(program);
  registerShow(program);
  registerContext(program);
  registerProposals(program);
  registerEvidence(program);
  registerVerify(program);
  registerHistory(program);
  registerLifecycle(program);
  registerDoctor(program);
  registerServe(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof ChronicleError) {
      process.stderr.write(`${color.red("error")} ${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`${color.red("error")} ${(error as Error).message}\n`);
    if (process.env.CHRONICLE_DEBUG) process.stderr.write(`${(error as Error).stack}\n`);
    process.exitCode = 1;
  }
}

await main();
