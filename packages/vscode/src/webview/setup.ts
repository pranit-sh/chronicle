import { CHRONICLE_DIR } from "@chronicle/core";
import * as vscode from "vscode";

import { escapeHtml } from "../present.js";
import type { ChronicleSession } from "../session.js";
import { glyph, pageHtml, panelIcon } from "./chrome.js";

export class AgentSetupPanel {
  static #current: AgentSetupPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  readonly #disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly session: ChronicleSession,
    extensionUri?: vscode.Uri,
  ) {
    this.#panel = vscode.window.createWebviewPanel(
      "chronicle.agentSetupGuide",
      "Chronicle Guide",
      { viewColumn: vscode.ViewColumn.Active },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.#panel.iconPath = panelIcon(extensionUri, "setup");

    this.#panel.onDidDispose(() => {
      AgentSetupPanel.#current = undefined;
      for (const disposable of this.#disposables) disposable.dispose();
    });

    this.#disposables.push(
      session.onDidChange(() => this.#render()),
      this.#panel.webview.onDidReceiveMessage((message: { command: string }) => this.#handle(message)),
    );
  }

  static show(session: ChronicleSession, extensionUri?: vscode.Uri): void {
    AgentSetupPanel.#current ??= new AgentSetupPanel(session, extensionUri);
    AgentSetupPanel.#current.#render();
    AgentSetupPanel.#current.#panel.reveal(vscode.ViewColumn.Active);
  }

  async #handle(message: { command: string }): Promise<void> {
    switch (message.command) {
      case "initialize":
        await vscode.commands.executeCommand("chronicle.init");
        break;
      case "configureCopilot":
        await vscode.commands.executeCommand("chronicle.configureMcp");
        break;
      case "configureCursor":
        await vscode.commands.executeCommand("chronicle.configureCursorMcp");
        break;
      case "configureClaudeCode":
        await vscode.commands.executeCommand("chronicle.configureClaudeCodeMcp");
        break;
      case "addAgentInstructions":
        await vscode.commands.executeCommand("chronicle.addAgentInstructions");
        break;
    }
  }

  #render(): void {
    this.#panel.webview.html = pageHtml(this.#panel.webview, "Chronicle Guide", setupBody());
  }
}

function setupBody(): string {
  const mcpSnippet = JSON.stringify(
    {
      servers: {
        chronicle: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@chronicle/mcp"],
          env: { CHRONICLE_ROOT: "${workspaceFolder}" },
        },
      },
    },
    null,
    2,
  );
  return `<div class="shell setup-shell">
<header class="masthead setup-hero">
  <p class="eyebrow"><span class="eyebrow-mark">${glyph("info")}</span><span class="eyebrow-kind">Chronicle Guide</span></p>
  <h1 class="title setup-title">Use reviewed project knowledge with your coding agents.</h1>
  <p class="setup-lede">Set up Chronicle, capture the rules and decisions your agents should know, and add verification checks when knowledge should stay tied to the code.</p>
</header>

<main class="content">
  <section class="section">
    <div class="section-head"><h2 class="section-title">Agent workflow</h2></div>
    <ul class="setup-list">
      <li>Connect your agent to Chronicle through MCP.</li>
      <li>Ask the agent to resolve the project context before it plans or edits.</li>
      <li>Let the agent search existing rules, decisions, conventions and known issues while it works.</li>
      <li>Ask the agent to propose new knowledge when it learns something that should persist.</li>
      <li>Review proposals in VS Code before they become accepted project knowledge.</li>
    </ul>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">Agent setup</h2></div>
  </section>

  <section class="setup-steps" aria-label="Agent setup actions">
    ${setupStep("1", "Initialize the repository", `Run Chronicle setup so this repo has ${CHRONICLE_DIR}/config.yaml. Commit ${CHRONICLE_DIR}/ so knowledge follows branches and reviews like code.`, "initialize", "Initialize Chronicle")}
    ${setupStep("2", "Copilot", "Creates or updates .vscode/mcp.json so Copilot can start the Chronicle MCP server.", "configureCopilot", "Configure Copilot")}
    ${setupStep("3", "Cursor", "Creates or updates .cursor/mcp.json for this workspace.", "configureCursor", "Configure Cursor")}
    ${setupStep("4", "Claude Code", "Creates or updates .mcp.json at the project root. Start Claude Code here and approve the project MCP server when prompted.", "configureClaudeCode", "Configure Claude Code")}
    ${setupStep("5", "Agent instructions", "Optionally add Chronicle guidance to CLAUDE.md, .github/copilot-instructions.md or a Cursor project rule so agents know when to use the MCP tools.", "addAgentInstructions", "Add instructions")}
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">What agents can do</h2></div>
    <ul class="setup-list">
      <li><code>context_resolve</code> returns the relevant rules, decisions, conventions and known issues for a file or task.</li>
      <li><code>knowledge_search</code> and <code>knowledge_get</code> let the agent check what has already been decided.</li>
      <li><code>knowledge_propose</code> stages new or updated knowledge for review.</li>
      <li>Accepted knowledge stays human-controlled; proposals wait in VS Code until you accept or reject them.</li>
    </ul>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">Verification checks</h2></div>
    <p class="empty">Checks live in the Markdown frontmatter under <code>evidence</code>. Agents can propose them, and Chronicle can verify files, globs, regex patterns and commits without calling an AI model.</p>
    <pre class="setup-code"><code>${escapeHtml(`evidence:
  - kind: file
    path: "src/server.ts"
    expect: present
  - kind: grep
    glob: "src/api/**/*.ts"
    pattern: "from ['\"]@/db"
    expect: absent`)}</code></pre>
    <ul class="setup-list">
      <li><code>expect: present</code> means the file, glob, pattern or commit must still exist.</li>
      <li><code>expect: absent</code> means the pattern must stay out of the matching files.</li>
      <li><code>minMatches</code> and <code>maxMatches</code> can bound how many matches are acceptable.</li>
      <li><code>note</code> adds a short human explanation in the Verification section.</li>
    </ul>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">MCP workspace file</h2></div>
    <p class="empty">Use this shape for workspace MCP configs.</p>
    <pre class="setup-code"><code>${escapeHtml(mcpSnippet)}</code></pre>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">Agent instruction files</h2></div>
    <p class="empty">The instructions option preserves existing content and adds a Chronicle block to <code>CLAUDE.md</code>, <code>.github/copilot-instructions.md</code> or <code>.cursor/rules/chronicle.mdc</code>.</p>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">Manual workflow</h2></div>
    <ul class="setup-list">
      <li>Use <code>Chronicle: Remember this</code> or <code>Chronicle: Remember the selected text</code> to add rules, decisions, conventions, context, issues and domain notes yourself.</li>
      <li>Open items from the Knowledge view to read details, edit the Markdown file or archive outdated knowledge.</li>
      <li>Use <code>Chronicle: What does the agent know here?</code> to inspect the exact context package for the active file.</li>
      <li>Run <code>Chronicle: Verify everything</code> after adding checks or before trusting older knowledge.</li>
    </ul>
  </section>

  <section class="section">
    <div class="section-head"><h2 class="section-title">Command palette</h2></div>
    <ul class="setup-list">
      <li><code>Chronicle: Remember this</code> captures new knowledge from a sentence.</li>
      <li><code>Chronicle: Remember the selected text</code> captures selected editor text.</li>
      <li><code>Chronicle: What does the agent know here?</code> opens the resolved context for the current file.</li>
      <li><code>Chronicle: Verify everything</code> re-checks configured verification checks.</li>
      <li><code>Chronicle: Check the knowledge layer for problems</code> finds broken files, merge conflicts and dangling references.</li>
      <li><code>Chronicle: Configure MCP for Copilot</code>, <code>Cursor</code> or <code>Claude Code</code> connects your agent to Chronicle.</li>
    </ul>
  </section>
</main>
</div>`;
}

function setupStep(number: string, title: string, text: string, command: string, label: string): string {
  const action = command ? `<button class="btn btn--primary" data-command="${command}">${escapeHtml(label)}</button>` : "";
  return `<article class="setup-step">
  <span class="setup-step-number">${escapeHtml(number)}</span>
  <div class="setup-step-main">
    <h2 class="setup-step-title">${escapeHtml(title)}</h2>
    <p class="setup-step-text">${escapeHtml(text)}</p>
    ${action}
  </div>
</article>`;
}