import {
  CODICIL_DIR,
  CodicilStore,
  acceptProposal,
  isHealthy,
  rejectProposal,
  renderContextPackage,
  runDoctor,
  suggestedActions,
  verify,
} from "@codicil/core";
import * as path from "node:path";
import * as vscode from "vscode";

import { statusLabel } from "../present.js";
import type { CodicilSession } from "../session.js";
import type { ContextTree } from "../trees/context.js";
import type { KnowledgeFilter, KnowledgeTree } from "../trees/knowledge.js";
import { DetailPanel } from "../webview/detail.js";
import { ReviewPanel } from "../webview/review.js";
import { AgentSetupPanel } from "../webview/setup.js";
import { remember } from "./remember.js";

export interface CommandContext {
  session: CodicilSession;
  knowledgeTree: KnowledgeTree;
  contextTree: ContextTree;
  extensionUri?: vscode.Uri;
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
  extensionUri,
}: CommandContext): vscode.Disposable[] {
  return [
    guard("codicil.init", () => init(session, extensionUri)),
    guard("codicil.configureMcp", () => configureVsCodeMcp(session)),
    guard("codicil.configureCursorMcp", () => configureCursorMcp(session)),
    guard("codicil.configureClaudeCodeMcp", () => configureClaudeCodeMcp(session)),
    guard("codicil.addAgentInstructions", () => addAgentInstructions(session)),
    guard("codicil.openMcpSetupGuide", () => openMcpSetupGuide(session, extensionUri)),
    guard("codicil.remember", () => remember(session)),
    guard("codicil.rememberSelection", () => rememberSelection(session)),
    guard("codicil.refresh", () => session.reload()),

    guard("codicil.showItem", async (id: string) => {
      DetailPanel.show(session, id, extensionUri);
    }),
    guard("codicil.openFile", (arg: unknown) => openFile(session, refOf(arg))),
    guard("codicil.archiveItem", (arg: unknown) => archive(session, refOf(arg))),
    guard("codicil.restoreItem", (arg: unknown) => restore(session, refOf(arg))),
    guard("codicil.verifyItem", (arg: unknown) => verifyItems(session, refOf(arg))),
    guard("codicil.verifyAll", () => verifyItems(session)),

    guard("codicil.reviewProposal", async (arg: unknown) => {
      ReviewPanel.show(session, refOf(arg), extensionUri);
    }),
    guard("codicil.acceptProposal", (arg: unknown) => accept(session, refOf(arg))),
    guard("codicil.rejectProposal", (arg: unknown) => reject(session, refOf(arg))),

    guard("codicil.showContext", () => showContext(contextTree)),
    guard("codicil.doctor", () => doctor(session)),
    guard("codicil.filterByStatus", () => filter(knowledgeTree)),
  ];
}

/** Tree rows arrive as objects; the palette and webviews pass a bare id. */
function refOf(arg: unknown): string {
  if (typeof arg === "string") return arg;
  const candidate = arg as { id?: string; item?: { id?: string } } | undefined;
  const id = candidate?.item?.id ?? candidate?.id;
  if (!id) throw new Error("Pick an item from the Codicil view first.");
  return id;
}

async function init(session: CodicilSession, extensionUri?: vscode.Uri): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error(`Open a folder first, so Codicil knows where to put ${CODICIL_DIR}/.`);
  }

  await CodicilStore.init(folder.uri.fsPath, await session.actor());
  await session.reload();

  const guide = "Open guide";
  const choice = await vscode.window.showInformationMessage(
    `Codicil is set up. Knowledge lives in ${CODICIL_DIR}/ and is meant to be committed.`,
    guide,
  );
  if (choice === guide) await openMcpSetupGuide(session, extensionUri);
}

async function configureVsCodeMcp(session: CodicilSession): Promise<void> {
  const folder = await initializedFolder(session);
  const vscodeDir = vscode.Uri.joinPath(folder.uri, ".vscode");
  const mcpUri = vscode.Uri.joinPath(vscodeDir, "mcp.json");

  await vscode.workspace.fs.createDirectory(vscodeDir);

  const config = await readJsonObject(mcpUri, ".vscode/mcp.json");
  const servers = objectValue(config.servers);
  const existing = servers.codicil;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Codicil MCP server in .vscode/mcp.json.",
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
    codicil: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@codicil/mcp"],
      env: {
        CODICIL_ROOT: "${workspaceFolder}",
      },
    },
  };

  await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(mcpUri);

  void vscode.window.showInformationMessage(
    "Codicil MCP is configured for Copilot in this workspace. Reload MCP servers if Copilot does not pick it up immediately.",
  );
}

async function configureCursorMcp(session: CodicilSession): Promise<void> {
  const folder = await initializedFolder(session);
  const cursorDir = vscode.Uri.joinPath(folder.uri, ".cursor");
  const mcpUri = vscode.Uri.joinPath(cursorDir, "mcp.json");

  await vscode.workspace.fs.createDirectory(cursorDir);

  const config = await readJsonObject(mcpUri, ".cursor/mcp.json");
  const mcpServers = objectValue(config.mcpServers);
  const existing = mcpServers.codicil;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Codicil MCP server in .cursor/mcp.json.",
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
    codicil: codicilMcpServer(folder.uri.fsPath),
  };

  await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(mcpUri);
  void vscode.window.showInformationMessage(
    "Codicil MCP is configured for Cursor in this workspace. Restart Cursor or refresh MCP servers if it does not appear immediately.",
  );
}

async function configureClaudeCodeMcp(session: CodicilSession): Promise<void> {
  const folder = await initializedFolder(session);
  const configUri = vscode.Uri.joinPath(folder.uri, ".mcp.json");

  const config = await readJsonObject(configUri, ".mcp.json");
  const mcpServers = objectValue(config.mcpServers);
  const existing = mcpServers.codicil;

  if (existing !== undefined) {
    const replace = await vscode.window.showWarningMessage(
      "This workspace already has a Codicil MCP server in .mcp.json.",
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
    codicil: codicilMcpServer(folder.uri.fsPath),
  };

  await vscode.workspace.fs.writeFile(configUri, Buffer.from(`${JSON.stringify(config, null, 2)}\n`, "utf8"));
  await openDocument(configUri);
  void vscode.window.showInformationMessage(
    "Codicil MCP is configured for Claude Code in this workspace. Start Claude Code here and approve the project MCP server when prompted.",
  );
}

async function openMcpSetupGuide(session: CodicilSession, extensionUri?: vscode.Uri): Promise<void> {
  AgentSetupPanel.show(session, extensionUri);
}

const instructionBlock = `<!-- codicil-agent-instructions:start -->
## Codicil project knowledge

This repository uses Codicil for reviewed project knowledge. Before making code changes, use the Codicil MCP tools to resolve the relevant context for the files or task you are working on. Prefer Codicil knowledge over stale notes, old chat history or guesses.

Resolve context proactively before planning or editing; do not wait for the developer to ask you to pull context from Codicil.

As the conversation unfolds, decide whether information from the developer is durable project knowledge: a rule, decision, convention, architectural fact, domain concept, current context note or known issue that would help future agents. When it is worth keeping, propose it back to Codicil yourself instead of leaving it only in chat. Do not wait for the developer to say "remember", "record" or "add it". Proposals are staged for human review and are not accepted knowledge until the developer approves them.

Use Codicil MCP tools as follows:
- \`context_resolve\` to get the applicable rules, decisions, conventions and known issues for the current task or file before planning or editing.
- \`knowledge_search\` and \`knowledge_get\` to check existing project knowledge before assuming something is undecided.
- \`knowledge_propose\` to stage durable new or updated knowledge when you judge it worth adding. Proposed knowledge must still be reviewed by a human.
<!-- codicil-agent-instructions:end -->
`;

interface InstructionTarget {
  label: string;
  detail: string;
  uri: (folder: vscode.WorkspaceFolder) => vscode.Uri;
  prefix?: string;
}

interface InstructionPick {
  label: string;
  detail: string;
  targets: InstructionTarget[];
}

const instructionTargets: InstructionTarget[] = [
  {
    label: "Claude Code",
    detail: "CLAUDE.md",
    uri: (folder) => vscode.Uri.joinPath(folder.uri, "CLAUDE.md"),
  },
  {
    label: "Copilot",
    detail: ".github/copilot-instructions.md",
    uri: (folder) => vscode.Uri.joinPath(folder.uri, ".github", "copilot-instructions.md"),
  },
  {
    label: "Cursor",
    detail: ".cursor/rules/codicil.mdc",
    uri: (folder) => vscode.Uri.joinPath(folder.uri, ".cursor", "rules", "codicil.mdc"),
    prefix: "---\nalwaysApply: true\n---\n\n",
  },
];

async function addAgentInstructions(session: CodicilSession): Promise<void> {
  const folder = await initializedFolder(session);
  const picks: InstructionPick[] = [
    { label: "All supported agents", detail: "CLAUDE.md, copilot-instructions.md and Cursor project rule", targets: instructionTargets },
    ...instructionTargets.map((target) => ({ label: target.label, detail: target.detail, targets: [target] })),
  ];
  const picked = await vscode.window.showQuickPick(picks, {
    title: "Add Codicil instructions for which agent?",
    placeHolder: "Choose where Codicil should add agent guidance",
    matchOnDetail: true,
  });
  if (!picked) return;

  const updated: string[] = [];
  const skipped: string[] = [];
  for (const target of picked.targets) {
    const result = await writeInstructionTarget(folder, target);
    if (result === "updated") updated.push(target.detail);
    else skipped.push(target.detail);
  }

  const message = updated.length
    ? `Added Codicil agent instructions to ${updated.join(", ")}.`
    : "Those agent instructions already include Codicil guidance.";
  const open = updated.length === 1 ? "Open file" : undefined;
  const choice = await vscode.window.showInformationMessage(
    skipped.length ? `${message} Already present in ${skipped.join(", ")}.` : message,
    ...(open ? [open] : []),
  );
  if (choice === open && updated[0]) {
    const target = picked.targets.find((candidate) => candidate.detail === updated[0]);
    if (target) await openDocument(target.uri(folder));
  }
}

async function writeInstructionTarget(
  folder: vscode.WorkspaceFolder,
  target: InstructionTarget,
): Promise<"updated" | "skipped"> {
  const uri = target.uri(folder);
  const existing = await readTextFile(uri);
  if (existing.includes("codicil-agent-instructions:start")) return "skipped";

  const prefix = existing.length === 0 ? target.prefix ?? "" : "";
  const spacer = existing.length > 0 && !existing.endsWith("\n") ? "\n\n" : existing.length > 0 ? "\n" : "";
  await createParentDirectory(uri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(`${prefix}${existing}${spacer}${instructionBlock}`, "utf8"));
  return "updated";
}

async function readTextFile(uri: vscode.Uri): Promise<string> {
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "FileNotFound") return "";
    throw error;
  }
}

async function createParentDirectory(uri: vscode.Uri): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(uri.fsPath)));
}

async function initializedFolder(session: CodicilSession): Promise<vscode.WorkspaceFolder> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder first.");

  if (!session.initialized) {
    const initialize = await vscode.window.showInformationMessage(
      "Set up Codicil in this workspace before connecting agents to it.",
      "Initialize Codicil",
      "Cancel",
    );
    if (initialize !== "Initialize Codicil") throw new Error("Codicil setup cancelled.");
    await CodicilStore.init(folder.uri.fsPath, await session.actor());
    await session.reload();
  }

  return folder;
}

function codicilMcpServer(root: string): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "@codicil/mcp"],
    env: { CODICIL_ROOT: root },
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
      throw new Error(`${label} is not valid JSON. Fix it or use the guide snippet manually.`);
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

async function rememberSelection(session: CodicilSession): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = editor?.document.getText(editor.selection).trim();
  if (!selected) throw new Error("Select the text you want to remember first.");
  await remember(session, selected);
}

async function openFile(session: CodicilSession, reference: string): Promise<void> {
  const item = session.requireStore().resolveRef(reference);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.filePath));
  await vscode.window.showTextDocument(document);
}

async function archive(session: CodicilSession, reference: string): Promise<void> {
  const store = session.requireStore();
  const item = store.resolveRef(reference);

  const confirm = await vscode.window.showWarningMessage(
    `Archive "${item.title}"?`,
    {
      modal: true,
      detail: `Agents stop being told this. The file moves to ${CODICIL_DIR}/archive/ and stays in Git.`,
    },
    "Archive",
  );
  if (confirm !== "Archive") return;

  await store.archive(item.id, await session.actor());
  await session.reload();
}

async function restore(session: CodicilSession, reference: string): Promise<void> {
  const store = session.requireStore();
  await store.restore(reference, await session.actor());
  await session.reload();
}

async function verifyItems(session: CodicilSession, reference?: string): Promise<void> {
  const store = session.requireStore();
  const actor = await session.actor();

  const report = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Checking knowledge against the code" },
    () => verify(store, actor, reference ? { references: [reference] } : {}),
  );
  await session.reload();

  if (report.results.length === 0) {
    void vscode.window.showInformationMessage(
      "Nothing to check yet. Add verification checks to an item so Codicil can tell when it goes out of date.",
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
    if (problems.length === 1) await vscode.commands.executeCommand("codicil.showItem", first.item.id);
    else await vscode.commands.executeCommand("codicil.filterByStatus");
  }
}

async function accept(session: CodicilSession, reference: string): Promise<void> {
  const store = session.requireStore();
  const result = await acceptProposal(store, reference, await session.actor());
  ReviewPanel.dismiss(result.proposal.id);
  await session.reload();
}

async function reject(session: CodicilSession, reference: string): Promise<void> {
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
  if (!pkg) throw new Error("This workspace has no Codicil knowledge layer yet.");

  const document = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: renderContextPackage(pkg, { includeTrace: true }),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

async function doctor(session: CodicilSession): Promise<void> {
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
      "# Codicil health check",
      "",
      isHealthy(report)
        ? "Nothing is broken, but some things are worth tidying."
        : "Some problems stop Codicil working.",
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
