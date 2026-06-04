import * as vscode from 'vscode';
import * as path from 'path';
import { Git, FileChange } from '../git/git';
import { ChangelistStore } from '../model/changelistStore';

/** URI scheme used to back the left-hand (HEAD) side of a diff. */
export const HEAD_SCHEME = 'legit-head';

/**
 * Bridges the changelist model onto VS Code's SCM view: one resource group per
 * changelist, populated from `git status`.
 */
export class ChangelistScm implements vscode.Disposable {
  private readonly sc: vscode.SourceControl;
  private readonly groups = new Map<string, vscode.SourceControlResourceGroup>();
  private readonly disposables: vscode.Disposable[] = [];
  private changes: FileChange[] = [];
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly git: Git,
    private readonly store: ChangelistStore,
  ) {
    const rootUri = vscode.Uri.file(git.repoRoot);
    this.sc = vscode.scm.createSourceControl('legit', 'legit', rootUri);
    this.sc.inputBox.placeholder = 'Commit message (legit)';
    this.sc.acceptInputCommand = {
      command: 'legit.commitChangelist',
      title: 'Commit',
      arguments: [undefined],
    };
    this.sc.quickDiffProvider = {
      provideOriginalResource: (uri) => this.headUri(uri),
    };
    this.disposables.push(this.sc);

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, {
        provideTextDocumentContent: (uri) => this.git.showHead(uri.query),
      }),
    );

    this.disposables.push(this.store.onDidChange(() => this.render()));

    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const trigger = () => this.scheduleRefresh();
    watcher.onDidChange(trigger);
    watcher.onDidCreate(trigger);
    watcher.onDidDelete(trigger);
    this.disposables.push(watcher);
  }

  get inputMessage(): string {
    return this.sc.inputBox.value;
  }

  clearInput(): void {
    this.sc.inputBox.value = '';
  }

  relPath(uri: vscode.Uri): string {
    return path.relative(this.git.repoRoot, uri.fsPath).replace(/\\/g, '/');
  }

  /** Repo-relative paths of every change in a changelist (incl. rename sources). */
  pathsInChangelist(id: string): string[] {
    const out: string[] = [];
    for (const ch of this.changes) {
      if (this.store.changelistOf(ch.path) === id) {
        out.push(ch.path);
        if (ch.origPath) out.push(ch.origPath);
      }
    }
    return out;
  }

  scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 400);
  }

  async refresh(): Promise<void> {
    this.changes = await this.git.status();
    await this.store.reconcile(new Set(this.changes.map((c) => c.path)));
    this.render();
  }

  private headUri(uri: vscode.Uri): vscode.Uri {
    return uri.with({ scheme: HEAD_SCHEME, query: this.relPath(uri) });
  }

  private render(): void {
    const wanted = new Set(this.store.changelists.map((c) => c.id));
    for (const [id, group] of this.groups) {
      if (!wanted.has(id)) {
        group.dispose();
        this.groups.delete(id);
      }
    }

    const buckets = new Map<string, vscode.SourceControlResourceState[]>();
    for (const cl of this.store.changelists) buckets.set(cl.id, []);
    for (const ch of this.changes) {
      const bucket = buckets.get(this.store.changelistOf(ch.path)) ?? buckets.get(this.store.activeId)!;
      bucket.push(this.toResourceState(ch));
    }

    for (const cl of this.store.changelists) {
      let group = this.groups.get(cl.id);
      if (!group) {
        group = this.sc.createResourceGroup(cl.id, this.label(cl));
        group.hideWhenEmpty = false;
        this.groups.set(cl.id, group);
      }
      group.label = this.label(cl);
      group.resourceStates = buckets.get(cl.id) ?? [];
    }
    this.sc.count = this.changes.length;
  }

  private label(cl: { id: string; name: string }): string {
    return cl.id === this.store.activeId ? `${cl.name} ✓` : cl.name;
  }

  private toResourceState(ch: FileChange): vscode.SourceControlResourceState {
    const abs = vscode.Uri.file(path.join(this.git.repoRoot, ch.path));
    return {
      resourceUri: abs,
      decorations: {
        tooltip: statusTooltip(ch.status),
        strikeThrough: ch.status.includes('D'),
      },
      command: ch.untracked
        ? { command: 'vscode.open', title: 'Open', arguments: [abs] }
        : {
            command: 'vscode.diff',
            title: 'Open Diff',
            arguments: [this.headUri(abs), abs, `${path.basename(ch.path)} (HEAD ↔ Working Tree)`],
          },
      contextValue: 'legitChange',
    };
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const g of this.groups.values()) g.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function statusTooltip(status: string): string {
  if (status === '??') return 'Untracked';
  const map: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', U: 'Conflict' };
  const code = status.trim()[0] ?? '';
  return map[code] ?? status.trim();
}
