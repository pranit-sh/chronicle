import { randomBytes } from "node:crypto";

import * as vscode from "vscode";

import { escapeHtml } from "../present.js";

/**
 * Shared shell for the extension's webviews.
 *
 * Everything is styled from VS Code's own theme variables so the panels look
 * like part of the editor rather than a website embedded in one.
 */

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

function styles(): string {
  return `
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 20px 24px 48px;
    margin: 0;
    line-height: 1.55;
  }
  h1 { font-size: 1.35rem; margin: 0 0 4px; font-weight: 600; line-height: 1.3; }
  h2 { font-size: 0.95rem; margin: 26px 0 8px; font-weight: 600; }
  p { margin: 0 0 12px; }
  a { color: var(--vscode-textLink-foreground); }
  code, pre { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .subtitle { color: var(--vscode-descriptionForeground); margin: 0 0 18px; font-size: 0.85rem; }

  .badges { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
  .badge {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--vscode-widget-border, transparent);
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .badge.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-foreground); }
  .badge.bad { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-foreground); }
  .badge.good { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }

  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 18px; margin: 0 0 8px; }
  .facts dt { color: var(--vscode-descriptionForeground); font-size: 0.85rem; }
  .facts dd { margin: 0; font-size: 0.85rem; }

  .body { border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); padding-top: 14px; margin-top: 18px; }
  .body > :first-child { margin-top: 0; }
  .body ul, .body ol { margin: 0 0 12px; padding-left: 22px; }
  .body li { margin: 2px 0; }
  .body li > ul, .body li > ol { margin-bottom: 0; }
  .body code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .body pre code { background: none; padding: 0; }
  .body blockquote {
    margin: 0 0 12px;
    padding: 2px 0 2px 14px;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-focusBorder));
    color: var(--vscode-descriptionForeground);
  }
  .body table { border-collapse: collapse; margin: 0 0 12px; font-size: 0.9em; }
  .body th, .body td {
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    padding: 4px 10px;
    text-align: left;
  }
  .body th { background: var(--vscode-editorWidget-background); font-weight: 600; }
  .body hr { border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); margin: 18px 0; }

  .evidence { list-style: none; padding: 0; margin: 0; }
  .evidence li {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    font-size: 0.85rem;
  }
  .evidence .result { min-width: 62px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .pass { color: var(--vscode-testing-iconPassed); }
  .fail { color: var(--vscode-testing-iconFailed); }
  .unknown { color: var(--vscode-descriptionForeground); }

  .diff { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25)); border-radius: 5px; overflow: hidden; margin: 0 0 18px; }
  .diff .field {
    padding: 6px 12px;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.25));
  }
  .diff .line { padding: 4px 12px; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: 0.85em; }
  .diff .removed { background: var(--vscode-diffEditor-removedTextBackground, rgba(255,0,0,0.12)); }
  .diff .added { background: var(--vscode-diffEditor-insertedTextBackground, rgba(0,255,0,0.12)); }

  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 22px 0 0; }
  button {
    font-family: inherit;
    font-size: 0.85rem;
    padding: 6px 14px;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }

  .callout {
    border-left: 3px solid var(--vscode-inputValidation-warningBorder, var(--vscode-focusBorder));
    background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
    padding: 10px 14px;
    border-radius: 0 4px 4px 0;
    margin: 0 0 18px;
    font-size: 0.85rem;
  }
  .empty { color: var(--vscode-descriptionForeground); font-size: 0.85rem; font-style: italic; }
  `;
}
