import {
  type ContextPackage,
  type DroppedEntry,
  type ResolvedEntry,
  resolveContextForStore,
} from "@codicil/core";
import * as vscode from "vscode";

import { itemIcon } from "../present.js";
import type { CodicilSession } from "../session.js";

/**
 * What an agent would actually be told about the file in front of you.
 *
 * This is the transparency view: not everything Codicil knows, but the exact
 * package the resolver would hand over right now, in the order it would appear,
 * including what got dropped for the budget.
 */

type Node =
  | { kind: "header"; pkg: ContextPackage }
  | { kind: "entry"; entry: ResolvedEntry; rank: number }
  | { kind: "droppedGroup"; dropped: DroppedEntry[] }
  | { kind: "dropped"; dropped: DroppedEntry };

export class ContextTree implements vscode.TreeDataProvider<Node> {
  readonly onDidChangeTreeData: vscode.Event<void>;
  readonly #emitter = new vscode.EventEmitter<void>();
  #task = "";

  constructor(private readonly session: CodicilSession) {
    this.onDidChangeTreeData = this.#emitter.event;
    session.onDidChange(() => this.#emitter.fire());
    vscode.window.onDidChangeActiveTextEditor(() => this.#emitter.fire());
  }

  setTask(task: string): void {
    this.#task = task.trim();
    this.#emitter.fire();
  }

  refresh(): void {
    this.#emitter.fire();
  }

  /** The package for the active editor, or undefined when there is nothing to resolve. */
  resolve(): ContextPackage | undefined {
    const store = this.session.store;
    if (!store) return undefined;

    const editor = vscode.window.activeTextEditor;
    const file = editor?.document.uri.scheme === "file" ? editor.document.uri.fsPath : undefined;
    const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;

    return resolveContextForStore(store, {
      ...(file ? { file } : {}),
      ...(this.#task ? { task: this.#task } : {}),
      ...(selection ? { selection: selection.slice(0, 2000) } : {}),
      openFiles: vscode.workspace.textDocuments
        .filter((document) => document.uri.scheme === "file")
        .map((document) => document.uri.fsPath)
        .slice(0, 20),
    });
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "header": {
        const { trace, stats } = node.pkg;
        const row = new vscode.TreeItem(trace.file ?? "Whole project");
        row.iconPath = new vscode.ThemeIcon("eye");
        row.description = `${stats.itemCount} items · ${stats.totalChars} chars`;
        row.contextValue = "contextHeader";
        row.command = { command: "codicil.showContext", title: "Open the full package" };
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`Scopes: \`${trace.activeScopes.join(" > ")}\`\n\n`);
        if (trace.task) tooltip.appendMarkdown(`Task: ${trace.task}\n\n`);
        tooltip.appendMarkdown(
          `${trace.consideredCount} items considered, ${trace.candidateCount} were relevant, ${stats.itemCount} fit the budget of ${stats.budget.maxItems} items and ${stats.budget.maxChars} characters.`,
        );
        row.tooltip = tooltip;
        return row;
      }
      case "entry": {
        const row = new vscode.TreeItem(node.entry.item.title);
        row.id = `context:${node.entry.item.id}`;
        row.iconPath = itemIcon(node.entry.item);
        row.description = `#${node.rank}`;
        row.command = {
          command: "codicil.showItem",
          title: "Show knowledge item",
          arguments: [node.entry.item.id],
        };
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`Included because:\n\n`);
        for (const reason of node.entry.reasons) tooltip.appendMarkdown(`- ${reason}\n`);
        tooltip.appendMarkdown(`\nScore ${node.entry.score.toFixed(2)}.`);
        row.tooltip = tooltip;
        return row;
      }
      case "droppedGroup": {
        const row = new vscode.TreeItem("Left out", vscode.TreeItemCollapsibleState.Collapsed);
        row.iconPath = new vscode.ThemeIcon("eye-closed");
        row.description = String(node.dropped.length);
        return row;
      }
      case "dropped": {
        const row = new vscode.TreeItem(node.dropped.title);
        row.iconPath = new vscode.ThemeIcon("circle-outline");
        row.description = node.dropped.reason;
        row.tooltip = node.dropped.reason;
        row.command = {
          command: "codicil.showItem",
          title: "Show knowledge item",
          arguments: [node.dropped.id],
        };
        return row;
      }
    }
  }

  getChildren(node?: Node): Node[] {
    if (node) {
      return node.kind === "droppedGroup"
        ? node.dropped.map((dropped) => ({ kind: "dropped" as const, dropped }))
        : [];
    }

    const pkg = this.resolve();
    if (!pkg) return [];

    if (pkg.entries.length === 0 && pkg.trace.dropped.length === 0) {
      return [];
    }

    const nodes: Node[] = [{ kind: "header", pkg }];
    pkg.entries.forEach((entry, index) => nodes.push({ kind: "entry", entry, rank: index + 1 }));
    if (pkg.trace.dropped.length) nodes.push({ kind: "droppedGroup", dropped: pkg.trace.dropped });
    return nodes;
  }
}
