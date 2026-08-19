import * as vscode from "vscode";

import { registerCommands } from "./commands/index.js";
import { ChronicleSession } from "./session.js";
import { ContextTree } from "./trees/context.js";
import { KnowledgeTree } from "./trees/knowledge.js";
import { ProposalTree } from "./trees/proposals.js";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new ChronicleSession();
  const knowledgeTree = new KnowledgeTree(session);
  const proposalTree = new ProposalTree(session);
  const contextTree = new ContextTree(session);
  const emptyTree: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (item) => item,
    getChildren: () => [],
  };

  context.subscriptions.push(
    session,
    vscode.window.createTreeView("chronicle.gettingStarted", {
      treeDataProvider: emptyTree,
    }),
    vscode.window.createTreeView("chronicle.agentSetup", {
      treeDataProvider: emptyTree,
    }),
    vscode.window.createTreeView("chronicle.knowledge", {
      treeDataProvider: knowledgeTree,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView("chronicle.proposals", { treeDataProvider: proposalTree }),
    vscode.window.createTreeView("chronicle.context", { treeDataProvider: contextTree }),
    ...registerCommands({ session, knowledgeTree, contextTree }),
    createStatusBar(session, contextTree),
  );

  await session.reload();
  await announcePending(session);
}

export function deactivate(): void {
  // Everything is registered through context.subscriptions.
}

/**
 * A quiet count of how much the agent is being told about the file in front of
 * you, so the context layer is visible without asking for it.
 */
function createStatusBar(session: ChronicleSession, contextTree: ContextTree): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.command = "chronicle.showContext";

  const update = () => {
    const enabled = vscode.workspace.getConfiguration("chronicle").get<boolean>("statusBar.enabled", true);
    if (!enabled || !session.initialized) {
      item.hide();
      return;
    }

    const pkg = contextTree.resolve();
    if (!pkg) {
      item.hide();
      return;
    }

    const stale = pkg.entries.filter((entry) => entry.item.status === "stale").length;
    const pending = session.proposals.length;

    item.text = `$(book) ${pkg.stats.itemCount}${stale ? ` $(warning) ${stale}` : ""}${
      pending ? ` $(git-pull-request) ${pending}` : ""
    }`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${pkg.stats.itemCount}** knowledge items apply here.`,
        stale ? `**${stale}** of them no longer match the code.` : "",
        pending ? `**${pending}** proposals are waiting for review.` : "",
        "",
        "Click to see exactly what an agent would be told.",
      ]
        .filter(Boolean)
        .join("  \n"),
    );
    item.backgroundColor = stale
      ? new vscode.ThemeColor("statusBarItem.warningBackground")
      : undefined;
    item.show();
  };

  const disposables = [
    item,
    session.onDidChange(update),
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("chronicle")) update();
    }),
  ];
  update();

  return vscode.Disposable.from(...disposables);
}

/** Proposals are only useful if someone knows they are there. */
async function announcePending(session: ChronicleSession): Promise<void> {
  const pending = session.proposals.length;
  if (pending === 0) return;

  const review = "Review";
  const choice = await vscode.window.showInformationMessage(
    pending === 1
      ? "An agent proposed something for your knowledge base."
      : `${pending} agent proposals are waiting for review.`,
    review,
  );
  if (choice === review) {
    await vscode.commands.executeCommand("chronicle.proposals.focus");
  }
}
