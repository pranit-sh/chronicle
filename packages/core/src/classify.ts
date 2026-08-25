import { ROOT_SCOPE, type KnowledgeTypeName } from "./schema.js";

/**
 * Turns a free text statement into a structured draft.
 *
 * This is deliberately a small set of deterministic heuristics rather than a
 * model call: `codicil remember` has to work offline, and the developer
 * reviews and can override every field before the item is written anyway.
 */

export interface ClassifiedStatement {
  type: KnowledgeTypeName;
  title: string;
  body: string;
  enforcement?: "must" | "should" | "never";
  lifetime?: "permanent" | "temporary";
  scopes: string[];
  /** Which rule fired, surfaced so the developer can see why it guessed this. */
  reason: string;
}

interface Matcher {
  type: KnowledgeTypeName;
  pattern: RegExp;
  reason: string;
  enforcement?: "must" | "should" | "never";
  lifetime?: "permanent" | "temporary";
}

const MATCHERS: Matcher[] = [
  {
    type: "rule",
    pattern: /^(never|don'?t|do not|avoid)\b/i,
    reason: "starts with a prohibition",
    enforcement: "never",
  },
  {
    type: "rule",
    pattern: /^(always|ensure|make sure)\b|\bmust\b/i,
    reason: "states a requirement",
    enforcement: "must",
  },
  {
    type: "context",
    pattern: /\b(currently|right now|for now|mid[- ]migration|migrating|in progress|temporar\w*)\b/i,
    reason: "describes a temporary state",
    lifetime: "temporary",
  },
  {
    type: "decision",
    pattern:
      /\b(we (have )?(decided|chose|chosen|picked|settled on)|decision:|instead of|in favou?r of|chosen over)\b/i,
    reason: "records a choice between options",
  },
  {
    type: "issue",
    pattern: /\b(bug|broken|breaks|fails?|failing|flaky|times? out|known issue|watch out|workaround)\b/i,
    reason: "describes something to watch out for",
  },
  {
    type: "architecture",
    pattern: /\b(we use|uses|built (on|with)|runs on|deployed (to|on)|stack)\b/i,
    reason: "states a structural fact about the stack",
  },
  {
    type: "domain",
    pattern: /\b(each|every|belongs to|has (exactly )?(one|many)|can only have)\b/i,
    reason: "describes a business concept",
  },
  {
    type: "rule",
    pattern: /^(prefer|should)\b/i,
    reason: "expresses a preference",
    enforcement: "should",
  },
];

const MAX_TITLE_LENGTH = 120;

function firstSentence(text: string): string {
  const match = /^(.+?)(?:[.!?](?:\s|$)|$)/s.exec(text);
  return (match?.[1] ?? text).trim();
}

function toTitle(text: string): string {
  let title = firstSentence(text).replace(/\s+/g, " ");
  if (title.length > MAX_TITLE_LENGTH) {
    const clipped = title.slice(0, MAX_TITLE_LENGTH - 1);
    const lastSpace = clipped.lastIndexOf(" ");
    title = `${(lastSpace > MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}\u2026`;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The deepest scope that covers all of `scopes`, or the root if they diverge. */
function commonAncestor(scopes: readonly string[]): string {
  const [first, ...rest] = scopes;
  if (!first) return ROOT_SCOPE;
  let shared = first.split(".");
  for (const scope of rest) {
    const segments = scope.split(".");
    let length = 0;
    while (length < shared.length && length < segments.length && shared[length] === segments[length]) {
      length += 1;
    }
    shared = shared.slice(0, length);
    if (shared.length === 0) return ROOT_SCOPE;
  }
  return shared.join(".") || ROOT_SCOPE;
}

/**
 * Only ever suggests scopes the developer has already declared in
 * `config.yaml`, so a stray sentence cannot invent a new part of the hierarchy.
 *
 * A statement that name-drops several unrelated areas is not knowledge about
 * each of them; it is knowledge about whatever they have in common. Scattering
 * it across all of them would hide it from every one of their siblings.
 */
export function inferScopes(text: string, knownScopes: readonly string[]): string[] {
  const haystack = text.toLowerCase();
  const matched = knownScopes.filter((scope) =>
    scope
      .split(".")
      .every((segment) => new RegExp(`\\b${segment.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}s?\\b`).test(haystack)),
  );
  if (matched.length === 0) return [ROOT_SCOPE];

  // A parent adds nothing once one of its children matched.
  const specific = matched.filter(
    (scope) => !matched.some((other) => other !== scope && other.startsWith(`${scope}.`)),
  );
  return specific.length === 1 ? specific : [commonAncestor(specific)];
}

export function classifyStatement(
  text: string,
  knownScopes: readonly string[] = [],
): ClassifiedStatement {
  const normalized = text.trim().replace(/\s+/g, " ");
  const matcher = MATCHERS.find((candidate) => candidate.pattern.test(normalized));
  const title = toTitle(normalized);
  const body = normalized === title || `${title}.` === normalized ? "" : normalized;

  return {
    type: matcher?.type ?? "convention",
    title,
    body,
    ...(matcher?.enforcement ? { enforcement: matcher.enforcement } : {}),
    ...(matcher?.lifetime ? { lifetime: matcher.lifetime } : {}),
    scopes: inferScopes(normalized, knownScopes),
    reason: matcher?.reason ?? "no stronger signal, filed as a convention",
  };
}

/** Default expiry for knowledge classified as temporary. */
export function defaultExpiry(from: Date = new Date(), days = 30): string {
  const expiry = new Date(from);
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return expiry.toISOString();
}
