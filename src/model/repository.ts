import * as vscode from 'vscode';
import * as path from 'path';
import { Git, FileChange } from '../git/git';
import { ChangelistStore } from './changelistStore';

export interface ChangeItem {
  path: string;
  origPath?: string;
  status: string;
  statusLabel: string;
  letter: string;
  untracked: boolean;
  deleted: boolean;
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
  private readonly disposables: vscode.Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly git: Git,
    readonly store: ChangelistStore,
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

  scheduleRefresh(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 350);
  }

  async refresh(): Promise<void> {
    const [changes, branch] = await Promise.all([this.git.status(), this.git.currentBranch()]);
    this.changes = changes;
    this._branch = branch;
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

  async commit(paths: string[], message: string, opts: { amend?: boolean; push?: boolean }): Promise<void> {
    await this.git.add(paths);
    await this.git.commit(message, paths, { amend: opts.amend });
    if (opts.push) await this.git.push();
    await this.refresh();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

function toItem(ch: FileChange, root: string): ChangeItem {
  const code = ch.status.trim()[0] ?? '';
  const labelMap: Record<string, string> = {
    M: 'Modified',
    A: 'Added',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    U: 'Conflict',
  };
  return {
    path: ch.path,
    origPath: ch.origPath,
    status: ch.status,
    statusLabel: ch.untracked ? 'Unversioned' : labelMap[code] ?? ch.status.trim(),
    letter: ch.untracked ? '?' : code,
    untracked: ch.untracked,
    deleted: ch.status.includes('D'),
    fsPath: path.join(root, ch.path),
  };
}
