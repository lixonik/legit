import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Git, FileChange } from '../git/git';
import { ChangelistStore } from './changelistStore';
import { ShelfStore, ShelfEntry } from './shelfStore';

export interface ChangeItem {
  path: string;
  origPath?: string;
  status: string;
  statusLabel: string;
  letter: string;
  untracked: boolean;
  deleted: boolean;
  conflicted: boolean;
  fsPath: string;
}

export interface ChangelistView {
  id: string;
  name: string;
  active: boolean;
  files: ChangeItem[];
}

export interface RepositoryView {
  branch: string;
  total: number;
  changelists: ChangelistView[];
}

/**
 * Aggregates the git working-tree status and the changelist model into a single
 * view consumed by the webview, and exposes the mutating operations the UI needs.
 */
export class Repository implements vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private changes: FileChange[] = [];
  private _branch = '';
  private _sync: { ahead: number; behind: number } | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly git: Git,
    readonly store: ChangelistStore,
    readonly shelf: ShelfStore,
  ) {
    this.disposables.push(this.store.onDidChange(() => this._onDidChange.fire()));
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const trigger = () => this.scheduleRefresh();
    watcher.onDidChange(trigger);
    watcher.onDidCreate(trigger);
    watcher.onDidDelete(trigger);
    this.disposables.push(watcher);
  }

  get branch(): string {
    return this._branch;
  }

  get sync(): { ahead: number; behind: number } | null {
    return this._sync;
  }

  scheduleRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 350);
  }

  async refresh(): Promise<void> {
    const [changes, branch] = await Promise.all([this.git.status(), this.git.currentBranch()]);
    this.changes = changes;
    this._branch = branch;
    this._sync = await this.git.aheadBehind();
    await this.store.reconcile(new Set(changes.map((c) => c.path)));
    this._onDidChange.fire();
  }

  view(): RepositoryView {
    const buckets = new Map<string, ChangeItem[]>();
    for (const cl of this.store.changelists) buckets.set(cl.id, []);
    for (const ch of this.changes) {
      const id = this.store.changelistOf(ch.path);
      (buckets.get(id) ?? buckets.get(this.store.activeId)!).push(toItem(ch, this.git.repoRoot));
    }
    const changelists = this.store.changelists.map((cl) => ({
      id: cl.id,
      name: cl.name,
      active: cl.id === this.store.activeId,
      files: (buckets.get(cl.id) ?? []).sort((a, b) => a.path.localeCompare(b.path)),
    }));
    return { branch: this._branch, total: this.changes.length, changelists };
  }

  absUri(rel: string): vscode.Uri {
    return vscode.Uri.file(path.join(this.git.repoRoot, rel));
  }

  relPathOf(uri: vscode.Uri): string {
    return path.relative(this.git.repoRoot, uri.fsPath).replace(/\\/g, '/');
  }

  async newChangelist(name: string, activate = true) {
    const cl = await this.store.create(name);
    if (activate) await this.store.setActive(cl.id);
    return cl;
  }
  rename(id: string, name: string) {
    return this.store.rename(id, name);
  }
  remove(id: string) {
    return this.store.remove(id);
  }
  setActive(id: string) {
    return this.store.setActive(id);
  }
  move(paths: string[], id: string) {
    return this.store.assign(paths, id);
  }

  async commit(
    paths: string[],
    message: string,
    opts: { amend?: boolean; push?: boolean; signoff?: boolean; author?: string },
  ): Promise<void> {
    await this.git.add(paths);
    await this.git.commit(message, paths, { amend: opts.amend, signoff: opts.signoff, author: opts.author });
    if (opts.push) await this.git.push();
    await this.refresh();
  }

  // ---- Shelf ----
  shelves(): ShelfEntry[] {
    return this.shelf.list();
  }

  /** Save the given files as a shelf patch and revert them in the working tree. */
  async shelve(name: string, items: { path: string; untracked: boolean }[]): Promise<void> {
    const tracked = items.filter((i) => !i.untracked).map((i) => i.path);
    const untracked = items.filter((i) => i.untracked).map((i) => i.path);
    const all = items.map((i) => i.path);

    if (untracked.length) await this.git.addIntentToAdd(untracked);
    const patch = await this.git.diffHead(all);
    if (!patch.trim()) {
      if (untracked.length) await this.git.raw(['reset', '-q', '--', ...untracked]).catch(() => undefined);
      throw new Error('nothing to shelve in the selected files');
    }
    await this.shelf.add(name, all, patch);

    if (tracked.length) await this.git.raw(['checkout', 'HEAD', '--', ...tracked]);
    if (untracked.length) {
      await this.git.raw(['reset', '-q', '--', ...untracked]).catch(() => undefined);
      for (const rel of untracked) {
        try {
          fs.unlinkSync(path.join(this.git.repoRoot, rel));
        } catch {
          /* already gone */
        }
      }
    }
    await this.refresh();
  }

  /**
   * Re-apply a shelf to the working tree. On a clean apply the shelf is dropped;
   * if the tree has diverged the patch is applied as a 3-way merge and the shelf
   * is kept so nothing is lost while the conflicts are resolved.
   */
  async unshelve(id: string, keep = false): Promise<'clean' | 'conflicts' | 'missing'> {
    const entry = this.shelf.get(id);
    if (!entry) return 'missing';
    const result = await this.git.applyPatch3way(this.shelf.patchPath(id));
    if (result === 'clean' && !keep) await this.shelf.remove(id);
    await this.refresh();
    return result;
  }

  async deleteShelf(id: string): Promise<void> {
    await this.shelf.remove(id);
  }

  async renameShelf(id: string, name: string): Promise<void> {
    await this.shelf.rename(id, name);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

function toItem(ch: FileChange, root: string): ChangeItem {
  const code = ch.status.trim()[0] ?? '';
  const conflicted = ch.status.includes('U') || ch.status === 'AA' || ch.status === 'DD';
  const labelMap: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    U: 'Conflict',
  };
  const statusLabel = conflicted
    ? 'Merge conflict'
    : ch.untracked
      ? 'Unversioned'
      : labelMap[code] ?? ch.status.trim();
  return {
    path: ch.path,
    origPath: ch.origPath,
    status: ch.status,
    statusLabel,
    letter: conflicted ? 'U' : ch.untracked ? '?' : code,
    untracked: ch.untracked,
    deleted: !conflicted && ch.status.includes('D'),
    conflicted,
    fsPath: path.join(root, ch.path),
  };
}
