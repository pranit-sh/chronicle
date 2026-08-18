import {
  type KnowledgeDraft,
  type KnowledgeTypeName,
  classifyStatement,
} from "@chronicle/core";
import * as vscode from "vscode";

import { typeLabel } from "../present.js";
import type { ChronicleSession } from "../session.js";

/**
 * Capture, from wherever the developer happens to be.
 *
 * Chronicle guesses the type and scope from the sentence and shows its guess
 * for confirmation rather than making the developer fill in a form. Correcting
 * one dropdown is cheaper than answering six questions, and being able to
 * correct it is what keeps the developer in control.
 */

const TYPES: KnowledgeTypeName[] = [
  "rule",
  "decision",
  "architecture",
  "domain",
  "convention",
  "context",
  "issue",
];

const TYPE_HINT: Record<KnowledgeTypeName, string> = {
  rule: "A constraint agents must follow",
  decision: "A choice that was made, and why",
  architecture: "How the system is put together",
  domain: "Business meaning behind the code",
  convention: "How this team writes things",
  context: "What is going on right now",
  issue: "Something known to be broken",
};

export async function remember(session: ChronicleSession, seed?: string): Promise<void> {
  const store = session.requireStore();

  const statement =
    seed ??
    (await vscode.window.showInputBox({
      title: "Remember this",
      prompt: "Say it the way you would say it to a teammate",
      placeHolder: "Never call the database directly from an API handler",
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.trim().length < 8 ? "Give it a few more words so it still makes sense next month" : undefined,
    }));

  if (!statement?.trim()) return;

  const knownScopes = Object.keys(store.config.scopes);
  const guess = classifyStatement(statement, knownScopes);

  const confirmed = await confirmType(guess.type, guess.reason);
  if (!confirmed) return;

  const scopes = await confirmScopes(guess.scopes, knownScopes);
  if (!scopes) return;

  const draft: KnowledgeDraft = {
    type: confirmed,
    title: guess.title,
    body: guess.body,
    scopes,
    source: "human",
    confidence: 0.9,
    provenance: { origin: "command", ref: "VS Code: Remember this" },
    ...(confirmed === "rule" && guess.enforcement ? { enforcement: guess.enforcement } : {}),
    ...(guess.lifetime ? { lifetime: guess.lifetime } : {}),
  };

  const item = await store.create(draft, await session.actor());
  await session.reload();

  const open = "Open it";
  const evidence = "Attach evidence";
  const choice = await vscode.window.showInformationMessage(
    `Remembered as a ${item.type}: ${item.title}`,
    open,
    evidence,
  );
  if (choice === open) await vscode.commands.executeCommand("chronicle.showItem", item.id);
  if (choice === evidence) await vscode.commands.executeCommand("chronicle.openFile", item.id);
}

async function confirmType(
  guessed: KnowledgeTypeName,
  reason: string,
): Promise<KnowledgeTypeName | undefined> {
  const ordered = [guessed, ...TYPES.filter((type) => type !== guessed)];
  const picked = await vscode.window.showQuickPick(
    ordered.map((type) => ({
      label: typeLabel(type).replace(/s$/, ""),
      description: type === guessed ? `suggested — ${reason}` : "",
      detail: TYPE_HINT[type],
      type,
    })),
    { title: "What kind of knowledge is this?", placeHolder: "Press Enter to accept the suggestion" },
  );
  return picked?.type;
}

async function confirmScopes(
  guessed: readonly string[],
  knownScopes: readonly string[],
): Promise<string[] | undefined> {
  if (knownScopes.length === 0) return [...guessed];

  const all = [...new Set(["project", ...knownScopes, ...guessed])].sort();
  const picked = await vscode.window.showQuickPick(
    all.map((scope) => ({
      label: scope,
      description: scope === "project" ? "everywhere" : "",
      picked: guessed.includes(scope),
    })),
    {
      title: "Where does this apply?",
      placeHolder: "Narrower scopes keep the agent's context focused",
      canPickMany: true,
    },
  );
  if (!picked) return undefined;
  return picked.length ? picked.map((entry) => entry.label) : [...guessed];
}
