import { type DiffLine, type Proposal, proposalDiff } from "@chronicle/core";
import * as vscode from "vscode";

import { escapeHtml, humanize, proposalTitle, relativeTime } from "../present.js";
import type { ChronicleSession } from "../session.js";
import {
  blankSlate,
  disclosure,
  glyph,
  pageHtml,
  panelIcon,
  section,
  spec,
  type SpecField,
} from "./chrome.js";

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

  private constructor(
    private readonly session: ChronicleSession,
    extensionUri?: vscode.Uri,
  ) {
    this.#panel = vscode.window.createWebviewPanel(
      "chronicle.review",
      "Review proposal",
      { viewColumn: vscode.ViewColumn.Active },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.#panel.iconPath = panelIcon(extensionUri, "review");

    this.#panel.onDidDispose(() => {
      ReviewPanel.#current = undefined;
      for (const disposable of this.#disposables) disposable.dispose();
    });

    this.#disposables.push(
      session.onDidChange(() => this.#render()),
      this.#panel.webview.onDidReceiveMessage((message: { command: string }) => this.#handle(message)),
    );
  }

  static show(session: ChronicleSession, proposalId: string, extensionUri?: vscode.Uri): void {
    ReviewPanel.#current ??= new ReviewPanel(session, extensionUri);
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
        blankSlate("This proposal has already been decided."),
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

// --- Semantics ------------------------------------------------------------

const MARKER_CLASS: Record<DiffLine["marker"], string> = {
  "+": "added",
  "-": "removed",
  "~": "changed",
  " ": "context",
};

// --- Markup ---------------------------------------------------------------

/** What the diff covers, so the header says something the chips do not repeat. */
function scope(proposal: Proposal): string {
  if (proposal.op === "create") {
    const payload = proposal.payload as { type?: string } | undefined;
    return `A new ${payload?.type ?? "item"} record`;
  }
  if (proposal.op !== "update") return "The whole record";
  const fields = Object.keys(proposal.changes ?? {});
  return fields.length === 1 ? "1 field" : `${fields.length} fields`;
}

function diff(lines: readonly DiffLine[], proposal: Proposal): string {
  const added = lines.filter((line) => line.marker === "+").length;
  const removed = lines.filter((line) => line.marker === "-").length;

  const body = lines
    .map(
      (line) =>
        `<div class="dline dline--${MARKER_CLASS[line.marker]}"><span class="dline-mark">${escapeHtml(
          line.marker.trim(),
        )}</span><span class="dline-text">${escapeHtml(line.text)}</span></div>`,
    )
    .join("");

  return `<div class="diff">
<div class="diff-head">
<span class="diff-scope">${escapeHtml(scope(proposal))}</span>
<span class="diff-stat"><span class="added">+${added}</span><span class="removed">-${removed}</span></span>
</div>
<div class="diff-body">${body}</div>
</div>`;
}

function reviewBody(proposal: Proposal, lines: readonly DiffLine[], targetTitle?: string): string {
  const fields: SpecField[] = [
    { label: "Proposed by", value: `${proposal.proposedBy.id} (${humanize(proposal.proposedBy.kind)})` },
    { label: "Raised", value: humanize(relativeTime(proposal.createdAt)) },
  ];
  if (targetTitle) fields.push({ label: "Existing record", value: targetTitle });
  if (proposal.targetId) fields.push({ label: "Target id", value: proposal.targetId, mono: true, wide: true });

  return `<div class="shell">
<header class="masthead">
<div class="eyebrow">
<span class="eyebrow-mark">${glyph("proposal")}</span>
<span class="eyebrow-kind">Proposal</span>
<span class="eyebrow-sep">/</span>
<span class="eyebrow-id" title="${escapeHtml(proposal.id)}">${escapeHtml(proposal.id)}</span>
</div>
<h1 class="title">${escapeHtml(proposalTitle(proposal, targetTitle))}</h1>
<div class="review-actions">
<button class="btn btn--primary" data-command="accept">Accept</button>
<button class="btn" data-command="reject">Reject</button>
<span class="review-actions-note">Nothing has been written to your knowledge base yet.</span>
</div>
</header>

<main class="content">
${section("Reason", `<p class="reason">${escapeHtml(proposal.reason)}</p>`)}
${section("Changes", diff(lines, proposal))}
${disclosure("Details", spec(fields))}
</main>
</div>`;
}
