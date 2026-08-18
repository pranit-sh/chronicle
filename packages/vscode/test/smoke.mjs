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
    createWebviewPanel: () => ({
      webview: { html: "", onDidReceiveMessage: noopEvent },
      onDidDispose: noopEvent,
      reveal() {},
      dispose() {},
      title: "",
    }),
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

workspaceRoot = await mkdtemp(path.join(tmpdir(), "chronicle-vscode-"));
const core = require("../../core/dist/index.js");
const actor = { kind: "human", id: "tester" };
const store = await core.ChronicleStore.init(workspaceRoot, actor);

await mkdir(path.join(workspaceRoot, "src/api"), { recursive: true });
await writeFile(path.join(workspaceRoot, "src/api/users.ts"), "export const list = () => [];\n");

await store.create(
  { type: "rule", title: "Never call the database directly from an API handler", scopes: ["project"] },
  actor,
);
await store.create({ type: "decision", title: "Postgres over MongoDB", status: "stale" }, actor);
await store.create({ type: "convention", title: "Files are kebab-case" }, actor);
await core.proposeCreate(store, {
  draft: { type: "architecture", title: "Auth lives in src/auth" },
  proposedBy: { kind: "agent", id: "cursor" },
  reason: "Seen while reading the code",
});

// --- run ------------------------------------------------------------------

const extension = require("../dist/extension.cjs");
const subscriptions = [];
await extension.activate({ subscriptions });

assert.ok(subscriptions.length > 0, "activate registered nothing");

for (const name of [
  "chronicle.init",
  "chronicle.remember",
  "chronicle.refresh",
  "chronicle.showItem",
  "chronicle.verifyAll",
  "chronicle.acceptProposal",
  "chronicle.rejectProposal",
  "chronicle.showContext",
  "chronicle.doctor",
]) {
  assert.ok(registered.has(name), `command ${name} was not registered`);
}

const knowledge = events.get("chronicle.knowledge");
const roots = knowledge.getChildren();
assert.equal(roots[0].kind, "summary", "the first row should be the status summary");
const summary = knowledge.getTreeItem(roots[0]);
assert.match(summary.label, /in play/, `unexpected summary: ${summary.label}`);
assert.match(summary.label, /need attention/, "the stale item should be surfaced in the summary");
assert.match(summary.label, /to review/, "the pending proposal should be surfaced in the summary");

const groups = roots.slice(1);
assert.ok(groups.length >= 2, "expected the knowledge to be grouped by type");
for (const group of groups) {
  const row = knowledge.getTreeItem(group);
  assert.ok(row.label, "a group row needs a label");
  for (const child of knowledge.getChildren(group)) {
    const childRow = knowledge.getTreeItem(child);
    assert.ok(childRow.label, "an item row needs a label");
    assert.equal(childRow.command.command, "chronicle.showItem");
  }
}

const proposals = events.get("chronicle.proposals");
const pending = proposals.getChildren();
assert.equal(pending.length, 1, "expected one pending proposal");
const proposalRow = proposals.getTreeItem(pending[0]);
assert.match(proposalRow.label, /New architecture/, `unexpected proposal row: ${proposalRow.label}`);

const contextTree = events.get("chronicle.context");
const contextRows = contextTree.getChildren();
assert.equal(contextRows[0].kind, "header", "the context view should lead with the package header");
for (const row of contextRows) contextTree.getTreeItem(row);

// Accepting has to move the proposal into the knowledge base.
await registered.get("chronicle.acceptProposal")(pending[0].id);
assert.equal(proposals.getChildren().length, 0, "the accepted proposal should be gone");
assert.ok(
  knowledge
    .getChildren()
    .slice(1)
    .some((group) => group.items?.some((item) => item.title === "Auth lives in src/auth")),
  "the accepted proposal should now be knowledge",
);

await registered.get("chronicle.doctor")();
await registered.get("chronicle.verifyAll")();

await rm(workspaceRoot, { recursive: true, force: true });
console.log("vscode smoke test passed");
