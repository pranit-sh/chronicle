import { stat } from "node:fs/promises";
import path from "node:path";

export const CONTEXT_DIR = ".context";

export interface ChroniclePaths {
  /** Workspace root, i.e. the directory that contains `.context/`. */
  root: string;
  contextDir: string;
  knowledgeDir: string;
  archiveDir: string;
  proposalsDir: string;
  historyDir: string;
  cacheDir: string;
  configFile: string;
  indexCacheFile: string;
}

export function chroniclePaths(root: string): ChroniclePaths {
  const contextDir = path.join(root, CONTEXT_DIR);
  const cacheDir = path.join(contextDir, ".cache");
  return {
    root,
    contextDir,
    knowledgeDir: path.join(contextDir, "knowledge"),
    archiveDir: path.join(contextDir, "archive"),
    proposalsDir: path.join(contextDir, "proposals"),
    historyDir: path.join(contextDir, "history"),
    cacheDir,
    configFile: path.join(contextDir, "config.yaml"),
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
 * Walks up from `startDir` looking for a `.context/` directory, the same way
 * Git locates `.git/`.
 */
export async function findWorkspaceRoot(startDir: string): Promise<string | undefined> {
  let current = path.resolve(startDir);
  for (;;) {
    if (await isDirectory(path.join(current, CONTEXT_DIR))) return current;
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
