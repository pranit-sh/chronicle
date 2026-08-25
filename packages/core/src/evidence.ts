import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import picomatch from "picomatch";

import type { CodicilConfig, Evidence } from "./schema.js";

const run = promisify(execFile);

/**
 * Deterministic evidence predicates. Every check is a plain filesystem or Git
 * question with a yes or no answer, so verification needs no API key, gives the
 * same answer twice, and can run on every commit.
 */

export type CheckResult = "pass" | "fail" | "error" | "skipped";

export interface EvidenceCheck {
  evidence: Evidence;
  result: CheckResult;
  /** One line a human can act on. */
  detail: string;
  matches?: number;
}

/** Directories never worth walking, whatever the config says. */
const ALWAYS_PRUNE = new Set([".git", "node_modules"]);
const MAX_GREP_BYTES = 2_000_000;
const BINARY_SNIFF_BYTES = 8192;

export interface EvidenceContext {
  root: string;
  /** Every non-excluded file in the tree, repo relative and POSIX separated. */
  files: readonly string[];
  readText(relativePath: string): Promise<string | undefined>;
}

async function walk(root: string, isExcluded: (relativePath: string) => boolean): Promise<string[]> {
  const found: string[] = [];

  async function recurse(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ALWAYS_PRUNE.has(entry.name)) continue;
        // Probe with a child path so a `**/dist/**` style glob prunes the directory.
        if (isExcluded(`${relative}/probe`)) continue;
        await recurse(path.join(directory, entry.name), relative);
      } else if (entry.isFile() && !isExcluded(relative)) {
        found.push(relative);
      }
    }
  }

  await recurse(root, "");
  return found.sort();
}

export async function createEvidenceContext(
  root: string,
  config: CodicilConfig,
): Promise<EvidenceContext> {
  const isExcluded = config.exclude.length ? picomatch(config.exclude, { dot: true }) : () => false;
  const files = await walk(root, isExcluded);
  const cache = new Map<string, string | undefined>();

  return {
    root,
    files,
    async readText(relativePath: string) {
      if (cache.has(relativePath)) return cache.get(relativePath);
      let text: string | undefined;
      try {
        const absolute = path.join(root, relativePath);
        const stats = await stat(absolute);
        if (stats.size <= MAX_GREP_BYTES) {
          const buffer = await readFile(absolute);
          const sniff = buffer.subarray(0, BINARY_SNIFF_BYTES);
          if (!sniff.includes(0)) text = buffer.toString("utf8");
        }
      } catch {
        text = undefined;
      }
      cache.set(relativePath, text);
      return text;
    },
  };
}

function withinBounds(evidence: Evidence, matches: number): boolean {
  if (evidence.minMatches !== undefined && matches < evidence.minMatches) return false;
  if (evidence.maxMatches !== undefined && matches > evidence.maxMatches) return false;
  return true;
}

/**
 * Turns a match count into a verdict. `expect: present` means the thing the
 * knowledge described is still there; `expect: absent` means it is still not
 * there, which is how a rule like "never call the DB from handlers" is checked.
 */
function judge(evidence: Evidence, matches: number, what: string): EvidenceCheck {
  const bounded = withinBounds(evidence, matches);
  const satisfied = evidence.expect === "present" ? matches > 0 && bounded : matches === 0;

  if (satisfied) {
    return {
      evidence,
      result: "pass",
      matches,
      detail:
        evidence.expect === "present"
          ? `${what}: ${matches} match${matches === 1 ? "" : "es"}`
          : `${what}: still absent`,
    };
  }

  if (evidence.expect === "absent") {
    return { evidence, result: "fail", matches, detail: `${what}: expected absent, found ${matches}` };
  }
  if (matches > 0 && !bounded) {
    const bounds = [
      evidence.minMatches !== undefined ? `at least ${evidence.minMatches}` : undefined,
      evidence.maxMatches !== undefined ? `at most ${evidence.maxMatches}` : undefined,
    ]
      .filter(Boolean)
      .join(" and ");
    return { evidence, result: "fail", matches, detail: `${what}: found ${matches}, expected ${bounds}` };
  }
  return { evidence, result: "fail", matches, detail: `${what}: expected present, found none` };
}

async function commitExists(root: string, sha: string): Promise<boolean> {
  try {
    await run("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

export async function checkEvidence(
  evidence: Evidence,
  context: EvidenceContext,
): Promise<EvidenceCheck> {
  switch (evidence.kind) {
    case "ref":
      return {
        evidence,
        result: "skipped",
        detail: `reference ${evidence.label ?? evidence.url} cannot be checked automatically`,
      };

    case "file": {
      const normalized = evidence.path.replace(/^\.\//, "");
      const exists = context.files.includes(normalized);
      return judge(evidence, exists ? 1 : 0, `file ${evidence.path}`);
    }

    case "glob": {
      const matches = picomatch(evidence.glob, { dot: true });
      const count = context.files.filter((file) => matches(file)).length;
      return judge(evidence, count, `glob ${evidence.glob}`);
    }

    case "grep": {
      let pattern: RegExp;
      try {
        pattern = new RegExp(evidence.pattern, evidence.flags ?? "");
      } catch (error) {
        return {
          evidence,
          result: "error",
          detail: `invalid regular expression /${evidence.pattern}/: ${(error as Error).message}`,
        };
      }
      const inScope = picomatch(evidence.glob, { dot: true });
      const candidates = context.files.filter((file) => inScope(file));
      const hits: string[] = [];
      for (const file of candidates) {
        const text = await context.readText(file);
        if (text === undefined) continue;
        pattern.lastIndex = 0;
        if (pattern.test(text)) hits.push(file);
      }
      const verdict = judge(evidence, hits.length, `/${evidence.pattern}/ in ${evidence.glob}`);
      if (verdict.result === "fail" && hits.length > 0) {
        const shown = hits.slice(0, 3).join(", ");
        verdict.detail += ` (${shown}${hits.length > 3 ? `, +${hits.length - 3} more` : ""})`;
      }
      if (candidates.length === 0) {
        verdict.detail += " — no files matched the glob at all";
      }
      return verdict;
    }

    case "commit": {
      const exists = await commitExists(context.root, evidence.sha);
      return judge(evidence, exists ? 1 : 0, `commit ${evidence.sha}`);
    }
  }
}
