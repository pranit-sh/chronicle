import {
  CHRONICLE_DIR,
  ChronicleStore,
  acceptProposal,
  isHealthy,
  rejectProposal,
  renderContextPackage,
  runDoctor,
  suggestedActions,
  verify,
} from "@chronicle/core";
import * as vscode from "vscode";

import { statusLabel } from "../present.js";
import type { ChronicleSession } from "../session.js";
import type { ContextTree } from "../trees/context.js";
import type { KnowledgeFilter, KnowledgeTree } from "../trees/knowledge.js";
import { DetailPanel } from "../webview/detail.js";
import { ReviewPanel } from "../webview/review.js";
import { AgentSetupPanel } from "../webview/setup.js";
import { remember } from "./remember.js";

export interface CommandContext {
  session: ChronicleSession;
  knowledgeTree: KnowledgeTree;
  contextTree: ContextTree;
}

/** Wraps a command so a thrown error becomes a message rather than a silent no-op. */
function guard(name: string, run: (...args: never[]) => Promise<void> | void): vscode.Disposable {
  return vscode.commands.registerCommand(name, async (...args: never[]) => {
    try {
      await run(...args);
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  });
}

export function registerCommands({
  session,
  knowledgeTree,
  contextTree,
}: CommandContext): vscode.Disposable[] {
  return [
    guard("chronicle.init", () => init(session)),
    guard("chronicle.configureMcp", () => configureVsCodeMcp(session)),
    guard("chronicle.configureCursorMcp", () => configureCursorMcp(session)),
    guard("chronicle.configureClaudeCodeMcp", () => configureClaudeCodeMcp(session)),
    guard("chronicle.openMcpSetupGuide", () => openMcpSetupGuide(session)),
    guard("chronicle.remember", () => remember(session)),
    guard("chronicle.rememberSelection", () => rememberSelection(session)),
    guard("chronicle.refresh", () => session.reload()),

    guard("chronicle.showItem", async (id: string) => {
      DetailPanel.show(session, id);
    }),
    guard("chronicle.openFile", (id: string) => openFile(session, id)),
    guard("chronicle.archiveItem", (arg: unknown) => archive(session, refOf(arg))),
    guard("chronicle.restoreItem", (arg: unknown) => restore(session, refOf(arg))),
    guard("chronicle.verifyItem", (arg: unknown) => verifyItems(session, refOf(arg))),
    guard("chronicle.verifyAll", () => verifyItems(session)),

    guard("chronicle.reviewProposal", async (arg: unknown) => {
      ReviewPanel.show(session, refOf(arg));
    }),
    guard("chronicle.acceptProposal", (arg: unknown) => accept(session, refOf(arg))),
    guard("chronicle.rejectProposal", (arg: unknown) => reject(session, refOf(arg))),

    guard("chronicle.showContext", () => showContext(contextTree)),
    guard("chronicle.doctor", () => doctor(session)),
    guard("chronicle.filterByStatus", () => filter(knowledgeTree)),
  ];
}

/** Tree rows arrive as objects; the palette and webviews pass a bare id. */
function refOf(arg: unknown): string {
  if (typeof arg === "string") return arg;
  const candidate = arg as { id?: string; item?: { id?: string } } | undefined;
  const id = candidate?.item?.id ?? candidate?.id;
  if (!id) throw new Error("Pick an item from the Chronicle view first.");
  return id;
}

async function init(session: ChronicleSession): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error(`Open a folder first, so Chronicle knows where to put ${CHRONICLE_DIR}/.`);
  }

  await ChronicleStore.init(folder.uri.fsPath, await session.actor());
  await session.reload();

  const configure = "Configure Copilot";
  const guide = "Agent setup guide";
  const choice = await vscode.window.showInformationMessage(
    `Chronicle is set up. Knowledge lives in ${CHRONICLE_DIR}/ and is meant to be committed.`,
    configure,
    guide,
  );
  if (choice === configure) await configureVsCodeMcp(session);
  if (choice === guide) await openMcpSetupGuide(session);
}

async function configureVsCodeMcp(session: ChronicleSession): Promise<void> {
  const folder = await initializedFolder(session);
  const vscodeDir = vscode.Uri.joinPath(folder.uri, ".vscode");
  const mcpUri = vscode.Uri.joinPath(vscodeDir, "mcp.json");

  await vscode.workspace.fs.createDirectory(vscodeDir);

  const config = await readJsonObject(mcpUri, ".vscode/mcp.json");
  const servers = objectValue(config.servers);
  const existing = servers.chronicle;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Chronicle MCP server in .vscode/mcp.json.",
      "Replace it",
      "Open file",
      "Cancel",
    );
    if (replace === "Open file") {
      await openDocument(mcpUri);
      return;
    }
    if (replace !== "Replace it") return;
  }

  config.servers = {
    ...servers,
    chronicle: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@chronicle/mcp"],
      cwd: "${workspaceFolder}",
      env: {
        CHRONICLE_ROOT: "${workspaceFolder}",
      },
    },
  };

  await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(mcpUri);

  const guide = "Other agents";
  const choice = await vscode.window.showInformationMessage(
    "Chronicle MCP is configured for Copilot in this workspace. Reload MCP servers if Copilot does not pick it up immediately.",
    guide,
  );
  if (choice === guide) await openMcpSetupGuide(session);
}

async function configureCursorMcp(session: ChronicleSession): Promise<void> {
  const folder = await initializedFolder(session);
  const cursorDir = vscode.Uri.joinPath(folder.uri, ".cursor");
  const mcpUri = vscode.Uri.joinPath(cursorDir, "mcp.json");

  await vscode.workspace.fs.createDirectory(cursorDir);

  const config = await readJsonObject(mcpUri, ".cursor/mcp.json");
  const mcpServers = objectValue(config.mcpServers);
  const existing = mcpServers.chronicle;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Chronicle MCP server in .cursor/mcp.json.",
      "Replace it",
      "Open file",
      "Cancel",
    );
    if (replace === "Open file") {
      await openDocument(mcpUri);
      return;
    }
    if (replace !== "Replace it") return;
  }

  config.mcpServers = {
    ...mcpServers,
    chronicle: chronicleMcpServer(folder.uri.fsPath),
  };

  await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(mcpUri);
  void vscode.window.showInformationMessage(
    "Chronicle MCP is configured for Cursor in this workspace. Restart Cursor or refresh MCP servers if it does not appear immediately.",
  );
}

async function configureClaudeCodeMcp(session: ChronicleSession): Promise<void> {
  const folder = await initializedFolder(session);
  const configUri = vscode.Uri.joinPath(folder.uri, ".mcp.json");

  const config = await readJsonObject(configUri, ".mcp.json");
  const mcpServers = objectValue(config.mcpServers);
  const existing = mcpServers.chronicle;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Chronicle MCP server in .mcp.json.",
      "Replace it",
      "Open file",
      "Cancel",
    );
    if (replace === "Open file") {
      await openDocument(configUri);
      return;
    }
    if (replace !== "Replace it") return;
  }

  config.mcpServers = {
    ...mcpServers,
    chronicle: chronicleMcpServer(folder.uri.fsPath),
  };

  await vscode.workspace.fs.writeFile(configUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(configUri);
  void vscode.window.showInformationMessage(
    "Chronicle MCP is configured for Claude Code in this workspace. Start Claude Code here and approve the project MCP server when prompted.",
  );
}

async function openMcpSetupGuide(session: ChronicleSession): Promise<void> {
  AgentSetupPanel.show(session);
}

async function initializedFolder(session: ChronicleSession): Promise<vscode.WorkspaceFolder> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder first.");

  if (!session.initialized) {
    const initialize = await vscode.window.showInformationMessage(
      "Set up Chronicle in this workspace before connecting agents to it.",
      "Initialize Chronicle",
      "Cancel",
    );
    if (initialize !== "Initialize Chronicle") throw new Error("Chronicle setup cancelled.");
    await ChronicleStore.init(folder.uri.fsPath, await session.actor());
    await session.reload();
  }

  return folder;
}

function chronicleMcpServer(root: string): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "@chronicle/mcp"],
    env: { CHRONICLE_ROOT: root },
  };
}

async function readJsonObject(uri: vscode.Uri, label: string): Promise<Record<string, unknown>> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString("utf8").trim();
    if (!text) return {};
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must contain a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "FileNotFound") return {};
    if (error instanceof SyntaxError) {
      await openDocument(uri);
      throw new Error(`${label} is not valid JSON. Fix it or use the setup guide snippet manually.`);
    }
    throw error;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function openDocument(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

async function rememberSelection(session: ChronicleSession): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = editor?.document.getText(editor.selection).trim();
  if (!selected) throw new Error("Select the text you want to remember first.");
  await remember(session, selected);
}

async function openFile(session: ChronicleSession, reference: string): Promise<void> {
  const item = session.requireStore().resolveRef(reference);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.filePath));
  await vscode.window.showTextDocument(document);
}

async function archive(session: ChronicleSession, reference: string): Promise<void> {
  const store = session.requireStore();
  const item = store.resolveRef(reference);

  const confirm = await vscode.window.showWarningMessage(
    `Archive "${item.title}"?`,
    {
      modal: true,
      detail: `Agents stop being told this. The file moves to ${CHRONICLE_DIR}/archive/ and stays in Git.`,
    },
    "Archive",
  );
  if (confirm !== "Archive") return;

  await store.archive(item.id, await session.actor());
  await session.reload();
}

async function restore(session: ChronicleSession, reference: string): Promise<void> {
  const store = session.requireStore();
  await store.restore(reference, await session.actor());
  await session.reload();
}

async function verifyItems(session: ChronicleSession, reference?: string): Promise<void> {
  const store = session.requireStore();
  const actor = await session.actor();

  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Checking knowledge against the code" },
    () => verify(store, actor, reference ? { references: [reference] } : {}),
  );
  await session.reload();

  if (report.results.length === 0) {
    void vscode.window.showInformationMessage(
      "Nothing to check yet. Attach evidence to an item so Chronicle can tell when it goes out of date.",
    );
    return;
  }

  const problems = report.results.filter((result) => result.outcome !== "verified");
  if (problems.length === 0) {
    void vscode.window.showInformationMessage(
      `Everything still holds (${report.counts.verified} checked).`,
    );
    return;
  }

  const first = problems[0];
  if (!first) return;

  const review = "Review";
  const headline =
    problems.length === 1
      ? `${first.item.title}: ${first.summary}`
      : `${problems.length} items no longer match the code.`;
  const choice = await vscode.window.showWarningMessage(
    headline,
    { detail: suggestedActions(first.outcome).join(" · ") },
    review,
  );
  if (choice === review) {
    if (problems.length === 1) await vscode.commands.executeCommand("chronicle.showItem", first.item.id);
    else await vscode.commands.executeCommand("chronicle.filterByStatus");
  }
}

async function accept(session: ChronicleSession, reference: string): Promise<void> {
  const store = session.requireStore();
  const result = await acceptProposal(store, reference, await session.actor());
  ReviewPanel.dismiss(result.proposal.id);
  await session.reload();
}

async function reject(session: ChronicleSession, reference: string): Promise<void> {
  const store = session.requireStore();
  const reason = await vscode.window.showInputBox({
    title: "Reject proposal",
    prompt: "Why? This goes in the changelog and is worth writing for your future self",
    placeHolder: "We do the opposite on purpose",
    ignoreFocusOut: true,
  });
  if (reason === undefined) return;

  const proposal = await rejectProposal(store, reference, await session.actor(), reason || undefined);
  ReviewPanel.dismiss(proposal.id);
  await session.reload();
}

/** Opens the exact Markdown an agent would receive for the current file. */
async function showContext(contextTree: ContextTree): Promise<void> {
  const pkg = contextTree.resolve();
  if (!pkg) throw new Error("This workspace has no Chronicle knowledge layer yet.");

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: renderContextPackage(pkg, { includeTrace: true }),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function doctor(session: ChronicleSession): Promise<void> {
  const folder = session.folder ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder first.");

  const report = await runDoctor(folder.uri.fsPath);
  await session.reload();

  if (report.diagnoses.length === 0) {
    void vscode.window.showInformationMessage(
      `The knowledge layer is healthy (${report.itemsChecked} items).`,
    );
    return;
  }

  const lines = report.diagnoses.map((diagnosis) =>
    [
      `${diagnosis.level.toUpperCase()}  ${diagnosis.message}`,
      diagnosis.file ? `        in ${diagnosis.file}` : "",
      diagnosis.fix ? `        ${diagnosis.fix}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: [
      "# Chronicle health check",
      "",
      isHealthy(report)
        ? "Nothing is broken, but some things are worth tidying."
        : "Some problems stop Chronicle working.",
      "",
      "```",
      ...lines,
      "```",
    ].join("\n"),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function filter(knowledgeTree: KnowledgeTree): Promise<void> {
  const choices: Array<{ label: string; detail: string; value: KnowledgeFilter }> = [
    { label: "Everything", detail: "all knowledge except the archive", value: "all" },
    { label: "Needs attention", detail: "stale or expired", value: "needsAttention" },
    { label: statusLabel("active"), detail: "in play right now", value: "active" },
    { label: statusLabel("proposed"), detail: "not confirmed yet", value: "proposed" },
    { label: statusLabel("archived"), detail: "retired, kept for the record", value: "archived" },
  ];

  const picked = await vscode.window.showQuickPick(choices, {
    title: "Show which knowledge?",
    placeHolder: "Type to search titles instead",
    matchOnDetail: true,
  });
  if (picked) knowledgeTree.setFilter(picked.value);
}
