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
      "Agent Setup",
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
    this.#panel.webview.html = pageHtml(this.#panel.webview, "Agent Setup", setupBody());
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
  <p class="eyebrow"><span class="eyebrow-mark">${glyph("info")}</span><span class="eyebrow-kind">Chronicle Agent Setup</span></p>
  <h1 class="title setup-title">Connect your coding agents to reviewed project knowledge.</h1>
  <p class="setup-lede">Chronicle has two parts: this extension for people, and an MCP server for agents. Pick the agent you use, then Chronicle will write the right project config.</p>
</header>

<main class="content">
  <section class="setup-steps" aria-label="Agent setup actions">
    ${setupStep("1", "Initialize the repository", `Run Chronicle setup so this repo has ${CHRONICLE_DIR}/config.yaml. Commit ${CHRONICLE_DIR}/ so knowledge follows branches and reviews like code.`, "initialize", "Initialize Chronicle")}
    ${setupStep("2", "Copilot", "Creates or updates .vscode/mcp.json so Copilot can start the Chronicle MCP server.", "configureCopilot", "Configure Copilot")}
    ${setupStep("3", "Cursor", "Creates or updates .cursor/mcp.json for this workspace.", "configureCursor", "Configure Cursor")}
    ${setupStep("4", "Claude Code", "Creates or updates .mcp.json at the project root. Start Claude Code here and approve the project MCP server when prompted.", "configureClaudeCode", "Configure Claude Code")}
    ${setupStep("5", "Agent instructions", "Optionally add Chronicle guidance to CLAUDE.md, .github/copilot-instructions.md or a Cursor project rule so agents know when to use the MCP tools.", "addAgentInstructions", "Add instructions")}
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
    <div class="section-head"><h2 class="section-title">What agents get</h2></div>
    <ul class="setup-list">
      <li><code>context_resolve</code> returns the relevant rules, decisions, conventions and known issues for a file or task.</li>
      <li><code>knowledge_search</code> and <code>knowledge_get</code> let the agent check what has already been decided.</li>
      <li><code>knowledge_propose</code> stages new knowledge for your review; it does not directly change accepted knowledge.</li>
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