import type { KnowledgeItem, KnowledgeStatusName, KnowledgeTypeName } from "@chronicle/core";
import * as vscode from "vscode";

import { itemIcon, itemTooltip, relativeTime, statusLabel, typeLabel } from "../present.js";
import type { ChronicleSession } from "../session.js";

/**
 * The knowledge tree groups reviewed project knowledge by type, status or scope.
 */

type Node =
  | { kind: "message"; label: string; detail?: string; icon: string }
  | { kind: "group"; label: string; key: string; items: KnowledgeItem[] }
  | { kind: "item"; item: KnowledgeItem };

export type KnowledgeFilter = "all" | KnowledgeStatusName | "needsAttention";

const TYPE_ORDER: KnowledgeTypeName[] = [
  "rule",
  "decision",
  "architecture",
  "domain",
  "convention",
  "context",
  "issue",
];

export class KnowledgeTree implements vscode.TreeDataProvider<Node> {
  readonly onDidChangeTreeData: vscode.Event<void>;

  #filter: KnowledgeFilter = "all";
  #search = "";
  readonly #emitter = new vscode.EventEmitter<void>();

  constructor(private readonly session: ChronicleSession) {
    this.onDidChangeTreeData = this.#emitter.event;
    session.onDidChange(() => this.#emitter.fire());
  }

  get filter(): KnowledgeFilter {
    return this.#filter;
  }

  setFilter(filter: KnowledgeFilter): void {
    this.#filter = filter;
    this.#emitter.fire();
  }

  setSearch(query: string): void {
    this.#search = query.trim().toLowerCase();
    this.#emitter.fire();
  }

  refresh(): void {
    this.#emitter.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case "message": {
        const row = new vscode.TreeItem(node.label);
        row.iconPath = new vscode.ThemeIcon(node.icon);
        row.description = node.detail;
        row.tooltip = node.detail;
        return row;
      }
      case "group": {
        const row = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
        row.description = String(node.items.length);
        row.contextValue = "group";
        row.id = `group:${node.key}`;
        return row;
      }
      case "item":
        return this.#itemRow(node.item);
    }
  }

  getChildren(node?: Node): Node[] {
    if (!this.session.folder) return [];

    if (!node) {
      if (this.session.loadError) {
        return [
          {
            kind: "message",
            label: "Chronicle could not read this knowledge layer",
            detail: this.session.loadError,
            icon: "error",
          },
        ];
      }
      if (!this.session.initialized) return [];

      const items = this.#visible();
      if (items.length === 0) {
        const isFiltered = Boolean(this.#search || this.#filter !== "all");
        if (!isFiltered && !this.session.store?.stats().archived) return [];

        return [
          {
            kind: "message",
            label: isFiltered ? "Nothing matches" : "No visible knowledge",
            detail:
              isFiltered
                ? "Clear the filter to see everything"
                : "Archived items are hidden by default",
            icon: "info",
          },
        ];
      }
      return this.#groups(items);
    }

    return node.kind === "group" ? node.items.map((item) => ({ kind: "item", item })) : [];
  }

  #visible(): KnowledgeItem[] {
    const store = this.session.store;
    if (!store) return [];

    const includeArchived = this.#filter === "archived" || this.#filter === "all";
    let items = store.list({ includeArchived });

    if (this.#filter === "needsAttention") {
      items = items.filter((item) => item.status === "stale" || this.#isExpired(item));
    } else if (this.#filter !== "all") {
      items = items.filter((item) => item.status === this.#filter);
    } else {
      items = items.filter((item) => item.status !== "archived");
    }

    if (this.#search) {
      const needle = this.#search;
      items = items.filter((item) =>
        `${item.title} ${item.body} ${item.tags.join(" ")} ${item.scopes.join(" ")}`
          .toLowerCase()
          .includes(needle),
      );
    }
    return items;
  }

  #isExpired(item: KnowledgeItem): boolean {
    return Boolean(item.expiresAt && Date.parse(item.expiresAt) < Date.now());
  }

  #groups(items: readonly KnowledgeItem[]): Node[] {
    const groupBy = vscode.workspace.getConfiguration("chronicle").get<string>("groupBy") ?? "type";

    if (groupBy === "status") {
      const statuses: KnowledgeStatusName[] = ["stale", "active", "confirmed", "proposed", "archived"];
      return statuses
        .map((status) => ({
          kind: "group" as const,
          key: status,
          label: statusLabel(status),
          items: items.filter((item) => item.status === status),
        }))
        .filter((group) => group.items.length > 0);
    }

    if (groupBy === "scope") {
      const byScope = new Map<string, KnowledgeItem[]>();
      for (const item of items) {
        for (const scope of item.scopes.length ? item.scopes : ["project"]) {
          byScope.set(scope, [...(byScope.get(scope) ?? []), item]);
        }
      }
      return [...byScope.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([scope, scoped]) => ({ kind: "group" as const, key: scope, label: scope, items: scoped }));
    }

    return TYPE_ORDER.map((type) => ({
      kind: "group" as const,
      key: type,
      label: typeLabel(type),
      items: items.filter((item) => item.type === type),
    })).filter((group) => group.items.length > 0);
  }

  #filterDescription(): string {
    const bits: string[] = [];
    if (this.#filter !== "all") {
      bits.push(this.#filter === "needsAttention" ? "needs attention" : statusLabel(this.#filter).toLowerCase());
    }
    if (this.#search) bits.push(`"${this.#search}"`);
    return bits.join(" · ");
  }

  #itemRow(item: KnowledgeItem): vscode.TreeItem {
    const row = new vscode.TreeItem(item.title);
    row.id = item.id;
    row.iconPath = itemIcon(item);
    row.tooltip = itemTooltip(item);
    row.contextValue = item.status === "archived" ? "item.archived" : "item";
    row.command = {
      command: "chronicle.showItem",
      title: "Show knowledge item",
      arguments: [item.id],
    };

    const notes: string[] = [];
    if (item.status === "stale") notes.push("stale");
    if (this.#isExpired(item)) notes.push("expired");
    if (item.pinned) notes.push("pinned");
    if (item.source === "ai") notes.push("from an agent");
    if (notes.length === 0) notes.push(relativeTime(item.updatedAt));
    row.description = notes.join(" · ");

    return row;
  }
}
