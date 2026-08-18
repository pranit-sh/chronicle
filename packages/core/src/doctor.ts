import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "./config.js";
import { ChronicleError, formatZodError } from "./errors.js";
import { pathExists } from "./fs-utils.js";
import { parseMarkdownDocument } from "./frontmatter.js";
import { listProposals } from "./proposals.js";
import { type ChroniclePaths, chroniclePaths, toRepoRelative } from "./paths.js";
import { KnowledgeFrontmatterSchema, TYPE_DIRECTORIES } from "./schema.js";

/**
 * Health checks over `.context/` itself.
 *
 * Everything here reads the directory directly rather than going through the
 * store, because the whole point is to explain why the store will not open.
 */

export type DiagnosisLevel = "error" | "warning" | "info";

export interface Diagnosis {
  level: DiagnosisLevel;
  /** Stable machine-readable check name, e.g. `conflict_markers`. */
  code: string;
  message: string;
  /** Repo-relative path the problem lives in, when there is one. */
  file?: string;
  /** What the developer should do about it. */
  fix?: string;
}

export interface DoctorReport {
  root: string;
  initialized: boolean;
  diagnoses: Diagnosis[];
  counts: Record<DiagnosisLevel, number>;
  /** Number of Markdown knowledge files that parsed cleanly. */
  itemsChecked: number;
}

/**
 * Git leaves these at the start of a line when it cannot merge a file. Built at
 * runtime so this source file is not itself flagged by the check.
 */
const CONFLICT_MARKERS = ["<".repeat(7), "=".repeat(7), ">".repeat(7)];

function findConflictMarkers(contents: string): number[] {
  const lines: number[] = [];
  contents.split("\n").forEach((line, index) => {
    if (CONFLICT_MARKERS.some((marker) => line.startsWith(marker))) lines.push(index + 1);
  });
  return lines;
}

/** Every file under `.context/`, including dotfiles, excluding the derived cache. */
async function contextFiles(paths: ChroniclePaths): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (full === paths.cacheDir) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) found.push(full);
    }
  }
  await walk(paths.contextDir);
  return found.sort();
}

export async function runDoctor(root: string): Promise<DoctorReport> {
  const paths = chroniclePaths(root);
  const diagnoses: Diagnosis[] = [];
  const relative = (file: string) => toRepoRelative(root, file);

  const add = (diagnosis: Diagnosis) => diagnoses.push(diagnosis);

  if (!(await pathExists(paths.contextDir))) {
    return {
      root,
      initialized: false,
      diagnoses: [
        {
          level: "error",
          code: "not_initialized",
          message: `No .context directory in ${root}.`,
          fix: "Run chronicle init",
        },
      ],
      counts: { error: 1, warning: 0, info: 0 },
      itemsChecked: 0,
    };
  }

  const files = await contextFiles(paths);

  // 1. Conflict markers anywhere under .context/, including config and history.
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    const lines = findConflictMarkers(raw);
    if (lines.length === 0) continue;
    add({
      level: "error",
      code: "conflict_markers",
      message: `Unresolved Git conflict markers on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}.`,
      file: relative(file),
      fix: "Resolve the merge by hand, then re-run chronicle doctor",
    });
  }

  const hasConflict = diagnoses.some((diagnosis) => diagnosis.code === "conflict_markers");

  // 2. Config parses and is a valid Chronicle config.
  let config;
  try {
    config = await loadConfig(paths);
    if (!(await pathExists(paths.configFile))) {
      add({
        level: "warning",
        code: "missing_config",
        message: "No config.yaml, so the built-in defaults are in force.",
        fix: "Run chronicle init, or write .context/config.yaml by hand",
      });
    }
  } catch (error) {
    add({
      level: "error",
      code: "invalid_config",
      message: error instanceof ChronicleError ? error.message : String(error),
      file: relative(paths.configFile),
    });
  }

  // 3. Every knowledge file parses, and ids are unique.
  const markdown = files.filter(
    (file) =>
      file.endsWith(".md") &&
      (file.startsWith(paths.knowledgeDir + path.sep) || file.startsWith(paths.archiveDir + path.sep)),
  );
  const byId = new Map<string, string[]>();
  const known = new Set<string>();
  let itemsChecked = 0;

  for (const file of markdown) {
    const raw = await readFile(file, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    if (findConflictMarkers(raw).length) continue; // already reported
    const parsed = KnowledgeFrontmatterSchema.safeParse(parseMarkdownDocument(raw).data);
    if (!parsed.success) {
      add({
        level: "error",
        code: "invalid_item",
        message: formatZodError(parsed.error, "Not a valid knowledge item:"),
        file: relative(file),
        fix: "Fix the frontmatter, or delete the file if it was created by hand",
      });
      continue;
    }
    itemsChecked += 1;
    const item = parsed.data;
    known.add(item.id);
    byId.set(item.id, [...(byId.get(item.id) ?? []), relative(file)]);

    const inArchive = file.startsWith(paths.archiveDir + path.sep);
    if (item.status === "archived" && !inArchive) {
      add({
        level: "warning",
        code: "misplaced_archived",
        message: `${item.title} is archived but still sits in knowledge/.`,
        file: relative(file),
        fix: `Run chronicle archive ${item.id}`,
      });
    }
    if (item.status !== "archived" && inArchive) {
      add({
        level: "warning",
        code: "misplaced_active",
        message: `${item.title} is in archive/ but its status is ${item.status}.`,
        file: relative(file),
        fix: `Run chronicle restore ${item.id}`,
      });
    }

    const expected = path.join(paths.knowledgeDir, TYPE_DIRECTORIES[item.type]);
    if (!inArchive && path.dirname(file) !== expected) {
      add({
        level: "warning",
        code: "misfiled_type",
        message: `${item.title} is a ${item.type} but does not live in knowledge/${TYPE_DIRECTORIES[item.type]}/.`,
        file: relative(file),
        fix: "Move the file, or let Chronicle rewrite it with chronicle show --json then re-create",
      });
    }

    if (item.expiresAt && Date.parse(item.expiresAt) < Date.now() && item.status === "active") {
      add({
        level: "warning",
        code: "expired",
        message: `${item.title} expired on ${item.expiresAt.slice(0, 10)} but is still active.`,
        file: relative(file),
        fix: "Run chronicle verify",
      });
    }

    if (config) {
      const configured = Object.keys(config.scopes);
      for (const scope of item.scopes) {
        if (scope === "project") continue;
        const mapped = configured.some(
          (candidate) => candidate === scope || candidate.startsWith(`${scope}.`),
        );
        if (!mapped) {
          add({
            level: "info",
            code: "unmapped_scope",
            message: `Scope "${scope}" is not mapped to any code path, so no file will ever activate it.`,
            file: relative(file),
            fix: `Add ${scope} to scopes in .context/config.yaml`,
          });
        }
      }
    }
  }

  for (const [id, locations] of byId) {
    if (locations.length > 1) {
      add({
        level: "error",
        code: "duplicate_id",
        message: `Knowledge id ${id} appears in ${locations.length} files: ${locations.join(", ")}.`,
        fix: "Give one of them a fresh id, most likely a copy-paste or a bad merge",
      });
    }
  }

  // 4. Cross references point at ids that exist.
  for (const file of markdown) {
    const raw = await readFile(file, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = KnowledgeFrontmatterSchema.safeParse(parseMarkdownDocument(raw).data);
    if (!parsed.success) continue;
    const item = parsed.data;
    const references = [
      ...item.supersedes.map((id) => ["supersedes", id] as const),
      ...item.relatedTo.map((id) => ["relatedTo", id] as const),
      ...(item.type === "decision" && item.supersededBy
        ? [["supersededBy", item.supersededBy] as const]
        : []),
    ];
    for (const [field, id] of references) {
      if (known.has(id)) continue;
      add({
        level: "warning",
        code: "dangling_reference",
        message: `${item.title} lists ${id} under ${field}, but no such item exists.`,
        file: relative(file),
        fix: "Remove the reference, or restore the item it points at",
      });
    }
  }

  // 5. Proposals are readable and still point at something real.
  const proposals = await listProposals(paths).catch(() => []);
  for (const proposal of proposals) {
    if (proposal.targetId && !known.has(proposal.targetId)) {
      add({
        level: "warning",
        code: "orphan_proposal",
        message: `Proposal ${proposal.id} targets ${proposal.targetId}, which no longer exists.`,
        fix: `Run chronicle reject ${proposal.id}`,
      });
    }
  }
  if (proposals.length > 0 && !hasConflict) {
    add({
      level: "info",
      code: "pending_proposals",
      message: `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} waiting for review.`,
      fix: "Run chronicle proposals",
    });
  }

  // 6. The derived cache must never be committed.
  const gitignore = path.join(paths.contextDir, ".gitignore");
  const ignored = await readFile(gitignore, "utf8").catch(() => "");
  if (!ignored.split("\n").some((line) => line.trim().replace(/^\//, "").startsWith(".cache"))) {
    const rootIgnore = await readFile(path.join(root, ".gitignore"), "utf8").catch(() => "");
    if (!rootIgnore.includes(".cache")) {
      add({
        level: "warning",
        code: "cache_not_ignored",
        message: "The derived index cache is not gitignored, so it will churn in every diff.",
        fix: "Add .cache/ to .context/.gitignore",
      });
    }
  }

  // 7. Timestamps that make no sense usually mean a hand-edited file.
  for (const file of markdown) {
    const raw = await readFile(file, "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    const parsed = KnowledgeFrontmatterSchema.safeParse(parseMarkdownDocument(raw).data);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (Date.parse(item.updatedAt) < Date.parse(item.createdAt)) {
      add({
        level: "info",
        code: "timestamps_out_of_order",
        message: `${item.title} claims it was updated before it was created.`,
        file: relative(file),
      });
    }
  }

  // 8. History is append-only JSONL; a broken line means something wrote badly.
  const historyFiles = files.filter((file) => file.startsWith(paths.historyDir + path.sep));
  for (const file of historyFiles) {
    const raw = await readFile(file, "utf8").catch(() => "");
    if (findConflictMarkers(raw).length) continue;
    let broken = 0;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        JSON.parse(line);
      } catch {
        broken += 1;
      }
    }
    if (broken > 0) {
      add({
        level: "warning",
        code: "corrupt_history",
        message: `${broken} unreadable line${broken === 1 ? "" : "s"} in the changelog; they will be skipped.`,
        file: relative(file),
      });
    }
  }

  const counts: Record<DiagnosisLevel, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnosis of diagnoses) counts[diagnosis.level] += 1;

  return { root, initialized: true, diagnoses, counts, itemsChecked };
}

/** True when the store can be expected to open. */
export function isHealthy(report: DoctorReport): boolean {
  return report.counts.error === 0;
}

/** Rough directory size, used to reassure the developer the layer stays small. */
export async function contextSizeBytes(root: string): Promise<number> {
  const paths = chroniclePaths(root);
  let total = 0;
  for (const file of await contextFiles(paths)) {
    total += (await stat(file).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
