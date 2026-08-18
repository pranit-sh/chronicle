import { type DiffLine, type Proposal, proposalDiff } from "@chronicle/core";
import * as vscode from "vscode";

import { escapeHtml, proposalTitle, relativeTime } from "../present.js";
import type { ChronicleSession } from "../session.js";
import { pageHtml } from "./chrome.js";

/**
 * The proposal review surface.
 *
 * This is where "AI proposes, human disposes" becomes a real interaction: the
 * diff shows exactly what would land, and nothing happens until a person picks
 * accept or reject.
 */
export class ReviewPanel {
  static #current: ReviewPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  #proposalId: string | undefined;
  readonly #disposables: vscode.Disposable[] = [];

  private constructor(private readonly session: ChronicleSession) {
    this.#panel = vscode.window.createWebviewPanel(
      "chronicle.review",
      "Review proposal",
      { viewColumn: vscode.ViewColumn.Active },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.#panel.onDidDispose(() => {
      ReviewPanel.#current = undefined;
      for (const disposable of this.#disposables) disposable.dispose();
    });

    this.#disposables.push(
      session.onDidChange(() => this.#render()),
      this.#panel.webview.onDidReceiveMessage((message: { command: string }) => this.#handle(message)),
    );
  }

  static show(session: ChronicleSession, proposalId: string): void {
    ReviewPanel.#current ??= new ReviewPanel(session);
    ReviewPanel.#current.#proposalId = proposalId;
    ReviewPanel.#current.#render();
    ReviewPanel.#current.#panel.reveal();
  }

  /** Closes the panel once the proposal it was showing has been decided. */
  static dismiss(proposalId: string): void {
    const open = ReviewPanel.#current;
    if (open && open.#proposalId === proposalId) open.#panel.dispose();
  }

  async #handle(message: { command: string }): Promise<void> {
    if (!this.#proposalId) return;
    if (message.command === "accept") {
      await vscode.commands.executeCommand("chronicle.acceptProposal", this.#proposalId);
    } else if (message.command === "reject") {
      await vscode.commands.executeCommand("chronicle.rejectProposal", this.#proposalId);
    }
  }

  #render(): void {
    const proposal = this.session.proposals.find((candidate) => candidate.id === this.#proposalId);
    if (!proposal) {
      this.#panel.webview.html = pageHtml(
        this.#panel.webview,
        "Review proposal",
        `<p class="empty">This proposal has already been decided.</p>`,
      );
      return;
    }

    const target = proposal.targetId ? this.session.store?.get(proposal.targetId) : undefined;
    this.#panel.title = `Review: ${proposalTitle(proposal, target?.title)}`;
    this.#panel.webview.html = pageHtml(
      this.#panel.webview,
      "Review proposal",
      reviewBody(proposal, proposalDiff(proposal, target), target?.title),
    );
  }
}

function diffHtml(lines: readonly DiffLine[]): string {
  return lines
    .map((line) => {
      const klass = line.marker === "+" ? "added" : line.marker === "-" ? "removed" : "";
      return `<div class="line ${klass}">${escapeHtml(`${line.marker} ${line.text}`)}</div>`;
    })
    .join("");
}

function reviewBody(proposal: Proposal, lines: readonly DiffLine[], targetTitle?: string): string {
  const who = `${proposal.proposedBy.id} (${proposal.proposedBy.kind})`;
  return `
<h1>${escapeHtml(proposalTitle(proposal, targetTitle))}</h1>
<p class="subtitle">Proposed by ${escapeHtml(who)} ${escapeHtml(relativeTime(proposal.createdAt))} · ${escapeHtml(proposal.id)}</p>

<div class="callout">${escapeHtml(proposal.reason)}</div>

<h2>What accepting this would do</h2>
<div class="diff"><div class="field">${escapeHtml(proposal.op)}</div>${diffHtml(lines)}</div>

<p class="empty">Nothing has been written to your knowledge base yet.</p>

<div class="actions">
  <button class="primary" data-command="accept">Accept</button>
  <button data-command="reject">Reject</button>
</div>
`;
}
