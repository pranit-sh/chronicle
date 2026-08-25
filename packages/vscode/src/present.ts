import type {
  Evidence,
  KnowledgeItem,
  KnowledgeStatusName,
  KnowledgeTypeName,
  Proposal,
} from "@codicil/core";
import * as vscode from "vscode";

/** One glyph per knowledge type, so the tree is scannable without reading it. */
const TYPE_ICON: Record<KnowledgeTypeName, string> = {
  rule: "law",
  decision: "git-merge",
  architecture: "type-hierarchy",
  domain: "book",
  convention: "symbol-ruler",
  context: "pulse",
  issue: "warning",
};

const TYPE_LABEL: Record<KnowledgeTypeName, string> = {
  rule: "Rules",
  decision: "Decisions",
  architecture: "Architecture",
  domain: "Domain knowledge",
  convention: "Conventions",
  context: "Current context",
  issue: "Known issues",
};

/** The singular noun for a single item, for detail views and headings. */
const TYPE_NOUN: Record<KnowledgeTypeName, string> = {
  rule: "Rule",
  decision: "Decision",
  architecture: "Architecture",
  domain: "Domain knowledge",
  convention: "Convention",
  context: "Current context",
  issue: "Known issue",
};

const STATUS_LABEL: Record<KnowledgeStatusName, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  active: "Active",
  stale: "Needs attention",
  archived: "Archived",
};

export function typeLabel(type: KnowledgeTypeName): string {
  return TYPE_LABEL[type];
}

export function typeNoun(type: KnowledgeTypeName): string {
  return TYPE_NOUN[type];
}

export function statusLabel(status: KnowledgeStatusName): string {
  return STATUS_LABEL[status];
}

/** Turns a schema enum value into something a reader would recognise. */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function itemIcon(item: KnowledgeItem): vscode.ThemeIcon {
  if (item.status === "stale") {
    return new vscode.ThemeIcon(TYPE_ICON[item.type], new vscode.ThemeColor("problemsWarningIcon.foreground"));
  }
  if (item.status === "archived") {
    return new vscode.ThemeIcon(TYPE_ICON[item.type], new vscode.ThemeColor("disabledForeground"));
  }
  return new vscode.ThemeIcon(TYPE_ICON[item.type]);
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "unknown";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

export function describeEvidence(evidence: Evidence): string {
  const expectation = evidence.expect === "absent" ? "must not be there" : "must be there";
  switch (evidence.kind) {
    case "file":
      return `${evidence.path} ${expectation}`;
    case "glob":
      return `files matching ${evidence.glob} ${expectation}`;
    case "grep":
      return `/${evidence.pattern}/ in ${evidence.glob} ${expectation}`;
    case "commit":
      return `commit ${evidence.sha.slice(0, 8)} ${expectation}`;
    case "ref":
      return evidence.label ? `${evidence.label} (${evidence.url})` : evidence.url;
  }
}

/** A one-line summary for a tree row's tooltip and description column. */
export function itemTooltip(item: KnowledgeItem): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.supportThemeIcons = true;
  tooltip.appendMarkdown(`**${escapeMarkdown(item.title)}**\n\n`);

  const lead = item.body.split("\n\n")[0]?.trim();
  if (lead) tooltip.appendMarkdown(`${escapeMarkdown(lead.slice(0, 300))}\n\n`);

  tooltip.appendMarkdown(
    [
      `${statusLabel(item.status)} · ${item.type}`,
      `Scope: ${item.scopes.join(", ")}`,
      `From: ${item.actor.id} (${item.source})`,
      `Verified: ${relativeTime(item.lastVerifiedAt)}`,
    ].join("  \n"),
  );
  return tooltip;
}

export function proposalTitle(proposal: Proposal, targetTitle?: string): string {
  switch (proposal.op) {
    case "create": {
      const payload = proposal.payload as { title?: string; type?: string } | undefined;
      return `New ${payload?.type ?? "item"}: ${payload?.title ?? "untitled"}`;
    }
    case "update":
      return `Change: ${targetTitle ?? proposal.targetId ?? "unknown item"}`;
    case "archive":
      return `Archive: ${targetTitle ?? proposal.targetId ?? "unknown item"}`;
    case "restore":
      return `Restore: ${targetTitle ?? proposal.targetId ?? "unknown item"}`;
  }
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
