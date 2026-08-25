import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { type Actor, CodicilStore } from "@codicil/core";

const run = promisify(execFile);

export interface GlobalOptions {
  cwd?: string;
  actor?: string;
  json?: boolean;
}

export function resolveCwd(options: GlobalOptions): string {
  return options.cwd ? path.resolve(options.cwd) : process.cwd();
}

export async function openStore(options: GlobalOptions): Promise<CodicilStore> {
  return CodicilStore.open(resolveCwd(options));
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    const branch = stdout.trim();
    return branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything written through the CLI is attributed to a human, because agents
 * reach Codicil through MCP and are only ever allowed to stage proposals.
 */
export async function resolveActor(options: GlobalOptions): Promise<Actor> {
  const explicit = options.actor ?? process.env.CODICIL_ACTOR;
  if (explicit) return { kind: "human", id: explicit };

  try {
    const { stdout } = await run("git", ["config", "user.name"], { cwd: resolveCwd(options) });
    const name = stdout.trim();
    if (name) return { kind: "human", id: name };
  } catch {
    // Not a Git repo, or Git is not installed.
  }

  try {
    return { kind: "human", id: userInfo().username };
  } catch {
    return { kind: "human", id: "unknown" };
  }
}
