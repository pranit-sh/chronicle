import type { Proposal } from "@codicil/core";
import * as vscode from "vscode";

import { proposalTitle, relativeTime } from "../present.js";
import type { CodicilSession } from "../session.js";

/**
 * Pending agent proposals.
 *
 * Every row is a decision waiting on a person, so each one carries accept and
 * reject inline. Nothing here has touched the knowledge base yet.
 */
export class ProposalTree implements vscode.TreeDataProvider<Proposal> {
  readonly onDidChangeTreeData: vscode.Event<void>;
  readonly #emitter = new vscode.EventEmitter<void>();

  constructor(private readonly session: CodicilSession) {
    this.onDidChangeTreeData = this.#emitter.event;
    session.onDidChange(() => this.#emitter.fire());
  }

  refresh(): void {
    this.#emitter.fire();
  }

  getTreeItem(proposal: Proposal): vscode.TreeItem {
    const target = proposal.targetId ? this.session.store?.get(proposal.targetId) : undefined;
    const row = new vscode.TreeItem(proposalTitle(proposal, target?.title));
    row.id = proposal.id;
    row.contextValue = "proposal";
    row.iconPath = new vscode.ThemeIcon(
      proposal.op === "create" ? "diff-added" : proposal.op === "archive" ? "diff-removed" : "diff-modified",
    );
    row.description = `${proposal.proposedBy.id} · ${relativeTime(proposal.createdAt)}`;
    row.command = {
      command: "codicil.reviewProposal",
      title: "Review proposal",
      arguments: [proposal.id],
    };

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${proposal.reason}**\n\n`);
    tooltip.appendMarkdown(
      `Proposed by ${proposal.proposedBy.id} (${proposal.proposedBy.kind}) ${relativeTime(proposal.createdAt)}.\n\n`,
    );
    tooltip.appendMarkdown("Nothing changes until you accept it.");
    row.tooltip = tooltip;

    return row;
  }

  getChildren(node?: Proposal): Proposal[] {
    if (node) return [];
    return [...this.session.proposals].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  }
}
