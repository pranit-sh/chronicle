import { type EvidenceCheck, checkEvidence, createEvidenceContext } from "./evidence.js";
import { appendHistory } from "./history.js";
import {
  type Actor,
  type Evidence,
  type KnowledgeItem,
  VERIFIABLE_EVIDENCE_KINDS,
} from "./schema.js";
import type { CodicilStore } from "./store.js";

/**
 * Re-checks stored knowledge against the working tree.
 *
 * The verifier never edits or deletes what a knowledge item says. It only
 * records whether the evidence behind it still holds, and hands the developer
 * the Update / Keep / Archive decision.
 */

export type VerificationOutcome =
  | "verified"
  | "stale"
  | "contradicted"
  | "violated"
  | "expired"
  | "unverifiable"
  | "error";

export interface ItemVerification {
  item: KnowledgeItem;
  checks: EvidenceCheck[];
  outcome: VerificationOutcome;
  summary: string;
  /** True when the run changed the item's status on disk. */
  statusChanged: boolean;
}

export interface VerifyReport {
  checkedAt: string;
  results: ItemVerification[];
  counts: Record<VerificationOutcome, number>;
  filesScanned: number;
}

export interface VerifyOptions {
  /** Limit the run to specific items. */
  references?: readonly string[];
  /** Report without writing anything back. */
  dryRun?: boolean;
  /** Include items that carry no machine checkable evidence. */
  includeUnverifiable?: boolean;
  /** Also verify archived items. */
  includeArchived?: boolean;
}

function isVerifiable(evidence: Evidence): boolean {
  return (VERIFIABLE_EVIDENCE_KINDS as readonly string[]).includes(evidence.kind);
}

function isExpired(item: KnowledgeItem, now: number): boolean {
  if (!item.expiresAt) return false;
  const at = Date.parse(item.expiresAt);
  return !Number.isNaN(at) && at < now;
}

/**
 * Decides what a set of failing checks means.
 *
 * A failing `expect: absent` check on a rule is not stale knowledge: the rule
 * still stands and the code has broken it. On anything factual, the same signal
 * means the repository has moved on and the knowledge has not.
 */
function classifyOutcome(item: KnowledgeItem, checks: readonly EvidenceCheck[]): VerificationOutcome {
  if (checks.some((check) => check.result === "error")) return "error";
  const failures = checks.filter((check) => check.result === "fail");
  if (failures.length === 0) return "verified";

  const inverted = failures.filter((check) => check.evidence.expect === "absent");
  if (inverted.length === failures.length) {
    return item.type === "rule" ? "violated" : "contradicted";
  }
  return "stale";
}

function summarize(outcome: VerificationOutcome, item: KnowledgeItem, checks: readonly EvidenceCheck[]): string {
  const failing = checks.filter((check) => check.result === "fail" || check.result === "error");
  const first = failing[0]?.detail ?? "";
  switch (outcome) {
    case "verified":
      return `All ${checks.filter((check) => check.result === "pass").length} evidence check(s) still hold.`;
    case "violated":
      return `The code breaks this rule: ${first}`;
    case "contradicted":
      return `The repository disagrees with this: ${first}`;
    case "stale":
      return `The evidence behind this has gone: ${first}`;
    case "expired":
      return `Expired on ${String(item.expiresAt).slice(0, 10)}.`;
    case "error":
      return `Could not check: ${first}`;
    case "unverifiable":
      return "No machine checkable evidence attached.";
  }
}

/** Folds this run's results back into the item's evidence entries. */
function applyResults(checks: readonly EvidenceCheck[], checkedAt: string): Evidence[] {
  return checks.map((check) => {
    if (check.result === "skipped") return check.evidence;
    return {
      ...check.evidence,
      lastCheckedAt: checkedAt,
      lastResult: check.result,
      lastDetail: check.detail,
    } as Evidence;
  });
}

export async function verify(
  store: CodicilStore,
  actor: Actor,
  options: VerifyOptions = {},
): Promise<VerifyReport> {
  const checkedAt = new Date().toISOString();
  const now = Date.parse(checkedAt);
  const context = await createEvidenceContext(store.root, store.config);

  const targets = options.references?.length
    ? options.references.map((reference) => store.resolveRef(reference))
    : store.list({ includeArchived: options.includeArchived ?? false });

  const results: ItemVerification[] = [];

  for (const item of targets) {
    const verifiable = item.evidence.filter(isVerifiable);

    if (isExpired(item, now)) {
      const statusChanged = item.status !== "stale" && item.status !== "archived";
      if (statusChanged && !options.dryRun) {
        await store.recordVerification(
          item.id,
          { evidence: item.evidence, status: "stale", lastVerifiedAt: checkedAt },
          actor,
          "Expired",
        );
      }
      results.push({
        item,
        checks: [],
        outcome: "expired",
        summary: summarize("expired", item, []),
        statusChanged: statusChanged && !options.dryRun,
      });
      continue;
    }

    if (verifiable.length === 0) {
      if (options.includeUnverifiable || options.references?.length) {
        results.push({
          item,
          checks: [],
          outcome: "unverifiable",
          summary: summarize("unverifiable", item, []),
          statusChanged: false,
        });
      }
      continue;
    }

    const checks: EvidenceCheck[] = [];
    for (const evidence of item.evidence) {
      checks.push(
        isVerifiable(evidence)
          ? await checkEvidence(evidence, context)
          : { evidence, result: "skipped", detail: "not machine checkable" },
      );
    }

    const outcome = classifyOutcome(item, checks);
    // A violated rule is a problem with the code, so the rule keeps its status.
    const nextStatus =
      outcome === "verified"
        ? item.status === "stale"
          ? "active"
          : item.status
        : outcome === "stale" || outcome === "contradicted"
          ? "stale"
          : item.status;
    const statusChanged = nextStatus !== item.status;

    if (!options.dryRun) {
      await store.recordVerification(
        item.id,
        {
          evidence: applyResults(checks, checkedAt),
          status: nextStatus,
          lastVerifiedAt: outcome === "verified" ? checkedAt : item.lastVerifiedAt,
        },
        actor,
        summarize(outcome, item, checks),
      );
      if (statusChanged) {
        await appendHistory(store.paths, {
          op: outcome === "verified" ? "verify" : "stale",
          actor,
          itemId: item.id,
          summary: `${item.title}: ${summarize(outcome, item, checks)}`,
          before: { status: item.status },
          after: { status: nextStatus },
        });
      }
    }

    results.push({
      item,
      checks,
      outcome,
      summary: summarize(outcome, item, checks),
      statusChanged: statusChanged && !options.dryRun,
    });
  }

  const counts: Record<VerificationOutcome, number> = {
    verified: 0,
    stale: 0,
    contradicted: 0,
    violated: 0,
    expired: 0,
    unverifiable: 0,
    error: 0,
  };
  for (const result of results) counts[result.outcome] += 1;

  return { checkedAt, results, counts, filesScanned: context.files.length };
}

/** What the developer is being asked to decide about a failing item. */
export function suggestedActions(outcome: VerificationOutcome): string[] {
  switch (outcome) {
    case "contradicted":
    case "stale":
      return ["Update the knowledge to match the code", "Keep it and re-verify", "Archive it"];
    case "violated":
      return ["Fix the code", "Soften the rule", "Archive the rule"];
    case "expired":
      return ["Extend the expiry", "Make it permanent", "Archive it"];
    case "error":
      return ["Fix the evidence predicate"];
    default:
      return [];
  }
}
