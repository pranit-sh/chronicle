import type { KnowledgeItem } from "@chronicle/core";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";

import { describeEvidence, escapeHtml, relativeTime, statusLabel } from "../present.js";
import type { ChronicleSession } from "../session.js";
import { pageHtml } from "./chrome.js";

/**
 * The detail panel for one knowledge item.
 *
 * A single reusable panel rather than one per item, because this is a reading
 * surface: clicking through the tree should feel like moving a cursor, not
 * accumulating tabs.
 */
export class DetailPanel {
  static #current: DetailPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  #itemId: string | undefined;
  readonly #disposables: vscode.Disposable[] = [];

  private constructor(private readonly session: ChronicleSession) {
    this.#panel = vscode.window.createWebviewPanel(
      "chronicle.detail",
      "Chronicle",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.#panel.onDidDispose(() => {
      DetailPanel.#current = undefined;
      for (const disposable of this.#disposables) disposable.dispose();
    });

    this.#disposables.push(
      session.onDidChange(() => this.#render()),
      this.#panel.webview.onDidReceiveMessage((message: { command: string; value?: string }) =>
        this.#handle(message),
      ),
    );
  }

  static show(session: ChronicleSession, itemId: string): void {
    DetailPanel.#current ??= new DetailPanel(session);
    DetailPanel.#current.#itemId = itemId;
    DetailPanel.#current.#render();
    DetailPanel.#current.#panel.reveal(vscode.ViewColumn.Beside, true);
  }

  async #handle(message: { command: string; value?: string }): Promise<void> {
    if (!this.#itemId) return;
    switch (message.command) {
      case "open":
        await vscode.commands.executeCommand("chronicle.openFile", this.#itemId);
        break;
      case "verify":
        await vscode.commands.executeCommand("chronicle.verifyItem", this.#itemId);
        break;
      case "archive":
        await vscode.commands.executeCommand("chronicle.archiveItem", this.#itemId);
        break;
      case "restore":
        await vscode.commands.executeCommand("chronicle.restoreItem", this.#itemId);
        break;
    }
  }

  #render(): void {
    const item = this.#itemId ? this.session.store?.get(this.#itemId) : undefined;
    if (!item) {
      this.#panel.title = "Chronicle";
      this.#panel.webview.html = pageHtml(
        this.#panel.webview,
        "Chronicle",
        `<p class="empty">That knowledge item is no longer here.</p>`,
      );
      return;
    }

    this.#panel.title = item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title;
    this.#panel.webview.html = pageHtml(this.#panel.webview, item.title, detailBody(item));
  }
}

function badgeClass(item: KnowledgeItem): string {
  if (item.status === "stale") return "badge bad";
  if (item.status === "archived") return "badge";
  if (item.status === "active") return "badge good";
  return "badge warn";
}

function expired(item: KnowledgeItem): boolean {
  return Boolean(item.expiresAt && Date.parse(item.expiresAt) < Date.now());
}

/**
 * Bodies are written by hand, so they get a real CommonMark renderer.
 *
 * Raw HTML stays off: a knowledge file can arrive over a merge or from an
 * accepted agent proposal, and none of that should be able to inject markup
 * into the panel. markdown-it also rejects `javascript:` and `vbscript:` link
 * targets on its own.
 */
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

function renderBody(body: string): string {
  return markdown.render(body.trim());
}

function detailBody(item: KnowledgeItem): string {
  const badges = [
    `<span class="${badgeClass(item)}">${escapeHtml(statusLabel(item.status))}</span>`,
    `<span class="badge">${escapeHtml(item.type)}</span>`,
    ...item.scopes.map((scope) => `<span class="badge">${escapeHtml(scope)}</span>`),
    item.pinned ? `<span class="badge">pinned</span>` : "",
    item.source === "ai" ? `<span class="badge warn">from an agent</span>` : "",
    expired(item) ? `<span class="badge bad">expired</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const facts: Array<[string, string]> = [
    ["Added by", `${item.actor.id} (${item.actor.kind})`],
    ["Origin", item.provenance.ref ? `${item.provenance.origin} — ${item.provenance.ref}` : item.provenance.origin],
    ["Confidence", item.confidence.toFixed(2)],
    ["Priority", String(item.priority)],
    ["Lifetime", item.expiresAt ? `${item.lifetime}, expires ${item.expiresAt.slice(0, 10)}` : item.lifetime],
    ["Last verified", relativeTime(item.lastVerifiedAt)],
    ["Last updated", relativeTime(item.updatedAt)],
  ];
  if (item.paths.length) facts.push(["Applies to", item.paths.join(", ")]);
  if (item.tags.length) facts.push(["Tags", item.tags.join(", ")]);
  if (item.type === "rule") facts.push(["Enforcement", item.enforcement]);
  if (item.type === "decision") facts.push(["Decision", item.decisionStatus]);
  if (item.type === "issue") facts.push(["Severity", item.severity]);

  const callout =
    item.status === "stale"
      ? `<div class="callout">The evidence behind this no longer matches the code. Update it, or archive it, so your agents stop being told something untrue.</div>`
      : expired(item)
        ? `<div class="callout">This passed its expiry date on ${escapeHtml(String(item.expiresAt).slice(0, 10))}.</div>`
        : "";

  const evidence = item.evidence.length
    ? `<h2>Evidence</h2><ul class="evidence">${item.evidence
        .map((entry) => {
          const result = entry.lastResult ?? "unknown";
          const klass = result === "pass" ? "pass" : result === "unknown" ? "unknown" : "fail";
          return `<li><span class="result ${klass}">${escapeHtml(result)}</span><span>${escapeHtml(
            describeEvidence(entry),
          )}${
            entry.lastDetail ? `<br /><span class="empty">${escapeHtml(entry.lastDetail)}</span>` : ""
          }</span></li>`;
        })
        .join("")}</ul>`
    : `<h2>Evidence</h2><p class="empty">Nothing here can be checked against the code automatically, so this will never be marked stale on its own.</p>`;

  const actions = [
    `<button class="primary" data-command="verify">Verify against the code</button>`,
    `<button data-command="open">Open the Markdown</button>`,
    item.status === "archived"
      ? `<button data-command="restore">Restore</button>`
      : `<button data-command="archive">Archive</button>`,
  ].join("");

  return `
<h1>${escapeHtml(item.title)}</h1>
<p class="subtitle">${escapeHtml(item.id)}</p>
<div class="badges">${badges}</div>
${callout}
<dl class="facts">${facts
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("")}</dl>
${item.body.trim() ? `<div class="body">${renderBody(item.body)}</div>` : ""}
${evidence}
<div class="actions">${actions}</div>
`;
}
