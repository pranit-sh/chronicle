import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { loadConfig, writeDefaultConfig } from "./config.js";
import { ChronicleError, formatZodError } from "./errors.js";
import { atomicWrite, ensureDir, listFilesRecursive, moveFile, pathExists } from "./fs-utils.js";
import { appendHistory } from "./history.js";
import { matchesReference, newKnowledgeId, slugify, uniqueSlug } from "./ids.js";
import { parseMarkdownDocument, serializeMarkdownDocument } from "./frontmatter.js";
import { type ChroniclePaths, chroniclePaths, findWorkspaceRoot, toRepoRelative } from "./paths.js";
import { extractSections } from "./sections.js";
import {
  type Actor,
  type ChronicleConfig,
  type Evidence,
  type KnowledgeDraft,
  KnowledgeDraftSchema,
  type KnowledgeFrontmatter,
  KnowledgeFrontmatterSchema,
  type KnowledgeItem,
  type KnowledgeSourceName,
  type KnowledgeStatusName,
  type KnowledgeTypeName,
  TYPE_DIRECTORIES,
  type UpdatableField,
} from "./schema.js";

const CACHE_VERSION = 2;

interface CacheEntry {
  mtimeMs: number;
  size: number;
  frontmatter: unknown;
  body: string;
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

export interface KnowledgeFilter {
  types?: readonly KnowledgeTypeName[];
  statuses?: readonly KnowledgeStatusName[];
  sources?: readonly KnowledgeSourceName[];
  /** Matches the scope itself and everything beneath it. */
  scope?: string;
  tags?: readonly string[];
  /** Free text matched against title, body and tags. */
  query?: string;
  includeArchived?: boolean;
}

export type KnowledgePatch = Partial<Record<UpdatableField, unknown>>;

export interface StoreWriteOptions {
  /** Skip the history entry, used when a caller writes its own richer event. */
  silent?: boolean;
  reason?: string;
}

export function itemSlug(item: KnowledgeItem): string {
  return path.basename(item.filePath, ".md");
}

function stripEmpty(frontmatter: KnowledgeFrontmatter): Record<string, unknown> {
  const record: Record<string, unknown> = { ...frontmatter };
  for (const key of ["paths", "tags", "supersedes", "relatedTo", "evidence", "stack"]) {
    const value = record[key];
    if (Array.isArray(value) && value.length === 0) delete record[key];
  }
  for (const key of ["expiresAt", "lastVerifiedAt", "supersededBy", "workaround"]) {
    if (record[key] === null || record[key] === undefined) delete record[key];
  }
  if (record.pinned === false) delete record.pinned;
  const provenance = record.provenance as { origin: string; ref?: string; note?: string } | undefined;
  if (provenance && provenance.origin === "manual" && !provenance.ref && !provenance.note) {
    delete record.provenance;
  }
  return record;
}

function toItem(frontmatter: KnowledgeFrontmatter, body: string, filePath: string): KnowledgeItem {
  return { ...frontmatter, body, sections: extractSections(body), filePath };
}

function matchesFilter(item: KnowledgeItem, filter: KnowledgeFilter): boolean {
  if (filter.types?.length && !filter.types.includes(item.type)) return false;
  if (filter.statuses?.length) {
    if (!filter.statuses.includes(item.status)) return false;
  } else if (item.status === "archived" && !filter.includeArchived) {
    return false;
  }
  if (filter.sources?.length && !filter.sources.includes(item.source)) return false;
  if (filter.scope) {
    const wanted = filter.scope;
    const inScope = item.scopes.some((scope) => scope === wanted || scope.startsWith(`${wanted}.`));
    if (!inScope) return false;
  }
  if (filter.tags?.length && !filter.tags.every((tag) => item.tags.includes(tag))) return false;
  if (filter.query) {
    const needle = filter.query.toLowerCase();
    const haystack = `${item.title}\n${item.body}\n${item.tags.join(" ")}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Reads and writes the Markdown knowledge files under `.context/`. The
 * Markdown is always authoritative; the in-memory map and the JSON cache are
 * derived and can be deleted at any time.
 */
export class ChronicleStore {
  readonly paths: ChroniclePaths;
  #config: ChronicleConfig;
  #items = new Map<string, KnowledgeItem>();

  private constructor(paths: ChroniclePaths, config: ChronicleConfig) {
    this.paths = paths;
    this.#config = config;
  }

  get config(): ChronicleConfig {
    return this.#config;
  }

  get root(): string {
    return this.paths.root;
  }

  /** Finds the nearest `.context/` walking up from `cwd`. */
  static async open(cwd: string = process.cwd()): Promise<ChronicleStore> {
    const root = await findWorkspaceRoot(cwd);
    if (!root) {
      throw new ChronicleError(
        "not_initialized",
        `No .context directory found in ${cwd} or any parent. Run \`chronicle init\` first.`,
      );
    }
    return ChronicleStore.openAt(root);
  }

  static async openAt(root: string): Promise<ChronicleStore> {
    const paths = chroniclePaths(root);
    const config = await loadConfig(paths);
    const store = new ChronicleStore(paths, config);
    await store.reload();
    return store;
  }

  static async init(root: string, actor: Actor): Promise<ChronicleStore> {
    const paths = chroniclePaths(root);
    if (await pathExists(paths.configFile)) {
      throw new ChronicleError("already_initialized", `${paths.contextDir} already exists.`);
    }
    for (const dir of Object.values(TYPE_DIRECTORIES)) {
      await ensureDir(path.join(paths.knowledgeDir, dir));
    }
    await ensureDir(paths.archiveDir);
    await ensureDir(paths.proposalsDir);
    await ensureDir(paths.historyDir);
    await writeDefaultConfig(paths);
    await atomicWrite(path.join(paths.contextDir, ".gitignore"), `${".cache/"}\n`);
    await atomicWrite(path.join(paths.contextDir, "README.md"), contextReadme());
    await appendHistory(paths, {
      op: "init",
      actor,
      summary: "Initialized the Chronicle knowledge layer",
    });
    return ChronicleStore.openAt(root);
  }

  async reload(): Promise<void> {
    const cache = await this.#readCache();
    const nextEntries: Record<string, CacheEntry> = {};
    const items = new Map<string, KnowledgeItem>();
    let cacheDirty = false;

    const files = [
      ...(await listFilesRecursive(this.paths.knowledgeDir, ".md")),
      ...(await listFilesRecursive(this.paths.archiveDir, ".md")),
    ];

    for (const file of files) {
      const relative = toRepoRelative(this.paths.root, file);
      const stats = await stat(file);
      const cached = cache.entries[relative];
      let frontmatter: KnowledgeFrontmatter | undefined;
      let body: string | undefined;

      if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        const revalidated = KnowledgeFrontmatterSchema.safeParse(cached.frontmatter);
        if (revalidated.success) {
          frontmatter = revalidated.data;
          body = cached.body;
        }
      }

      if (!frontmatter || body === undefined) {
        const raw = await readFile(file, "utf8");
        const document = parseMarkdownDocument(raw);
        const parsed = KnowledgeFrontmatterSchema.safeParse(document.data);
        if (!parsed.success) {
          throw new ChronicleError(
            "invalid_document",
            formatZodError(parsed.error, `${relative} is not a valid knowledge item:`),
            parsed.error.issues,
          );
        }
        frontmatter = parsed.data;
        body = document.body;
        cacheDirty = true;
      }

      const existing = items.get(frontmatter.id);
      if (existing) {
        throw new ChronicleError(
          "conflict",
          `Duplicate knowledge id ${frontmatter.id} in ${toRepoRelative(this.paths.root, existing.filePath)} and ${relative}.`,
        );
      }

      items.set(frontmatter.id, toItem(frontmatter, body, file));
      nextEntries[relative] = { mtimeMs: stats.mtimeMs, size: stats.size, frontmatter, body };
    }

    if (!cacheDirty && Object.keys(cache.entries).length !== files.length) cacheDirty = true;

    this.#items = items;
    if (cacheDirty) await this.#writeCache({ version: CACHE_VERSION, entries: nextEntries });
  }

  all(): KnowledgeItem[] {
    return [...this.#items.values()].sort((a, b) => a.title.localeCompare(b.title));
  }

  get(id: string): KnowledgeItem | undefined {
    return this.#items.get(id);
  }

  list(filter: KnowledgeFilter = {}): KnowledgeItem[] {
    return this.all().filter((item) => matchesFilter(item, filter));
  }

  /** Resolves a full id, an id prefix, or a filename slug. */
  resolveRef(reference: string): KnowledgeItem {
    const matches = this.all().filter((item) =>
      matchesReference(reference, item.id, itemSlug(item)),
    );
    if (matches.length === 1) return matches[0] as KnowledgeItem;
    if (matches.length === 0) {
      throw new ChronicleError("not_found", `No knowledge item matches "${reference}".`);
    }
    throw new ChronicleError(
      "ambiguous_reference",
      `"${reference}" matches ${matches.length} items: ${matches.map((item) => item.id).join(", ")}`,
    );
  }

  stats(): Record<KnowledgeStatusName, number> {
    const counts: Record<KnowledgeStatusName, number> = {
      proposed: 0,
      confirmed: 0,
      active: 0,
      stale: 0,
      archived: 0,
    };
    for (const item of this.#items.values()) counts[item.status] += 1;
    return counts;
  }

  async create(
    draft: KnowledgeDraft,
    actor: Actor,
    options: StoreWriteOptions = {},
  ): Promise<KnowledgeItem> {
    const parsedDraft = KnowledgeDraftSchema.safeParse(draft);
    if (!parsedDraft.success) {
      throw new ChronicleError(
        "invalid_input",
        formatZodError(parsedDraft.error, "Invalid knowledge draft:"),
        parsedDraft.error.issues,
      );
    }
    const { body, ...fields } = parsedDraft.data;
    const now = new Date().toISOString();
    const id = newKnowledgeId();
    const frontmatter = this.#validateFrontmatter({
      ...fields,
      id,
      createdAt: now,
      updatedAt: now,
      actor,
    });

    const filePath = this.#filePathFor(frontmatter, slugify(frontmatter.title));
    await atomicWrite(filePath, serializeMarkdownDocument(stripEmpty(frontmatter), body));

    const item = toItem(frontmatter, body, filePath);
    this.#items.set(item.id, item);
    await this.#invalidateCache();

    if (!options.silent) {
      await appendHistory(this.paths, {
        op: "create",
        actor,
        itemId: item.id,
        summary: `Added ${item.type} "${item.title}"`,
        after: { title: item.title, scopes: item.scopes, status: item.status },
      });
    }
    return item;
  }

  async update(
    reference: string,
    patch: KnowledgePatch,
    actor: Actor,
    options: StoreWriteOptions = {},
  ): Promise<KnowledgeItem> {
    return this.#write(reference, patch, actor, options);
  }

  /**
   * Records the outcome of a verification run. Kept separate from `update`
   * because `lastVerifiedAt` and evidence results are written by the verifier,
   * never by a person or a proposal.
   */
  async recordVerification(
    reference: string,
    outcome: { evidence: Evidence[]; status?: KnowledgeStatusName; lastVerifiedAt?: string | null },
    actor: Actor,
    summary: string,
  ): Promise<KnowledgeItem> {
    return this.#write(reference, outcome as Record<string, unknown>, actor, {
      silent: true,
      reason: summary,
    });
  }

  async #write(
    reference: string,
    patch: Record<string, unknown>,
    actor: Actor,
    options: StoreWriteOptions = {},
  ): Promise<KnowledgeItem> {
    const current = this.resolveRef(reference);
    const { body: patchBody, ...frontmatterPatch } = patch;

    const nextBody = typeof patchBody === "string" ? patchBody : current.body;
    const merged = {
      ...stripEmpty(currentFrontmatter(current)),
      ...frontmatterPatch,
      updatedAt: new Date().toISOString(),
    };
    const frontmatter = this.#validateFrontmatter(merged);

    const before = summarize(current);
    const desiredPath = this.#filePathForUpdate(frontmatter, current);
    if (desiredPath !== current.filePath) {
      await moveFile(current.filePath, desiredPath);
    }
    await atomicWrite(desiredPath, serializeMarkdownDocument(stripEmpty(frontmatter), nextBody));

    const item = toItem(frontmatter, nextBody, desiredPath);
    this.#items.set(item.id, item);
    await this.#invalidateCache();

    if (!options.silent) {
      await appendHistory(this.paths, {
        op: "update",
        actor,
        itemId: item.id,
        summary: options.reason ?? `Updated ${item.type} "${item.title}"`,
        before,
        after: summarize(item),
      });
    }
    return item;
  }

  async archive(reference: string, actor: Actor, reason?: string): Promise<KnowledgeItem> {
    const current = this.resolveRef(reference);
    if (current.status === "archived") return current;
    const item = await this.update(reference, { status: "archived" }, actor, { silent: true });
    await appendHistory(this.paths, {
      op: "archive",
      actor,
      itemId: item.id,
      summary: reason ?? `Archived ${item.type} "${item.title}"`,
      before: { status: current.status },
      after: { status: item.status },
    });
    return item;
  }

  async restore(reference: string, actor: Actor): Promise<KnowledgeItem> {
    const current = this.resolveRef(reference);
    if (current.status !== "archived") return current;
    const item = await this.update(reference, { status: "active" }, actor, { silent: true });
    await appendHistory(this.paths, {
      op: "restore",
      actor,
      itemId: item.id,
      summary: `Restored ${item.type} "${item.title}"`,
      after: { status: item.status },
    });
    return item;
  }

  async remove(reference: string, actor: Actor): Promise<KnowledgeItem> {
    const item = this.resolveRef(reference);
    await rm(item.filePath, { force: true });
    this.#items.delete(item.id);
    await this.#invalidateCache();
    await appendHistory(this.paths, {
      op: "delete",
      actor,
      itemId: item.id,
      summary: `Deleted ${item.type} "${item.title}"`,
      before: summarize(item),
    });
    return item;
  }

  #validateFrontmatter(candidate: Record<string, unknown>): KnowledgeFrontmatter {
    const parsed = KnowledgeFrontmatterSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ChronicleError(
        "invalid_input",
        formatZodError(parsed.error, "Invalid knowledge item:"),
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  #directoryFor(frontmatter: KnowledgeFrontmatter): string {
    const base = frontmatter.status === "archived" ? this.paths.archiveDir : this.paths.knowledgeDir;
    return path.join(base, TYPE_DIRECTORIES[frontmatter.type]);
  }

  #takenSlugs(directory: string, exceptId?: string): Set<string> {
    const taken = new Set<string>();
    for (const item of this.#items.values()) {
      if (item.id === exceptId) continue;
      if (path.dirname(item.filePath) === directory) taken.add(itemSlug(item));
    }
    return taken;
  }

  #filePathFor(frontmatter: KnowledgeFrontmatter, desiredSlug: string): string {
    const directory = this.#directoryFor(frontmatter);
    const slug = uniqueSlug(desiredSlug, this.#takenSlugs(directory, frontmatter.id));
    return path.join(directory, `${slug}.md`);
  }

  /**
   * Keeps the existing filename unless the title or the archive state changed,
   * so routine edits do not churn the Git history.
   */
  #filePathForUpdate(frontmatter: KnowledgeFrontmatter, current: KnowledgeItem): string {
    const directory = this.#directoryFor(frontmatter);
    const currentSlug = itemSlug(current);
    const titleChanged = frontmatter.title !== current.title;
    const desiredSlug = titleChanged ? slugify(frontmatter.title) : currentSlug;
    if (!titleChanged && path.dirname(current.filePath) === directory) return current.filePath;
    const slug = uniqueSlug(desiredSlug, this.#takenSlugs(directory, frontmatter.id));
    return path.join(directory, `${slug}.md`);
  }

  async #readCache(): Promise<CacheFile> {
    try {
      const raw = await readFile(this.paths.indexCacheFile, "utf8");
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.version === CACHE_VERSION && parsed.entries && typeof parsed.entries === "object") {
        return parsed;
      }
    } catch {
      // A missing or corrupt cache just means a full read.
    }
    return { version: CACHE_VERSION, entries: {} };
  }

  async #writeCache(cache: CacheFile): Promise<void> {
    try {
      await atomicWrite(this.paths.indexCacheFile, JSON.stringify(cache));
    } catch {
      // The cache is derived; never fail a command because it could not be written.
    }
  }

  async #invalidateCache(): Promise<void> {
    const entries: Record<string, CacheEntry> = {};
    for (const item of this.#items.values()) {
      const relative = toRepoRelative(this.paths.root, item.filePath);
      try {
        const stats = await stat(item.filePath);
        entries[relative] = {
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          frontmatter: currentFrontmatter(item),
          body: item.body,
        };
      } catch {
        // File vanished underneath us; the next reload will notice.
      }
    }
    await this.#writeCache({ version: CACHE_VERSION, entries });
  }
}

function currentFrontmatter(item: KnowledgeItem): KnowledgeFrontmatter {
  const { body: _body, sections: _sections, filePath: _filePath, ...frontmatter } = item;
  return frontmatter as KnowledgeFrontmatter;
}

function summarize(item: KnowledgeItem): Record<string, unknown> {
  return {
    title: item.title,
    status: item.status,
    scopes: item.scopes,
    confidence: item.confidence,
  };
}

function contextReadme(): string {
  return `# Chronicle knowledge layer

This directory is the project's knowledge layer: what the project believes, why,
where it applies, and whether it is still true. It is committed to Git on
purpose, so knowledge follows branches exactly like code does.

## Layout

- \`config.yaml\` — scope map, context budget, and what agents may do unattended.
- \`knowledge/\` — one Markdown file per item, grouped by type. The Markdown is
  the source of truth; edit it by hand whenever you like.
- \`proposals/\` — staged changes awaiting review. AI agents may write here, and
  nowhere else. Review them with \`chronicle proposals\`.
- \`archive/\` — items kept for history but no longer supplied to agents.
- \`history/\` — an append-only changelog, one JSONL file per day.
- \`.cache/\` — derived index, gitignored, safe to delete.

## Everyday commands

\`\`\`
chronicle remember "Never call the DB directly from API handlers"
chronicle context --file src/api/users.ts --task "add pagination"
chronicle proposals
chronicle verify
\`\`\`
`;
}
