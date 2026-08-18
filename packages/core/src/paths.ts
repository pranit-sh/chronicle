import { stat } from "node:fs/promises";
import path from "node:path";

export const CHRONICLE_DIR = ".chronicle";

/**
 * What the directory was called before 0.1.0. Only used to recognise it and
 * tell the developer to rename it.
 */
export const LEGACY_CHRONICLE_DIR = ".context";

export interface ChroniclePaths {
  /** Workspace root, i.e. the directory that contains `.chronicle/`. */
  root: string;
  chronicleDir: string;
  knowledgeDir: string;
  archiveDir: string;
  proposalsDir: string;
  historyDir: string;
  cacheDir: string;
  configFile: string;
  indexCacheFile: string;
}

export function chroniclePaths(root: string): ChroniclePaths {
  const chronicleDir = path.join(root, CHRONICLE_DIR);
  const cacheDir = path.join(chronicleDir, ".cache");
  return {
    root,
    chronicleDir,
    knowledgeDir: path.join(chronicleDir, "knowledge"),
    archiveDir: path.join(chronicleDir, "archive"),
    proposalsDir: path.join(chronicleDir, "proposals"),
    historyDir: path.join(chronicleDir, "history"),
    cacheDir,
    configFile: path.join(chronicleDir, "config.yaml"),
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
 * Walks up from `startDir` looking for a `.chronicle/` directory, the same way
 * Git locates `.git/`.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    if (await isDirectory(path.join(current, CHRONICLE_DIR))) return current;
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
    if (await isDirectory(path.join(current, LEGACY_CHRONICLE_DIR))) return current;
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
