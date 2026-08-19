import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { ChronicleError, formatZodError } from "./errors.js";
import { atomicWrite, ensureDir, listFilesRecursive } from "./fs-utils.js";
import { appendHistory } from "./history.js";
import { newProposalId } from "./ids.js";
import type { ChroniclePaths } from "./paths.js";
import {
  type Actor,
  type ChronicleConfig,
  type FieldChange,
  type KnowledgeDraft,
  KnowledgeDraftSchema,
  type KnowledgeItem,
  type Proposal,
  type ProposalOp,
  ProposalSchema,
  UPDATABLE_FIELDS,
  type UpdatableField,
} from "./schema.js";
import type { ChronicleStore } from "./store.js";

/**
 * The staging area that makes "AI proposes, developer disposes" structural
 * rather than a convention. Agents can write here and nowhere else; accepting a
 * proposal is the only path from this directory into `.chronicle/knowledge`.
 */

function proposalFile(paths: ChroniclePaths, id: string): string {
  return path.join(paths.proposalsDir, `${id}.yaml`);
}

export async function listProposals(paths: ChroniclePaths): Promise<Proposal[]> {
  const files = await listFilesRecursive(paths.proposalsDir, ".yaml");
  const proposals: Proposal[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    const parsed = ProposalSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new ChronicleError(
        "invalid_document",
        formatZodError(parsed.error, `${path.basename(file)} is not a valid proposal:`),
        parsed.error.issues,
      );
    }
    proposals.push(parsed.data);
  }
  return proposals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function resolveProposal(paths: ChroniclePaths, reference: string): Promise<Proposal> {
  const proposals = await listProposals(paths);
  const matches = proposals.filter(
    (proposal) => proposal.id === reference || (reference.length >= 4 && proposal.id.startsWith(reference)),
  );
  if (matches.length === 1) return matches[0] as Proposal;
  if (matches.length === 0) {
    throw new ChronicleError("not_found", `No proposal matches "${reference}".`);
  }
  throw new ChronicleError(
    "ambiguous_reference",
    `"${reference}" matches ${matches.length} proposals: ${matches.map((p) => p.id).join(", ")}`,
  );
}

async function writeProposal(paths: ChroniclePaths, proposal: Proposal): Promise<Proposal> {
  await ensureDir(paths.proposalsDir);
  await atomicWrite(proposalFile(paths, proposal.id), stringifyYaml(proposal, { lineWidth: 0 }));
  return proposal;
}

/**
 * Enforces the authority levels from `config.yaml`. Only agents are gated:
 * a human running the CLI is the reviewer, not a party that needs reviewing.
 */
export function assertMayPropose(
  config: ChronicleConfig,
  proposedBy: Actor,
  op: ProposalOp,
  target?: KnowledgeItem,
): void {
  if (proposedBy.kind !== "agent") return;

  if (!config.authority.autoLearn) {
    throw new ChronicleError(
      "forbidden",
      "This project has authority.autoLearn disabled, so agents may not stage knowledge proposals.",
    );
  }
  if (op === "create") return;

  const touchesSettledKnowledge =
    target?.type === "rule" || (target?.type === "decision" && target.decisionStatus === "accepted");
  if (touchesSettledKnowledge && !config.authority.autoModifyRules) {
    throw new ChronicleError(
      "forbidden",
      `This project has authority.autoModifyRules disabled, so agents may not propose changes to an accepted ${target?.type}. Raise it with the developer instead.`,
    );
  }
}

function currentValue(item: KnowledgeItem, field: UpdatableField): unknown {
  if (field === "body") return item.body;
  return (item as unknown as Record<string, unknown>)[field];
}

/** Turns a patch into field level before/after pairs, dropping no-ops. */
export function buildChanges(
  item: KnowledgeItem,
  patch: Partial<Record<UpdatableField, unknown>>,
): Partial<Record<UpdatableField, FieldChange>> {
  const changes: Partial<Record<UpdatableField, FieldChange>> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in patch)) continue;
    const before = currentValue(item, field);
    const after = patch[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes[field] = { before, after };
  }
  return changes;
}

export interface ProposeCreateInput {
  draft: KnowledgeDraft;
  proposedBy: Actor;
  reason: string;
}

export async function proposeCreate(
  store: ChronicleStore,
  input: ProposeCreateInput,
): Promise<Proposal> {
  assertMayPropose(store.config, input.proposedBy, "create");

  const draft = KnowledgeDraftSchema.safeParse(input.draft);
  if (!draft.success) {
    throw new ChronicleError(
      "invalid_input",
      formatZodError(draft.error, "Invalid proposed knowledge:"),
      draft.error.issues,
    );
  }

  const proposal = ProposalSchema.parse({
    id: newProposalId(),
    op: "create",
    proposedBy: input.proposedBy,
    createdAt: new Date().toISOString(),
    reason: input.reason,
    payload: { ...draft.data, source: draft.data.source ?? (input.proposedBy.kind === "agent" ? "ai" : "human") },
  });

  await writeProposal(store.paths, proposal);
  await appendHistory(store.paths, {
    op: "propose",
    actor: input.proposedBy,
    proposalId: proposal.id,
    summary: `Proposed new ${draft.data.type} "${draft.data.title}"`,
  });
  return proposal;
}

export interface ProposeChangeInput {
  targetRef: string;
  op: Extract<ProposalOp, "update" | "archive" | "restore">;
  patch?: Partial<Record<UpdatableField, unknown>>;
  proposedBy: Actor;
  reason: string;
}

export async function proposeChange(
  store: ChronicleStore,
  input: ProposeChangeInput,
): Promise<Proposal> {
  const target = store.resolveRef(input.targetRef);
  assertMayPropose(store.config, input.proposedBy, input.op, target);

  const changes = input.op === "update" ? buildChanges(target, input.patch ?? {}) : undefined;
  if (input.op === "update" && Object.keys(changes ?? {}).length === 0) {
    throw new ChronicleError(
      "invalid_input",
      `That proposal would not change anything about "${target.title}".`,
    );
  }

  const proposal = ProposalSchema.parse({
    id: newProposalId(),
    op: input.op,
    targetId: target.id,
    proposedBy: input.proposedBy,
    createdAt: new Date().toISOString(),
    reason: input.reason,
    ...(changes ? { changes } : {}),
  });

  await writeProposal(store.paths, proposal);
  await appendHistory(store.paths, {
    op: "propose",
    actor: input.proposedBy,
    proposalId: proposal.id,
    itemId: target.id,
    summary: `Proposed to ${input.op} "${target.title}"`,
  });
  return proposal;
}

export interface AcceptOptions {
  /**
   * Fields the reviewer corrected before accepting, applied over the proposal.
   * This is the "Edit" in Accept / Reject / Edit: an agent's suggestion is
   * often right in substance and wrong in scope or wording.
   */
  overrides?: Record<string, unknown>;
}

export interface AcceptResult {
  proposal: Proposal;
  item?: KnowledgeItem;
}

export async function acceptProposal(
  store: ChronicleStore,
  reference: string,
  actor: Actor,
  options: AcceptOptions = {},
): Promise<AcceptResult> {
  if (actor.kind === "agent") {
    throw new ChronicleError(
      "forbidden",
      "Proposals can only be accepted by a person. An agent may stage knowledge but never ratify it.",
    );
  }

  const proposal = await resolveProposal(store.paths, reference);
  const overrides = options.overrides ?? {};
  let item: KnowledgeItem | undefined;

  switch (proposal.op) {
    case "create": {
      const merged = KnowledgeDraftSchema.safeParse({ ...proposal.payload, ...overrides });
      if (!merged.success) {
        throw new ChronicleError(
          "invalid_input",
          formatZodError(merged.error, "The proposal cannot be accepted as edited:"),
          merged.error.issues,
        );
      }
      item = await store.create(merged.data as KnowledgeDraft, actor, { silent: true });
      break;
    }
    case "update": {
      const patch: Partial<Record<UpdatableField, unknown>> = {};
      for (const [field, change] of Object.entries(proposal.changes ?? {})) {
        patch[field as UpdatableField] = (change as FieldChange).after;
      }
      for (const [field, value] of Object.entries(overrides)) {
        if ((UPDATABLE_FIELDS as readonly string[]).includes(field)) {
          patch[field as UpdatableField] = value;
        }
      }
      item = await store.update(proposal.targetId as string, patch, actor, { silent: true });
      break;
    }
    case "archive":
      item = await store.archive(proposal.targetId as string, actor, "Archived by accepting a proposal");
      break;
    case "restore":
      item = await store.restore(proposal.targetId as string, actor);
      break;
  }

  await rm(proposalFile(store.paths, proposal.id), { force: true });
  await appendHistory(store.paths, {
    op: "accept",
    actor,
    proposalId: proposal.id,
    ...(item ? { itemId: item.id } : {}),
    summary: `Accepted ${proposal.op} proposal from ${proposal.proposedBy.id}${
      Object.keys(overrides).length ? " (with edits)" : ""
    }`,
    after: item ? { title: item.title, status: item.status, scopes: item.scopes } : undefined,
  });

  return { proposal, ...(item ? { item } : {}) };
}

export async function rejectProposal(
  store: ChronicleStore,
  reference: string,
  actor: Actor,
  reason?: string,
): Promise<Proposal> {
  const proposal = await resolveProposal(store.paths, reference);
  await rm(proposalFile(store.paths, proposal.id), { force: true });
  await appendHistory(store.paths, {
    op: "reject",
    actor,
    proposalId: proposal.id,
    ...(proposal.targetId ? { itemId: proposal.targetId } : {}),
    summary: reason ?? `Rejected ${proposal.op} proposal from ${proposal.proposedBy.id}`,
    // The file is gone, so the log keeps the whole thing rather than a summary.
    before: proposal,
  });
  return proposal;
}

// --- Diff rendering -------------------------------------------------------

export type DiffMarker = "+" | "-" | "~" | " ";

export interface DiffLine {
  marker: DiffMarker;
  text: string;
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "(none)";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(empty)";
  if (typeof value === "string") return value.includes("\n") ? `${value.split("\n")[0]} …` : value;
  return String(value);
}

/**
 * A Git-like view of what accepting this proposal would do: `+` for what it
 * adds, `~` for what it changes, `-` for what it retires.
 */
export function proposalDiff(proposal: Proposal, target?: KnowledgeItem): DiffLine[] {
  const lines: DiffLine[] = [];

  if (proposal.op === "create") {
    const payload = proposal.payload as KnowledgeDraft;
    lines.push({ marker: "+", text: `new ${payload.type}: ${payload.title}` });
    const fields: Array<[string, unknown]> = [
      ["scopes", payload.scopes ?? ["project"]],
      ["tags", payload.tags],
      ["paths", payload.paths],
      ["enforcement", payload.enforcement],
      ["severity", payload.severity],
      ["lifetime", payload.lifetime],
      ["expires", payload.expiresAt],
      ["source", payload.source],
    ];
    for (const [label, value] of fields) {
      if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
      lines.push({ marker: "+", text: `    ${label}: ${formatValue(value)}` });
    }
    if (payload.body) {
      for (const line of String(payload.body).split("\n")) {
        lines.push({ marker: "+", text: `    ${line}` });
      }
    }
    return lines;
  }

  const title = target?.title ?? proposal.targetId ?? "unknown item";

  if (proposal.op === "archive") {
    lines.push({ marker: "-", text: `archive ${target?.type ?? "item"}: ${title}` });
    return lines;
  }
  if (proposal.op === "restore") {
    lines.push({ marker: "+", text: `restore ${target?.type ?? "item"}: ${title}` });
    return lines;
  }

  lines.push({ marker: "~", text: `update ${target?.type ?? "item"}: ${title}` });
  for (const [field, change] of Object.entries(proposal.changes ?? {})) {
    const { before, after } = change as FieldChange;
    if (field === "body") {
      lines.push({ marker: " ", text: "    body:" });
      for (const line of formatMultiline(before)) lines.push({ marker: "-", text: `      ${line}` });
      for (const line of formatMultiline(after)) lines.push({ marker: "+", text: `      ${line}` });
      continue;
    }
    lines.push({ marker: "-", text: `    ${field}: ${formatValue(before)}` });
    lines.push({ marker: "+", text: `    ${field}: ${formatValue(after)}` });
  }
  return lines;
}

function formatMultiline(value: unknown): string[] {
  if (typeof value !== "string" || !value) return ["(empty)"];
  return value.split("\n");
}

export function renderDiff(lines: readonly DiffLine[]): string {
  return lines.map((line) => `${line.marker} ${line.text}`).join("\n");
}
