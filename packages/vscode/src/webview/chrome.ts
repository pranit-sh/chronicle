import { randomBytes } from "node:crypto";

import type { KnowledgeTypeName } from "@chronicle/core";
import * as vscode from "vscode";

import { escapeHtml } from "../present.js";

/**
 * The shared shell and design system for the extension's webviews.
 *
 * Every colour resolves from VS Code's own theme tokens, so a panel reads as
 * part of the editor in any theme rather than a website embedded in one. Status
 * is the only thing allowed to carry colour: type, scope and metadata stay
 * neutral, which is what keeps a dense record legible instead of decorative.
 */

/** Semantic colour, never decorative — `bad` means something is wrong. */
export type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

export interface SpecField {
  label: string;
  value: string;
  /** Renders the value in the editor font — for ids, paths and globs. */
  mono?: boolean;
  /** Long values take the full width of the grid instead of one cell. */
  wide?: boolean;
}

export function nonce(): string {
  return randomBytes(16).toString("base64");
}

export function pageHtml(webview: vscode.Webview, title: string, body: string): string {
  const key = nonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${key}';" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${styles()}</style>
</head>
<body>
${body}
<script nonce="${key}">
  const vscode = acquireVsCodeApi();

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-command]");
    if (!target) return;
    event.preventDefault();
    vscode.postMessage({
      command: target.dataset.command,
      value: target.dataset.value,
    });
  });
</script>
</body>
</html>`;
}

export function panelIcon(
  extensionUri: vscode.Uri | undefined,
  name: string,
): { light: vscode.Uri; dark: vscode.Uri } | undefined {
  if (!extensionUri) return undefined;
  return {
    light: vscode.Uri.joinPath(extensionUri, "media", `${name}-light.svg`),
    dark: vscode.Uri.joinPath(extensionUri, "media", `${name}-dark.svg`),
  };
}

// --- Components -----------------------------------------------------------

/**
 * The metadata grid.
 *
 * Hairline-separated cells rather than a two-column list: the labels stay
 * scannable down the left of each cell, and a long value can take a whole row
 * without dragging every other field out of alignment.
 */
export function spec(fields: readonly SpecField[]): string {
  const cells = fields
    .map(
      (field) => `<div class="spec-cell${field.wide ? " spec-cell--wide" : ""}">
<dt class="spec-label">${escapeHtml(field.label)}</dt>
<dd class="spec-value${field.mono ? " spec-value--mono" : ""}">${escapeHtml(field.value)}</dd>
</div>`,
    )
    .join("");
  return `<dl class="spec">${cells}</dl>`;
}

export function section(title: string, content: string, options: { count?: number } = {}): string {
  const count = typeof options.count === "number" ? `<span class="section-count">${options.count}</span>` : "";
  return `<section class="section">
<div class="section-head"><h2 class="section-title">${escapeHtml(title)}</h2>${count}</div>
${content}
</section>`;
}

export function disclosure(title: string, content: string): string {
  return `<details class="disclosure">
<summary class="disclosure-summary">${escapeHtml(title)}</summary>
<div class="disclosure-content">${content}</div>
</details>`;
}

/** A boxed aside for the one thing the reader has to act on. */
export function callout(tone: Exclude<Tone, "neutral">, label: string, text: string): string {
  const mark = tone === "bad" || tone === "warn" ? "issue" : "info";
  return `<aside class="callout callout--${tone}">
<span class="callout-icon">${glyph(mark)}</span>
<span class="callout-text"><strong class="callout-label">${escapeHtml(label)}</strong>${escapeHtml(text)}</span>
</aside>`;
}

export function empty(text: string): string {
  return `<p class="empty">${escapeHtml(text)}</p>`;
}

/** The full-panel version, for when there is nothing to show at all. */
export function blankSlate(text: string): string {
  return `<div class="shell"><div class="blank"><span class="blank-mark">${glyph(
    "info",
  )}</span><p class="empty">${escapeHtml(text)}</p></div></div>`;
}

// --- Glyphs ---------------------------------------------------------------

export type GlyphName = KnowledgeTypeName | "proposal" | "info";

/**
 * One mark per kind of record, drawn rather than iconised: codicons are a font
 * the extension cannot load inside a webview under this CSP.
 */
const GLYPH_PATHS: Record<GlyphName, string> = {
  rule: `<path d="M8 1.7 13.6 3.9v4.3c0 3.1-2.3 5.2-5.6 6.1-3.3-.9-5.6-3-5.6-6.1V3.9z"/><path d="M5.7 8 7.4 9.7 10.6 6.3"/>`,
  decision: `<path d="M8 13.8V9.1l4.3-4.3M8 9.1 3.7 4.8"/><circle cx="3.1" cy="3.4" r="1.6"/><circle cx="12.9" cy="3.4" r="1.6"/>`,
  architecture: `<rect x="5.4" y="1.6" width="5.2" height="4" rx="1.1"/><rect x="1.3" y="10.4" width="5.2" height="4" rx="1.1"/><rect x="9.5" y="10.4" width="5.2" height="4" rx="1.1"/><path d="M8 5.6v2.6M3.9 10.4V8.2h8.2v2.2"/>`,
  domain: `<path d="M2.4 2.5h4.3A1.3 1.3 0 0 1 8 3.8v9.7a1.3 1.3 0 0 0-1.3-1.3H2.4z"/><path d="M13.6 2.5H9.3A1.3 1.3 0 0 0 8 3.8v9.7a1.3 1.3 0 0 1 1.3-1.3h4.3z"/>`,
  convention: `<rect x="1.4" y="4.8" width="13.2" height="6.4" rx="1.2"/><path d="M4.6 4.8v2.3M7.2 4.8v1.3M9.8 4.8v2.3M12.4 4.8v1.3"/>`,
  context: `<path d="M1.4 8h3.1l1.7-4.2 2.5 8.4 1.8-4.2h3.1"/>`,
  issue: `<path d="M8 2.4 14.5 13.5H1.5z"/><path d="M8 6.3v3.3"/><circle cx="8" cy="11.5" r="0.75"/>`,
  proposal: `<path d="M4.6 2.3h4.9l3.3 3.3v8.1H4.6z"/><path d="M9.4 2.3v3.4h3.4"/><path d="M6.6 9.1h3.6M6.6 11.3h2.3"/>`,
  info: `<circle cx="8" cy="8" r="6.2"/><path d="M8 7.3v3.9"/><circle cx="8" cy="5.1" r="0.3"/>`,
};

export function glyph(name: GlyphName): string {
  return `<svg class="glyph" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${GLYPH_PATHS[name]}</svg>`;
}

// --- Styles ---------------------------------------------------------------

function styles(): string {
  return [tokens(), base(), layout(), typographyScale(), components(), prose(), preferences()].join("\n");
}

/**
 * The token layer.
 *
 * Surfaces and hairlines are mixed from the theme's own foreground and
 * background rather than hard-coded translucent greys, so contrast holds up in
 * a near-black theme and a paper-white one alike.
 */
function tokens(): string {
  return `
  :root {
    color-scheme: light dark;

    --chr-bg: var(--vscode-editor-background);
    --chr-fg: var(--vscode-foreground);
    --chr-muted: var(--vscode-descriptionForeground);
    --chr-accent: var(--vscode-textLink-foreground);

    --chr-good: var(--vscode-charts-green, #3fb950);
    --chr-warn: var(--vscode-charts-orange, #d29922);
    --chr-bad: var(--vscode-charts-red, #f85149);

    --chr-line: color-mix(in srgb, var(--chr-fg) 17%, transparent);
    --chr-hairline: color-mix(in srgb, var(--chr-fg) 9%, transparent);
    --chr-surface: color-mix(in srgb, var(--chr-fg) 3%, var(--chr-bg));
    --chr-raised: color-mix(in srgb, var(--chr-fg) 7%, var(--chr-bg));

    --chr-1: 4px;
    --chr-2: 8px;
    --chr-3: 12px;
    --chr-4: 16px;
    --chr-5: 24px;
    --chr-6: 32px;
    --chr-7: 48px;

    --chr-r-sm: 4px;
    --chr-r-md: 6px;
    --chr-r-lg: 4px;
    --chr-r-pill: 999px;

    --chr-gutter: 24px;
    --chr-measure: 58rem;

    --chr-mono: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, monospace);
  }`;
}

function base(): string {
  return `
  *, *::before, *::after { box-sizing: border-box; }

  html { scrollbar-gutter: stable; }

  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.55;
    color: var(--chr-fg);
    background: var(--chr-bg);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  :focus-visible {
    outline: 2px solid var(--vscode-focusBorder, var(--chr-accent));
    outline-offset: 2px;
    border-radius: var(--chr-r-sm);
  }

  a { color: var(--chr-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  code, kbd, pre, .mono { font-family: var(--chr-mono); font-variant-ligatures: none; }

  .glyph { flex: none; display: block; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }`;
}

/**
 * The shell.
 *
 * One centred measure keeps a panel opened beside an editor and a maximised
 * panel equally readable. Both the header and action row stay in normal
 * document flow, so they never cover the record being read.
 */
function layout(): string {
  return `
  .shell {
    max-width: var(--chr-measure);
    min-height: 100vh;
    margin: 0 auto;
    padding: 0 var(--chr-gutter);
    display: flex;
    flex-direction: column;
  }

  .masthead {
    padding: var(--chr-5) 0 var(--chr-4);
  }

  .content { flex: 1 1 auto; padding: 0 0 var(--chr-5); }

  .actionbar {
    margin: 0 calc(-1 * var(--chr-gutter));
    padding: var(--chr-3) var(--chr-gutter);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--chr-2);
    border-top: 1px solid var(--chr-line);
    background: var(--chr-bg);
  }
  .actionbar-note { margin-left: auto; color: var(--chr-muted); font-size: 11.5px; }

  .blank {
    min-height: 60vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--chr-3);
    text-align: center;
  }
  .blank-mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--chr-r-pill);
    border: 1px solid var(--chr-hairline);
    background: var(--chr-surface);
    color: var(--chr-muted);
  }`;
}

/**
 * The type scale.
 *
 * A compact type scale that follows the host editor rather than presenting a
 * separate editorial hierarchy.
 */
function typographyScale(): string {
  return `
  .eyebrow {
    display: flex;
    align-items: center;
    gap: var(--chr-2);
    margin: 0 0 var(--chr-2);
    color: var(--chr-muted);
    font-size: 12px;
    line-height: 1.4;
    min-width: 0;
  }
  .eyebrow-mark {
    display: block;
    color: var(--chr-accent);
  }
  .eyebrow-kind {
    font-weight: 600;
    color: var(--chr-fg);
  }
  .eyebrow-sep { opacity: 0.4; }
  .eyebrow-id {
    font-family: var(--chr-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    line-height: 1.3;
  }

  .section { margin: var(--chr-5) 0 0; }
  .section:first-child { margin-top: var(--chr-5); }
  .section-head {
    display: flex;
    align-items: center;
    gap: var(--chr-2);
    margin: 0 0 var(--chr-2);
  }
  .section-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--chr-fg);
  }
  .section-count {
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--chr-muted);
    padding: 0;
    line-height: inherit;
  }
  .empty, .reason { margin: 0; color: var(--chr-muted); font-size: 12.5px; }

  .disclosure { margin: var(--chr-5) 0 0; }
  .disclosure-summary {
    width: max-content;
    color: var(--chr-muted);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .disclosure-summary:hover { color: var(--chr-fg); }
  .disclosure-content { margin-top: var(--chr-2); }`;
}

function components(): string {
  return `
  /*
   * Metadata is a flat definition grid. Dividers provide enough structure
   * without making every value look like a separate card.
   */
  .spec {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--chr-5);
    border-top: 1px solid var(--chr-hairline);
  }
  .spec-cell {
    min-width: 0;
    padding: 8px 0 9px;
    border-bottom: 1px solid var(--chr-hairline);
  }
  .spec-cell--wide { grid-column: 1 / -1; }
  .spec-label {
    margin: 0 0 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--chr-muted);
  }
  .spec-value {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.45;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .spec-value--mono { font-family: var(--chr-mono); font-size: 11.5px; }

  .callout {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: var(--chr-4) 0 0;
    padding: 11px 14px;
    border-left: 3px solid var(--chr-tone);
    border-radius: var(--chr-r-sm);
    background: color-mix(in srgb, var(--chr-tone) 9%, var(--chr-bg));
    font-size: 12.5px;
  }
  .callout--good { --chr-tone: var(--chr-good); }
  .callout--warn { --chr-tone: var(--chr-warn); }
  .callout--bad { --chr-tone: var(--chr-bad); }
  .callout--accent { --chr-tone: var(--chr-accent); }
  .callout-icon { color: var(--chr-tone); margin-top: 2px; }
  .callout-text { min-width: 0; }
  .callout-label { display: block; margin-bottom: 1px; font-weight: 600; }

  .records { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--chr-hairline); }
  .record {
    display: grid;
    grid-template-columns: 4.6rem 1fr;
    gap: 12px;
    padding: 9px 2px 10px;
    border-bottom: 1px solid var(--chr-hairline);
  }
  .record-main { min-width: 0; }
  .record-title { display: block; font-size: 12.5px; overflow-wrap: anywhere; }
  .record-note {
    display: block;
    margin-top: 2px;
    color: var(--chr-muted);
    font-family: var(--chr-mono);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
  .verdict {
    font-size: 10.5px;
    font-weight: 600;
    line-height: 1.9;
  }
  .verdict--pass { color: var(--chr-good); }
  .verdict--fail { color: var(--chr-bad); }
  .verdict--unknown { color: var(--chr-muted); }

  .diff {
    border: 1px solid var(--chr-hairline);
    border-radius: var(--chr-r-lg);
    overflow: hidden;
    background: var(--chr-surface);
  }
  .diff-head {
    display: flex;
    align-items: center;
    gap: var(--chr-2);
    padding: 8px 12px;
    background: var(--chr-raised);
    border-bottom: 1px solid var(--chr-hairline);
  }
  .diff-scope {
    font-size: 11px;
    font-weight: 600;
    color: var(--chr-muted);
  }
  .diff-stat {
    margin-left: auto;
    display: flex;
    gap: 8px;
    font-family: var(--chr-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .diff-stat .added { color: var(--chr-good); }
  .diff-stat .removed { color: var(--chr-bad); }
  .diff-body { font-family: var(--chr-mono); font-size: 11.5px; line-height: 1.7; }
  .dline { display: grid; grid-template-columns: 26px 1fr; }
  .dline-mark {
    text-align: center;
    color: var(--chr-muted);
    user-select: none;
    border-right: 1px solid var(--chr-hairline);
  }
  .dline-text { padding: 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .dline--added { background: color-mix(in srgb, var(--chr-good) 13%, transparent); }
  .dline--added .dline-mark { color: var(--chr-good); background: color-mix(in srgb, var(--chr-good) 8%, transparent); }
  .dline--removed { background: color-mix(in srgb, var(--chr-bad) 13%, transparent); }
  .dline--removed .dline-mark { color: var(--chr-bad); background: color-mix(in srgb, var(--chr-bad) 8%, transparent); }
  .dline--changed .dline-mark { color: var(--chr-accent); }

  .btn {
    appearance: none;
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    padding: 6px 14px;
    border-radius: 2px;
    border: 1px solid var(--chr-line);
    background: var(--vscode-button-secondaryBackground, var(--chr-raised));
    color: var(--vscode-button-secondaryForeground, var(--chr-fg));
    cursor: pointer;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--chr-line)); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn:disabled:hover { background: var(--vscode-button-secondaryBackground, var(--chr-raised)); }
  .btn--primary {
    border-color: transparent;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn--primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn--quiet { background: transparent; border-color: var(--chr-hairline); color: var(--chr-muted); }
  .btn--quiet:hover { background: var(--chr-surface); color: var(--chr-fg); }

  .review-actions {
    margin-top: var(--chr-3);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--chr-2);
  }
  .review-actions-note { flex-basis: 100%; color: var(--chr-muted); font-size: 11.5px; }

  .setup-shell { --chr-measure: 64rem; }
  .setup-hero {
    padding-top: var(--chr-7);
    border-bottom: 1px solid var(--chr-hairline);
  }
  .setup-title { max-width: 42rem; font-size: 24px; }
  .setup-lede {
    max-width: 44rem;
    margin: var(--chr-3) 0 0;
    color: var(--chr-muted);
    font-size: 13.5px;
  }
  .setup-steps {
    margin: var(--chr-5) 0 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--chr-3);
  }
  .setup-step {
    min-width: 0;
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: var(--chr-3);
    padding: var(--chr-4);
    border: 1px solid var(--chr-hairline);
    border-radius: var(--chr-r-md);
    background: var(--chr-surface);
  }
  .setup-step-number {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--chr-r-pill);
    background: var(--chr-raised);
    color: var(--chr-muted);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .setup-step-main { min-width: 0; }
  .setup-step-title { margin: 3px 0 var(--chr-2); font-size: 13px; font-weight: 600; }
  .setup-step-text { margin: 0 0 var(--chr-3); color: var(--chr-muted); font-size: 12.5px; }
  .setup-inline-actions { margin-top: var(--chr-3); }
  .setup-code {
    margin: var(--chr-3) 0 0;
    padding: var(--chr-3);
    border: 1px solid var(--chr-hairline);
    border-radius: var(--chr-r-md);
    background: var(--vscode-textCodeBlock-background, var(--chr-surface));
    color: var(--chr-fg);
    overflow: auto;
    font-size: 11.5px;
    line-height: 1.55;
  }
  .setup-code code { padding: 0; background: transparent; }
  .setup-list { margin: 0; padding-left: 1.25rem; color: var(--chr-muted); }
  .setup-list li { margin: 0 0 var(--chr-2); }
  @media (max-width: 720px) {
    .setup-steps { grid-template-columns: 1fr; }
    .setup-title { font-size: 20px; }
  }`;
}

/** Rendered Markdown bodies. Written by hand, so they get real editorial type. */
function prose(): string {
  return `
  .prose { font-size: 13px; line-height: 1.62; }
  .prose > :first-child { margin-top: 0; }
  .prose > :last-child { margin-bottom: 0; }
  .prose p { margin: 0 0 var(--chr-3); }
  .prose h1, .prose h2, .prose h3, .prose h4 {
    margin: var(--chr-5) 0 var(--chr-2);
    font-weight: 600;
    line-height: 1.3;
  }
  .prose h1 { font-size: 16px; }
  .prose h2 { font-size: 14.5px; }
  .prose h3, .prose h4 { font-size: 13px; }
  .prose ul, .prose ol { margin: 0 0 var(--chr-3); padding-left: 1.35rem; }
  .prose li { margin: 3px 0; }
  .prose li > ul, .prose li > ol { margin-bottom: 0; }
  .prose li::marker { color: var(--chr-muted); }
  .prose strong { font-weight: 600; }
  .prose code {
    padding: 1.5px 5px;
    border-radius: var(--chr-r-sm);
    background: var(--vscode-textCodeBlock-background, var(--chr-raised));
    font-size: 0.92em;
  }
  .prose pre {
    margin: 0 0 var(--chr-3);
    padding: 11px 14px;
    border: 1px solid var(--chr-hairline);
    border-radius: var(--chr-r-md);
    background: var(--vscode-textCodeBlock-background, var(--chr-surface));
    overflow-x: auto;
    line-height: 1.55;
  }
  .prose pre code { padding: 0; background: none; }
  .prose blockquote {
    margin: 0 0 var(--chr-3);
    padding: 2px 0 2px var(--chr-3);
    border-left: 2px solid var(--chr-line);
    color: var(--chr-muted);
  }
  .prose table {
    width: 100%;
    margin: 0 0 var(--chr-3);
    border-collapse: collapse;
    font-size: 12.5px;
  }
  .prose th, .prose td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--chr-hairline); }
  .prose th {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--chr-muted);
  }
  .prose hr { margin: var(--chr-5) 0; border: none; border-top: 1px solid var(--chr-hairline); }`;
}

/** Honour the reader's system preferences rather than insisting on the effect. */
function preferences(): string {
  return `
  @media (max-width: 520px) {
    :root { --chr-gutter: 16px; }
    .spec { grid-template-columns: minmax(0, 1fr); }
    .spec-cell--wide { grid-column: auto; }
    .actionbar-note { flex-basis: 100%; margin-left: 0; }
  }

  @media (prefers-contrast: more) {
    :root {
      --chr-line: color-mix(in srgb, var(--chr-fg) 45%, transparent);
      --chr-hairline: color-mix(in srgb, var(--chr-fg) 30%, transparent);
      --chr-muted: var(--chr-fg);
    }
  }

  @media print {
    .actionbar { background: none; }
    .btn { display: none; }
  }`;
}
