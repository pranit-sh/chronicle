import type { Evidence, KnowledgeItem, KnowledgeStatusName } from "@chronicle/core";
import MarkdownIt from "markdown-it";
import * as vscode from "vscode";

import { describeEvidence, escapeHtml, humanize, relativeTime, statusLabel, typeNoun } from "../present.js";
import type { ChronicleSession } from "../session.js";
import {
  blankSlate,
  callout,
  empty,
  glyph,
  pageHtml,
  pill,
  section,
  spec,
  tag,
  type SpecField,
  type Tone,
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
        blankSlate("That knowledge item is no longer here."),
      );
      return;
    }

    this.#panel.title = item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title;
    this.#panel.webview.html = pageHtml(this.#panel.webview, item.title, detailBody(item));
  }
}

// --- Semantics ------------------------------------------------------------

const STATUS_TONE: Record<KnowledgeStatusName, Tone> = {
  active: "good",
  confirmed: "accent",
  proposed: "warn",
  stale: "bad",
  archived: "neutral",
};

const ENFORCEMENT_TONE: Record<string, Tone> = { must: "accent", should: "neutral", never: "bad" };
/** Accepted stays neutral: colour is reserved for the states that need a human. */
const DECISION_TONE: Record<string, Tone> = {
  accepted: "neutral",
  proposed: "warn",
  superseded: "neutral",
  rejected: "bad",
};
const SEVERITY_TONE: Record<string, Tone> = { low: "neutral", medium: "warn", high: "bad", critical: "bad" };
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

/** State the reader needs before reading a word of the item itself. */
function chips(item: KnowledgeItem): string {
  const qualifier =
    item.type === "rule"
      ? pill(humanize(item.enforcement), ENFORCEMENT_TONE[item.enforcement] ?? "neutral")
      : item.type === "decision"
        ? pill(humanize(item.decisionStatus), DECISION_TONE[item.decisionStatus] ?? "neutral")
        : item.type === "issue"
          ? pill(`${humanize(item.severity)} severity`, SEVERITY_TONE[item.severity] ?? "neutral")
          : "";

  return [
    pill(statusLabel(item.status), STATUS_TONE[item.status]),
    qualifier,
    expired(item) ? pill("Expired", "bad") : "",
    item.source === "ai" ? pill("From an agent", "warn") : "",
    item.pinned ? tag("Pinned") : "",
  ]
    .filter(Boolean)
    .join("");
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
      "The evidence behind this no longer matches the code. Update it, or archive it, so your agents stop being told something untrue.",
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
  const fields: SpecField[] = [
    { label: "Scope", value: item.scopes.join(", "), mono: true },
    { label: "Added by", value: `${item.actor.id} (${item.actor.kind})` },
    {
      label: "Origin",
      value: item.provenance.ref ? `${humanize(item.provenance.origin)} — ${item.provenance.ref}` : humanize(item.provenance.origin),
    },
    { label: "Confidence", value: `${Math.round(item.confidence * 100)}%`, meter: item.confidence },
    { label: "Priority", value: `${item.priority} of 100` },
    {
      label: "Lifetime",
      value: item.expiresAt
        ? `${humanize(item.lifetime)}, expires ${item.expiresAt.slice(0, 10)}`
        : humanize(item.lifetime),
    },
    { label: "Last verified", value: relativeTime(item.lastVerifiedAt) },
    { label: "Last updated", value: relativeTime(item.updatedAt) },
  ];

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
<span class="verdict verdict--${verdict}">${escapeHtml(result)}</span>
<span class="record-main">
<span class="record-title">${escapeHtml(describeEvidence(entry))}</span>
${notes ? `<span class="record-note">${escapeHtml(notes)}</span>` : ""}
</span>
</li>`;
}

function evidenceSection(item: KnowledgeItem): string {
  if (!item.evidence.length) {
    return section(
      "Evidence",
      empty("Nothing here can be checked against the code automatically, so this will never be marked stale on its own."),
    );
  }
  return section("Evidence", `<ul class="records">${item.evidence.map(evidenceRow).join("")}</ul>`, {
    count: item.evidence.length,
  });
}

function detailBody(item: KnowledgeItem): string {
  const body = item.body.trim();
  const workaround = item.type === "issue" && item.workaround ? item.workaround.trim() : "";

  return `<div class="shell">
<header class="masthead">
<div class="eyebrow">
<span class="eyebrow-mark">${glyph(item.type)}</span>
<span class="eyebrow-kind">${escapeHtml(typeNoun(item.type))}</span>
<span class="eyebrow-sep">/</span>
<span class="eyebrow-id" title="${escapeHtml(item.id)}">${escapeHtml(item.id)}</span>
</div>
<h1 class="title">${escapeHtml(item.title)}</h1>
<div class="chips">${chips(item)}</div>
</header>

<main class="content">
${alert(item)}
${section("Record", spec(record(item)))}
${body ? section("What this says", `<div class="prose">${renderBody(body)}</div>`) : ""}
${workaround ? section("Workaround", `<div class="prose">${renderBody(workaround)}</div>`) : ""}
${evidenceSection(item)}
</main>

<footer class="actionbar">
<button class="btn btn--primary" data-command="verify">Verify against the code</button>
<button class="btn" data-command="open">Open the Markdown</button>
${
  item.status === "archived"
    ? `<button class="btn btn--quiet" data-command="restore">Restore</button>`
    : `<button class="btn btn--quiet" data-command="archive">Archive</button>`
}
<span class="actionbar-note">Every change lands in the Markdown, versioned with your code.</span>
</footer>
</div>`;
}
