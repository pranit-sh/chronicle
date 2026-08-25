import { toRepoRelative } from "./paths.js";
import { ROOT_SCOPE } from "./schema.js";
import type {
  Budget,
  CodicilConfig,
  KnowledgeItem,
  KnowledgeSourceName,
  KnowledgeTypeName,
} from "./schema.js";
import { ScopeResolver, coversScope, pathsMatch, scopeDepth } from "./scope.js";
import { leadParagraph, truncate } from "./sections.js";
import type { CodicilStore } from "./store.js";

/**
 * The resolver answers one question: what is the smallest amount of correct,
 * relevant project knowledge an agent needs for this file and this task?
 *
 * Every inclusion and every exclusion is recorded in the trace, so a developer
 * can always see why the AI was told something, and so the scoring can be
 * tested with fixtures instead of judged by feel.
 */

const TYPE_PRIORITY: Record<KnowledgeTypeName, number> = {
  rule: 1,
  decision: 0.85,
  context: 0.8,
  issue: 0.7,
  architecture: 0.6,
  domain: 0.55,
  convention: 0.5,
};

const SOURCE_AUTHORITY: Record<KnowledgeSourceName, number> = {
  human: 1,
  imported: 0.7,
  observed: 0.6,
  ai: 0.4,
};

/** Order knowledge is presented in: constraints before background. */
const RENDER_ORDER: KnowledgeTypeName[] = [
  "rule",
  "context",
  "decision",
  "issue",
  "architecture",
  "domain",
  "convention",
];

const TYPE_HEADINGS: Record<KnowledgeTypeName, string> = {
  rule: "Rules",
  context: "Current context",
  decision: "Decisions",
  issue: "Known issues",
  architecture: "Architecture",
  domain: "Domain knowledge",
  convention: "Conventions",
};

/** A stale item is still shown, but ranked well below verified knowledge. */
const STALE_PENALTY = 0.5;
/** Pinned items jump the queue rather than competing on score. */
const PIN_BONUS = 1000;
/** How well a task description must match before it alone makes an item relevant. */
const KEYWORD_CANDIDATE_THRESHOLD = 0.34;
const STATEMENT_CHARS = 320;

export interface ResolutionRequest {
  /** The file being edited. Absolute or repo relative. */
  file?: string;
  directory?: string;
  openFiles?: readonly string[];
  branch?: string;
  /** What the developer asked the agent to do. */
  task?: string;
  selection?: string;
  budget?: Partial<Budget>;
  includeStale?: boolean;
  includeProposed?: boolean;
}

export interface ResolvedEntry {
  item: KnowledgeItem;
  score: number;
  signals: Record<string, number>;
  reasons: string[];
  /** The exact text this entry contributes to the rendered package. */
  text: string;
}

export interface DroppedEntry {
  id: string;
  title: string;
  reason: string;
}

export interface ResolutionTrace {
  file?: string;
  branch?: string;
  task?: string;
  activeScopes: string[];
  /** The deepest scope the current file sits in; specificity is measured against it. */
  focusScope: string;
  consideredCount: number;
  candidateCount: number;
  dropped: DroppedEntry[];
  warnings: string[];
}

export interface ContextPackage {
  generatedAt: string;
  entries: ResolvedEntry[];
  trace: ResolutionTrace;
  stats: { itemCount: number; totalChars: number; budget: Budget };
}

export interface ResolutionInput {
  items: readonly KnowledgeItem[];
  config: CodicilConfig;
  root: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "when", "how", "was", "are", "you",
  "our", "its", "have", "has", "should", "would", "could", "can", "will", "add", "use", "using",
  "make", "get", "set", "new", "all", "any", "not", "but", "out", "via", "per", "let", "does",
]);

/**
 * Both the task and the knowledge go through the same crude singularisation, so
 * "refactor this webhook" matches a rule about "webhooks". Being consistent
 * matters more here than being linguistically correct.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
    .map((token) => (token.length > 4 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function keywordScore(taskTokens: ReadonlySet<string>, item: KnowledgeItem): number {
  if (taskTokens.size === 0) return 0;
  const headline = new Set(tokenize(`${item.title} ${item.tags.join(" ")}`));
  const body = new Set(tokenize(item.body.slice(0, 1000)));
  let hits = 0;
  for (const token of taskTokens) {
    if (headline.has(token)) hits += 1;
    else if (body.has(token)) hits += 0.5;
  }
  return clamp01(hits / taskTokens.size);
}

function freshnessScore(item: KnowledgeItem, horizonDays: number, now: number): number {
  const reference = Date.parse(item.lastVerifiedAt ?? item.updatedAt);
  if (Number.isNaN(reference)) return 0;
  const days = (now - reference) / 86_400_000;
  return clamp01(1 - days / horizonDays);
}

/**
 * How closely an item's scope matches where we are. An item scoped exactly to
 * the current location scores 1; a project wide item scores least; an item
 * scoped to an unrelated or narrower branch scores 0 and is not a candidate.
 */
function scopeSpecificity(item: KnowledgeItem, activeScopes: readonly string[], focusDepth: number): number {
  let best = 0;
  for (const itemScope of item.scopes) {
    for (const active of activeScopes) {
      if (!coversScope(itemScope, active)) continue;
      best = Math.max(best, (scopeDepth(itemScope) + 1) / (focusDepth + 1));
    }
  }
  return clamp01(best);
}

function isExpired(item: KnowledgeItem, now: number): boolean {
  if (!item.expiresAt) return false;
  const at = Date.parse(item.expiresAt);
  return !Number.isNaN(at) && at < now;
}

function statement(item: KnowledgeItem): string {
  const text = leadParagraph(item.body) || item.sections.decision || "";
  return truncate(text, STATEMENT_CHARS);
}

/** The exact text an entry contributes, used for budget accounting and rendering. */
export function renderEntry(item: KnowledgeItem): string {
  const prefix = item.type === "rule" ? `[${item.enforcement}] ` : "";
  const severity = item.type === "issue" ? `[${item.severity}] ` : "";
  const scopeNote = item.scopes.join(", ");
  const staleNote = item.status === "stale" ? " _(stale: verify before relying on this)_" : "";
  const head = `- **${prefix}${severity}${item.title}** \`${scopeNote}\`${staleNote}`;
  const lines = [head];

  const body = statement(item);
  if (body) lines.push(`  ${body}`);

  if (item.type === "decision" && item.sections.rationale) {
    lines.push(`  Rationale: ${truncate(item.sections.rationale, STATEMENT_CHARS)}`);
  }
  if (item.type === "issue" && item.workaround) {
    lines.push(`  Workaround: ${truncate(item.workaround, STATEMENT_CHARS)}`);
  }
  return lines.join("\n");
}

export function resolveContext(input: ResolutionInput, request: ResolutionRequest = {}): ContextPackage {
  const { items, config, root } = input;
  const now = Date.now();
  const scopeResolver = new ScopeResolver(config);
  const weights = config.resolver.weights;
  const budget: Budget = {
    maxItems: request.budget?.maxItems ?? config.budget.maxItems,
    maxChars: request.budget?.maxChars ?? config.budget.maxChars,
  };
  const includeStale = request.includeStale ?? config.resolver.includeStale;
  const includeProposed = request.includeProposed ?? config.resolver.includeProposed;

  const file = request.file ? toRepoRelative(root, request.file) : undefined;
  const directory = request.directory ? toRepoRelative(root, request.directory) : undefined;
  const openFiles = (request.openFiles ?? []).map((path) => toRepoRelative(root, path));
  const signalPaths = [file, directory, ...openFiles].filter((path): path is string => Boolean(path));

  const activeScopes = signalPaths.length ? scopeResolver.scopesForPaths(signalPaths) : [ROOT_SCOPE];
  const focusScope = file
    ? scopeResolver.deepestScopeForPath(file)
    : (activeScopes[activeScopes.length - 1] ?? ROOT_SCOPE);
  const focusDepth = scopeDepth(focusScope);

  const taskText = [request.task, request.selection].filter(Boolean).join(" ");
  const taskTokens = new Set(tokenize(taskText));

  const dropped: DroppedEntry[] = [];
  const warnings: string[] = [];
  const candidates: ResolvedEntry[] = [];

  for (const item of items) {
    if (item.status === "archived") continue;
    if (item.status === "proposed" && !includeProposed) continue;
    if (item.status === "stale" && !includeStale) {
      dropped.push({ id: item.id, title: item.title, reason: "stale and includeStale is off" });
      continue;
    }
    if (isExpired(item, now)) {
      dropped.push({
        id: item.id,
        title: item.title,
        reason: `expired on ${String(item.expiresAt).slice(0, 10)}`,
      });
      continue;
    }

    const specificity = scopeSpecificity(item, activeScopes, focusDepth);
    const pathHit = file && item.paths.length && pathsMatch(item.paths, file) ? 1 : 0;
    const keyword = keywordScore(taskTokens, item);
    // Pinning exempts an item from the budget, not from the scope model. A
    // rule that should follow you everywhere is scoped to `project` and pinned.
    const isCandidate = specificity > 0 || pathHit > 0 || keyword >= KEYWORD_CANDIDATE_THRESHOLD;
    if (!isCandidate) continue;

    const signals = {
      scopeSpecificity: specificity,
      pathMatch: pathHit,
      typePriority: TYPE_PRIORITY[item.type],
      sourceAuthority: SOURCE_AUTHORITY[item.source],
      confidence: item.confidence,
      freshness: freshnessScore(item, config.resolver.freshnessHorizonDays, now),
      keyword,
      priority: item.priority / 100,
    };

    let score = 0;
    for (const [key, value] of Object.entries(signals)) {
      score += value * (weights[key as keyof typeof weights] ?? 0);
    }
    if (item.status === "stale") score *= STALE_PENALTY;
    if (item.pinned) score += PIN_BONUS;

    const reasons: string[] = [];
    if (item.pinned) reasons.push("pinned");
    if (specificity > 0) {
      const matched = item.scopes.filter((scope) => activeScopes.some((active) => coversScope(scope, active)));
      reasons.push(`scope ${matched.join(", ")} covers ${focusScope}`);
    }
    if (pathHit) reasons.push(`path glob matches ${file}`);
    if (keyword > 0) {
      const overlap = [...taskTokens].filter((token) =>
        `${item.title} ${item.tags.join(" ")} ${item.body}`.toLowerCase().includes(token),
      );
      reasons.push(`task mentions ${overlap.slice(0, 4).join(", ")}`);
    }
    if (item.status === "stale") reasons.push("stale, ranked down");

    candidates.push({ item, score, signals, reasons, text: renderEntry(item) });
  }

  candidates.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));

  // A superseding item silently retires what it replaced, but only when the
  // replacement actually made it into this package.
  const survivingIds = new Set(candidates.map((entry) => entry.item.id));
  const supersededBy = new Map<string, string>();
  for (const entry of candidates) {
    for (const oldId of entry.item.supersedes) {
      if (survivingIds.has(oldId)) supersededBy.set(oldId, entry.item.title);
    }
  }

  const afterSupersede = candidates.filter((entry) => {
    const replacement = supersededBy.get(entry.item.id);
    if (!replacement) return true;
    dropped.push({
      id: entry.item.id,
      title: entry.item.title,
      reason: `superseded by "${replacement}"`,
    });
    return false;
  });

  const entries: ResolvedEntry[] = [];
  let totalChars = 0;
  for (const entry of afterSupersede) {
    const wouldExceed = entries.length >= budget.maxItems || totalChars + entry.text.length > budget.maxChars;
    if (wouldExceed && !entry.item.pinned) {
      dropped.push({ id: entry.item.id, title: entry.item.title, reason: "outside the context budget" });
      continue;
    }
    entries.push(entry);
    totalChars += entry.text.length;
  }

  for (const entry of entries) {
    if (entry.item.status === "stale") {
      warnings.push(`"${entry.item.title}" is stale; its evidence no longer holds.`);
    }
    const failing = entry.item.evidence.filter((evidence) => evidence.lastResult === "fail");
    if (failing.length) {
      warnings.push(
        `"${entry.item.title}" contradicts the repository: ${failing.length} evidence check(s) failing.`,
      );
    }
  }
  if (dropped.some((entry) => entry.reason === "outside the context budget")) {
    warnings.push(
      `Context budget reached (${budget.maxItems} items / ${budget.maxChars} chars); lower ranked knowledge was left out.`,
    );
  }

  const trace: ResolutionTrace = {
    ...(file ? { file } : {}),
    ...(request.branch ? { branch: request.branch } : {}),
    ...(request.task ? { task: request.task } : {}),
    activeScopes,
    focusScope,
    consideredCount: items.length,
    candidateCount: candidates.length,
    dropped,
    warnings,
  };

  return {
    generatedAt: new Date().toISOString(),
    entries,
    trace,
    stats: { itemCount: entries.length, totalChars, budget },
  };
}

export function resolveContextForStore(
  store: CodicilStore,
  request: ResolutionRequest = {},
): ContextPackage {
  return resolveContext({ items: store.all(), config: store.config, root: store.root }, request);
}

export interface RenderOptions {
  /** Append the inclusion trace so a human can audit the package. */
  includeTrace?: boolean;
  title?: string;
}

/** Renders the package as the Markdown an agent actually receives. */
export function renderContextPackage(pkg: ContextPackage, options: RenderOptions = {}): string {
  const { trace } = pkg;
  const lines: string[] = [];
  const heading = options.title ?? (trace.file ? `Project context for ${trace.file}` : "Project context");
  lines.push(`# ${heading}`);
  lines.push("");
  lines.push(`Scopes: ${trace.activeScopes.join(" > ")}`);
  if (trace.branch) lines.push(`Branch: ${trace.branch}`);
  if (trace.task) lines.push(`Task: ${trace.task}`);
  lines.push("");

  if (pkg.entries.length === 0) {
    lines.push("No project knowledge applies here yet.");
    return lines.join("\n");
  }

  for (const type of RENDER_ORDER) {
    const group = pkg.entries.filter((entry) => entry.item.type === type);
    if (group.length === 0) continue;
    lines.push(`## ${TYPE_HEADINGS[type]}`);
    lines.push("");
    for (const entry of group) lines.push(entry.text);
    lines.push("");
  }

  if (trace.warnings.length) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of trace.warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  lines.push("---");
  lines.push(
    `${pkg.stats.itemCount} of ${trace.consideredCount} knowledge items included, ${pkg.stats.totalChars} chars.`,
  );

  if (options.includeTrace && trace.dropped.length) {
    lines.push("");
    lines.push("Left out:");
    for (const entry of trace.dropped) lines.push(`- ${entry.title}: ${entry.reason}`);
  }

  return lines.join("\n");
}
