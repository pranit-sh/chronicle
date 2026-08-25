import { stat } from "node:fs/promises";
import path from "node:path";

export const CODICIL_DIR = ".codicil";

/**
 * What the directory was called before 0.1.0. Only used to recognise it and
 * tell the developer to rename it.
 */
export const LEGACY_CODICIL_DIR = ".context";

export interface CodicilPaths {
  /** Workspace root, i.e. the directory that contains `.codicil/`. */
  root: string;
  codicilDir: string;
  knowledgeDir: string;
  archiveDir: string;
  proposalsDir: string;
  historyDir: string;
  cacheDir: string;
  configFile: string;
  indexCacheFile: string;
}

export function codicilPaths(root: string): CodicilPaths {
  const codicilDir = path.join(root, CODICIL_DIR);
  const cacheDir = path.join(codicilDir, ".cache");
  return {
    root,
    codicilDir,
    knowledgeDir: path.join(codicilDir, "knowledge"),
    archiveDir: path.join(codicilDir, "archive"),
    proposalsDir: path.join(codicilDir, "proposals"),
    historyDir: path.join(codicilDir, "history"),
    cacheDir,
    configFile: path.join(codicilDir, "config.yaml"),
    indexCacheFile: path.join(cacheDir, "index.json"),
  };
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walks up from `startDir` looking for a `.codicil/` directory, the same way
 * Git locates `.git/`.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    if (await isDirectory(path.join(current, CODICIL_DIR))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Finds a pre-0.1.0 `.context/` directory, so a stale checkout gets told to
 * rename it rather than a bare "not initialized".
 */
export async function findLegacyRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    if (await isDirectory(path.join(current, LEGACY_CODICIL_DIR))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Normalises an absolute or relative path to a POSIX path relative to the root. */
export function toRepoRelative(root: string, target: string): string {
  const absolute = path.isAbsolute(target) ? target : path.resolve(root, target);
  return path.relative(root, absolute).split(path.sep).join("/");
}
