import {
  type Actor,
  CHRONICLE_DIR,
  ChronicleError,
  ChronicleStore,
  type Proposal,
  listProposals,
} from "@chronicle/core";
import * as vscode from "vscode";

/**
 * Owns the single open store for the workspace and keeps it in step with the
 * files on disk.
 *
 * The Markdown under `.chronicle/` is authoritative and a developer is expected
 * to edit it by hand, switch branches, and pull. So the extension watches the
 * directory and reloads rather than assuming it is the only writer.
 */
export class ChronicleSession implements vscode.Disposable {
  readonly onDidChange: vscode.Event<void>;

  #folder: vscode.WorkspaceFolder | undefined;
  #store: ChronicleStore | undefined;
  #proposals: Proposal[] = [];
  #loadError: string | undefined;
  #watcher: vscode.FileSystemWatcher | undefined;
  #reloadTimer: NodeJS.Timeout | undefined;

  readonly #emitter = new vscode.EventEmitter<void>();
  readonly #disposables: vscode.Disposable[] = [];

  constructor() {
    this.onDidChange = this.#emitter.event;
    this.#disposables.push(
      this.#emitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reload()),
    );
  }

  get store(): ChronicleStore | undefined {
    return this.#store;
  }

  get proposals(): readonly Proposal[] {
    return this.#proposals;
  }

  get loadError(): string | undefined {
    return this.#loadError;
  }

  get initialized(): boolean {
    return this.#store !== undefined;
  }

  get folder(): vscode.WorkspaceFolder | undefined {
    return this.#folder;
  }

  /** Throws a message worth showing a person if the layer is not usable. */
  requireStore(): ChronicleStore {
    if (this.#store) return this.#store;
    throw new Error(
      this.#loadError ?? "This workspace has no Chronicle knowledge layer yet. Run Chronicle: Set up the knowledge layer.",
    );
  }

  async reload(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    this.#folder = folder;
    this.#loadError = undefined;

    if (!folder) {
      this.#store = undefined;
      this.#proposals = [];
      this.#publish();
      return;
    }

    const root = folder.uri.fsPath;
    try {
      const configured = await vscode.workspace.fs
        .stat(vscode.Uri.joinPath(folder.uri, CHRONICLE_DIR, "config.yaml"))
        .then(
          () => true,
          () => false,
        );
      if (!configured) {
        this.#store = undefined;
        this.#proposals = [];
      } else {
        this.#store = await ChronicleStore.openAt(root);
        this.#proposals = await listProposals(this.#store.paths);
      }
    } catch (error) {
      // A broken file must not take the view down; the tree renders the reason
      // and points at Chronicle: Check the knowledge layer for problems.
      this.#store = undefined;
      this.#proposals = [];
      this.#loadError = error instanceof ChronicleError ? error.message : (error as Error).message;
    }

    this.#ensureWatcher(folder);
    this.#publish();
  }

  /** Coalesces the burst of events a branch switch or a save produces. */
  scheduleReload(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = undefined;
      void this.reload();
    }, 150);
  }

  async actor(): Promise<Actor> {
    const configured = vscode.workspace.getConfiguration("chronicle").get<string>("actor");
    if (configured) return { kind: "human", id: configured };

    const gitName = await this.#gitUserName();
    if (gitName) return { kind: "human", id: gitName };

    return { kind: "human", id: process.env.USER ?? process.env.USERNAME ?? "unknown" };
  }

  async #gitUserName(): Promise<string | undefined> {
    try {
      const git = vscode.extensions.getExtension<{
        getAPI(version: 1): { repositories: Array<{ getConfig(key: string): Promise<string> }> };
      }>("vscode.git");
      if (!git) return undefined;
      const api = (await git.activate()).getAPI(1);
      const repository = api.repositories[0];
      const name = await repository?.getConfig("user.name");
      return name?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  #ensureWatcher(folder: vscode.WorkspaceFolder): void {
    if (this.#watcher) return;
    // The derived cache changes on every read, so watching it would loop.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, `${CHRONICLE_DIR}/{knowledge,archive,proposals}/**`),
    );
    const onEvent = () => this.scheduleReload();
    watcher.onDidCreate(onEvent);
    watcher.onDidChange(onEvent);
    watcher.onDidDelete(onEvent);

    const config = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, `${CHRONICLE_DIR}/config.yaml`),
    );
    config.onDidCreate(onEvent);
    config.onDidChange(onEvent);
    config.onDidDelete(onEvent);

    this.#watcher = watcher;
    this.#disposables.push(watcher, config);
  }

  #publish(): void {
    void vscode.commands.executeCommand("setContext", "chronicle.initialized", this.initialized);
    this.#emitter.fire();
  }

  dispose(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer);
    for (const disposable of this.#disposables) disposable.dispose();
  }
}
