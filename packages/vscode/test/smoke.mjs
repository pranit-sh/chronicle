/**
 * Loads the built extension against a stub `vscode` module and drives it far
 * enough to prove the trees render and the commands are wired.
 *
 * The real integration harness needs a downloaded VS Code, which is not
 * something a plain `pnpm test` should do. This catches the failure that
 * actually happens in practice: the bundle not loading, or a view provider
 * throwing the first time it is asked for rows.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

// --- vscode stub ----------------------------------------------------------

const events = new Map();
const registered = new Map();
const shown = [];
const panels = [];

class EventEmitter {
  #listeners = [];
  event = (listener) => {
    this.#listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(value) {
    for (const listener of this.#listeners) listener(value);
  }
  dispose() {}
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class MarkdownString {
  constructor(value = "") {
    this.value = value;
  }
  appendMarkdown(text) {
    this.value += text;
    return this;
  }
}

const noopEvent = () => ({ dispose: () => {} });

let workspaceRoot;

const vscode = {
  EventEmitter,
  TreeItem,
  MarkdownString,
  ThemeIcon: class {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  },
  ThemeColor: class {
    constructor(id) {
      this.id = id;
    }
  },
  Uri: {
    file: (fsPath) => ({ fsPath, scheme: "file", toString: () => pathToFileURL(fsPath).href }),
    joinPath: (base, ...parts) => vscode.Uri.file(path.join(base.fsPath, ...parts)),
  },
  Disposable: { from: (...items) => ({ dispose: () => items.forEach((i) => i.dispose?.()) }) },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1, Beside: -2 },
  ProgressLocation: { Notification: 15 },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  commands: {
    registerCommand(name, handler) {
      registered.set(name, handler);
      return { dispose: () => registered.delete(name) };
    },
    executeCommand: async (name, ...args) => registered.get(name)?.(...args),
  },
  window: {
    activeTextEditor: undefined,
    createTreeView(id, options) {
      events.set(id, options.treeDataProvider);
      return { dispose: () => {} };
    },
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    createWebviewPanel: (viewType) => {
      const panel = {
        viewType,
        webview: { html: "", onDidReceiveMessage: noopEvent },
        onDidDispose: noopEvent,
        reveal() {},
        dispose() {},
        title: "",
      };
      panels.push(panel);
      return panel;
    },
    onDidChangeActiveTextEditor: noopEvent,
    showInformationMessage: async (message) => void shown.push(["info", message]),
    showWarningMessage: async (message) => void shown.push(["warn", message]),
    showErrorMessage: async (message) => void shown.push(["error", message]),
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showTextDocument: async () => ({}),
    withProgress: async (_options, task) => task(),
  },
  workspace: {
    get workspaceFolders() {
      return [{ uri: vscode.Uri.file(workspaceRoot), name: "test", index: 0 }];
    },
    textDocuments: [],
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    createFileSystemWatcher: () => ({
      onDidCreate: noopEvent,
      onDidChange: noopEvent,
      onDidDelete: noopEvent,
      dispose() {},
    }),
    onDidChangeWorkspaceFolders: noopEvent,
    onDidChangeConfiguration: noopEvent,
    openTextDocument: async (options) => options,
    fs: {
      stat: async (uri) => {
        const { stat } = await import("node:fs/promises");
        return stat(uri.fsPath);
      },
    },
  },
  extensions: { getExtension: () => undefined },
};

const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "vscode") return vscode;
  return originalLoad.call(this, request, parent, isMain);
};

// --- fixture --------------------------------------------------------------

workspaceRoot = await mkdtemp(path.join(tmpdir(), "codicil-vscode-"));
const core = require("../../core/dist/index.js");
const actor = { kind: "human", id: "tester" };
const store = await core.CodicilStore.init(workspaceRoot, actor);

await mkdir(path.join(workspaceRoot, "src/api"), { recursive: true });
await writeFile(path.join(workspaceRoot, "src/api/users.ts"), "export const list = () => [];\n");

await store.create(
  { type: "rule", title: "Never call the database directly from an API handler", scopes: ["project"] },
  actor,
);
const decision = await store.create(
  {
    type: "decision",
    title: "Postgres over MongoDB",
    status: "stale",
    body: [
      "## Decision",
      "",
      "We use **Postgres**, reached through `src/lib/repository.ts`.",
      "",
      "## Alternatives",
      "",
      "1. MongoDB, rejected for weak transactions",
      "2. SQLite, rejected because we need concurrent writers",
      "",
      "See [the ADR](https://example.com/adr-7).",
    ].join("\n"),
  },
  actor,
);
await store.create({ type: "convention", title: "Files are kebab-case" }, actor);
await core.proposeCreate(store, {
  draft: { type: "architecture", title: "Auth lives in src/auth" },
  proposedBy: { kind: "agent", id: "cursor" },
  reason: "Seen while reading the code",
});

// --- run ------------------------------------------------------------------

// Defaults to the freshly built bundle. Point it at an extracted .vsix to
// prove the shipped artifact runs without any node_modules beside it.
const bundle = process.env.CODICIL_EXTENSION_BUNDLE
  ? path.resolve(process.env.CODICIL_EXTENSION_BUNDLE)
  : "../dist/extension.cjs";
const extension = require(bundle);
const subscriptions = [];
await extension.activate({ subscriptions });

assert.ok(subscriptions.length > 0, "activate registered nothing");

for (const name of [
  "codicil.init",
  "codicil.remember",
  "codicil.refresh",
  "codicil.showItem",
  "codicil.verifyAll",
  "codicil.acceptProposal",
  "codicil.rejectProposal",
  "codicil.showContext",
  "codicil.doctor",
]) {
  assert.ok(registered.has(name), `command ${name} was not registered`);
}

const knowledge = events.get("codicil.knowledge");
const groups = knowledge.getChildren();
assert.ok(groups.length >= 2, "expected the knowledge to be grouped by type");
assert.ok(
  groups.every((group) => group.kind === "group"),
  "every root row should be a group",
);

const itemRows = [];
for (const group of groups) {
  const row = knowledge.getTreeItem(group);
  assert.ok(row.label, "a group row needs a label");
  assert.equal(row.description, String(group.items.length), "a group should count its items");
  for (const child of knowledge.getChildren(group)) {
    const childRow = knowledge.getTreeItem(child);
    assert.ok(childRow.label, "an item row needs a label");
    assert.equal(childRow.command.command, "codicil.showItem");
    itemRows.push(childRow);
  }
}

// A stale item has to be visible as such from the tree, without opening it.
const staleRow = itemRows.find((row) => row.label === "Postgres over MongoDB");
assert.ok(staleRow, "the stale decision is missing from the tree");
assert.match(staleRow.description, /stale/, "a stale item should say so on its row");

const proposals = events.get("codicil.proposals");
const pending = proposals.getChildren();
assert.equal(pending.length, 1, "expected one pending proposal");
const proposalRow = proposals.getTreeItem(pending[0]);
assert.match(proposalRow.label, /New architecture/, `unexpected proposal row: ${proposalRow.label}`);

const contextTree = events.get("codicil.context");
const contextRows = contextTree.getChildren();
assert.equal(contextRows[0].kind, "header", "the context view should lead with the package header");
for (const row of contextRows) contextTree.getTreeItem(row);

// Accepting has to move the proposal into the knowledge base.
await registered.get("codicil.acceptProposal")(pending[0].id);
assert.equal(proposals.getChildren().length, 0, "the accepted proposal should be gone");
assert.ok(
  knowledge
    .getChildren()
    .some((group) => group.items?.some((item) => item.title === "Auth lives in src/auth")),
  "the accepted proposal should now be knowledge",
);

// The detail panel is structured HTML over the frontmatter, with the body
// rendered as real Markdown.
await registered.get("codicil.showItem")(decision.id);
const detail = panels.find((panel) => panel.viewType === "codicil.detail");
assert.ok(detail, "showItem did not open a detail panel");
const html = detail.webview.html;

assert.match(html, /Postgres over MongoDB/, "the title is missing");
assert.match(html, /Needs attention/, "a stale item should say so");
assert.match(html, /no longer match the code/, "a stale item needs its callout");
assert.match(html, /Last verified/, "the facts grid is missing");
assert.match(html, /No checks configured/, "an item without evidence should say so");
assert.match(html, /data-command="verify"/, "the actions are missing");

assert.match(html, /<strong>Postgres<\/strong>/, "bold should render, not show asterisks");
assert.match(html, /<code>src\/lib\/repository\.ts<\/code>/, "inline code should render");
assert.match(html, /<ol>/, "a numbered list should render as an ordered list");
assert.match(html, /<h2>Alternatives<\/h2>/, "body headings should render");
assert.match(html, /href="https:\/\/example\.com\/adr-7"/, "links should render");
assert.doesNotMatch(html, /\*\*Postgres\*\*/, "raw Markdown leaked into the panel");

// Raw HTML in a body must never reach the panel: bodies arrive through merges
// and accepted agent proposals.
await store.update(decision.id, { body: 'Careful: <img src=x onerror="alert(1)">' }, actor);
await registered.get("codicil.refresh")();
await registered.get("codicil.showItem")(decision.id);
assert.doesNotMatch(detail.webview.html, /<img/, "raw HTML in a body was not escaped");

await registered.get("codicil.doctor")();
await registered.get("codicil.verifyAll")();

await rm(workspaceRoot, { recursive: true, force: true });
console.log("vscode smoke test passed");
