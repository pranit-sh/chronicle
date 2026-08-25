import type { Evidence, KnowledgeItem } from "@codicil/core";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";

import { describeEvidence, escapeHtml, humanize, relativeTime, typeNoun } from "../present.js";
import type { CodicilSession } from "../session.js";
import {
  blankSlate,
  callout,
  disclosure,
  empty,
  glyph,
  pageHtml,
  panelIcon,
  section,
  spec,
  type SpecField,
} from "./chrome.js";

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

  private constructor(
    private readonly session: CodicilSession,
    extensionUri?: vscode.Uri,
  ) {
    this.#panel = vscode.window.createWebviewPanel(
      "codicil.detail",
      "Codicil",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.#panel.iconPath = panelIcon(extensionUri, "knowledge");

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

  static show(session: CodicilSession, itemId: string, extensionUri?: vscode.Uri): void {
    DetailPanel.#current ??= new DetailPanel(session, extensionUri);
    DetailPanel.#current.#itemId = itemId;
    DetailPanel.#current.#render();
    DetailPanel.#current.#panel.reveal(vscode.ViewColumn.Beside, true);
  }

  async #handle(message: { command: string; value?: string }): Promise<void> {
    if (!this.#itemId) return;
    switch (message.command) {
      case "open":
        await vscode.commands.executeCommand("codicil.openFile", this.#itemId);
        break;
      case "verify":
        await vscode.commands.executeCommand("codicil.verifyItem", this.#itemId);
        break;
      case "archive":
        await vscode.commands.executeCommand("codicil.archiveItem", this.#itemId);
        break;
      case "restore":
        await vscode.commands.executeCommand("codicil.restoreItem", this.#itemId);
        break;
    }
  }

  #render(): void {
    const item = this.#itemId ? this.session.store?.get(this.#itemId) : undefined;
    if (!item) {
      this.#panel.title = "Codicil";
      this.#panel.webview.html = pageHtml(
        this.#panel.webview,
        "Codicil",
        blankSlate("That knowledge item is no longer here."),
      );
      return;
    }

    this.#panel.title = item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title;
    this.#panel.webview.html = pageHtml(this.#panel.webview, item.title, detailBody(item));
  }
}

// --- Semantics ------------------------------------------------------------

const VERDICT_TONE: Record<string, "pass" | "fail" | "unknown"> = {
  pass: "pass",
  fail: "fail",
  error: "fail",
  unknown: "unknown",
};

function expired(item: KnowledgeItem): boolean {
  return Boolean(item.expiresAt && Date.parse(item.expiresAt) < Date.now());
}

// --- Markup ---------------------------------------------------------------

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

/**
 * The one thing worth interrupting the reader for.
 *
 * Only ever one: a record with three warnings at the top of it teaches people
 * to scroll past all of them.
 */
function alert(item: KnowledgeItem): string {
  if (item.status === "stale") {
    return callout(
      "bad",
      "Needs attention",
      "Verification checks no longer match the code. Update or archive this item.",
    );
  }
  if (expired(item)) {
    return callout("warn", "Past its expiry", `This passed its expiry date on ${String(item.expiresAt).slice(0, 10)}.`);
  }
  if (item.status === "archived") {
    return callout("accent", "Archived", "Kept for the record. Your agents are no longer given this.");
  }
  return "";
}

function record(item: KnowledgeItem): SpecField[] {
  const fields: SpecField[] = [];

  if (item.status === "proposed") fields.push({ label: "Status", value: "Proposed" });
  if (item.type === "rule") fields.push({ label: "Enforcement", value: humanize(item.enforcement) });
  if (item.type === "decision" && item.decisionStatus !== "accepted") {
    fields.push({ label: "Decision status", value: humanize(item.decisionStatus) });
  }
  if (item.type === "issue") fields.push({ label: "Severity", value: humanize(item.severity) });
  if (item.pinned) fields.push({ label: "Pinned", value: "Yes" });

  fields.push(
    { label: "Scope", value: item.scopes.map((scope) => (scope === "project" ? "Project" : scope)).join(", ") },
    { label: "Added by", value: `${item.actor.id} (${humanize(item.actor.kind)})` },
    {
      label: "Origin",
      value: item.provenance.ref ? `${humanize(item.provenance.origin)} — ${item.provenance.ref}` : humanize(item.provenance.origin),
    },
    { label: "Confidence", value: `${Math.round(item.confidence * 100)}%` },
    { label: "Priority", value: `${item.priority} of 100` },
    {
      label: "Lifetime",
      value: item.expiresAt
        ? `${humanize(item.lifetime)}, expires ${item.expiresAt.slice(0, 10)}`
        : humanize(item.lifetime),
    },
    { label: "Last verified", value: humanize(relativeTime(item.lastVerifiedAt)) },
    { label: "Last updated", value: humanize(relativeTime(item.updatedAt)) },
  );

  if (item.paths.length) fields.push({ label: "Applies to", value: item.paths.join("  ·  "), mono: true, wide: true });
  if (item.tags.length) fields.push({ label: "Tags", value: item.tags.join(", "), wide: true });
  if (item.type === "decision" && item.supersededBy) {
    fields.push({ label: "Superseded by", value: item.supersededBy, mono: true });
  }
  if (item.supersedes.length) {
    fields.push({ label: "Supersedes", value: item.supersedes.join(", "), mono: true, wide: true });
  }
  return fields;
}

function evidenceRow(entry: Evidence): string {
  const result = entry.lastResult ?? "unknown";
  const verdict = VERDICT_TONE[result] ?? "unknown";
  const notes = [entry.note, entry.lastDetail, entry.lastCheckedAt ? `checked ${relativeTime(entry.lastCheckedAt)}` : ""]
    .filter(Boolean)
    .join(" · ");

  return `<li class="record">
<span class="verdict verdict--${verdict}">${escapeHtml(humanize(result))}</span>
<span class="record-main">
<span class="record-title">${escapeHtml(describeEvidence(entry))}</span>
${notes ? `<span class="record-note">${escapeHtml(notes)}</span>` : ""}
</span>
</li>`;
}

function evidenceSection(item: KnowledgeItem): string {
  if (!item.evidence.length) {
    return section(
      "Verification",
      empty("No checks configured."),
    );
  }
  return section("Verification", `<ul class="records">${item.evidence.map(evidenceRow).join("")}</ul>`, {
    count: item.evidence.length,
  });
}

function detailBody(item: KnowledgeItem): string {
  const body = item.body.trim();
  const workaround = item.type === "issue" && item.workaround ? item.workaround.trim() : "";
  const hasAutomatedEvidence = item.evidence.some((entry) => entry.kind !== "ref");

  return `<div class="shell">
<header class="masthead">
<div class="eyebrow">
<span class="eyebrow-mark">${glyph(item.type)}</span>
<span class="eyebrow-kind">${escapeHtml(typeNoun(item.type))}</span>
<span class="eyebrow-sep">/</span>
<span class="eyebrow-id" title="${escapeHtml(item.id)}">${escapeHtml(item.id)}</span>
</div>
<h1 class="title">${escapeHtml(item.title)}</h1>
</header>

<main class="content">
${alert(item)}
${body ? section("Content", `<div class="prose">${renderBody(body)}</div>`) : ""}
${workaround ? section("Workaround", `<div class="prose">${renderBody(workaround)}</div>`) : ""}
${evidenceSection(item)}
${disclosure("Details", spec(record(item)))}
</main>

<footer class="actionbar">
${
  hasAutomatedEvidence
    ? `<button class="btn btn--primary" data-command="verify">Verify against the code</button>
<button class="btn" data-command="open">Open the Markdown</button>`
    : `<button class="btn btn--primary" data-command="open">Open the Markdown</button>
<button hidden data-command="verify">Verify against the code</button>`
}
${
  item.status === "archived"
    ? `<button class="btn btn--quiet" data-command="restore">Restore</button>`
    : `<button class="btn btn--quiet" data-command="archive">Archive</button>`
}
</footer>
</div>`;
}
