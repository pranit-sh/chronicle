import { serveChronicleStdio } from "@chronicle/mcp";
import type { Command } from "commander";

import { type GlobalOptions, resolveCwd } from "../workspace.js";

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Run the MCP server so coding agents resolve context and stage knowledge proposals")
    .option("--agent <name>", "identify the connecting agent in provenance records")
    .action(async function (this: Command) {
      const options = this.optsWithGlobals<GlobalOptions & { agent?: string }>();
      const cwd = resolveCwd(options);
      // stdout is the MCP transport from here on, so this notice goes to stderr.
      process.stderr.write(`chronicle: serving knowledge from ${cwd} over stdio\n`);
      serveChronicleStdio({ cwd, ...(options.agent ? { agentId: options.agent } : {}) });
    });
}
