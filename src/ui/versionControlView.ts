import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Repository } from '../model/repository';
import { DEFAULT_CHANGELIST_ID } from '../model/changelistStore';
import { HEAD_SCHEME, REV_SCHEME } from './quickDiff';
import { showFileHistory } from './history';
import { showRebaseDialog } from './rebaseDialog';
import { performBranchAction } from './branches';
import { showMergeResolver } from './mergeResolver';
import { splitHunks } from '../util/diff';
import { toWebUrl, commitWebUrl } from '../util/remoteUrl';

interface CommitMsg {
  type: 'commit';
  paths: string[];
  message: string;
  amend: boolean;
  push: boolean;
  signoff: boolean;
  author: string;
}
type Incoming =
  | {
      type:
        | 'ready'
        | 'refresh'
        | 'newChangelist'
        | 'requestLog'
        | 'requestShelf'
        | 'requestConsole'
        | 'branches'
        | 'getLastCommitMessage'
        | 'logBranchFilter'
        | 'logPathFilter';
    }
  | { type: 'setActive' | 'renameChangelist' | 'deleteChangelist'; id: string }
  | { type: 'move'; paths: string[] }
  | { type: 'assignTo'; paths: string[]; id: string }
  | { type: 'openDiff'; path: string; untracked: boolean }
  | { type: 'rollback'; items: { path: string; untracked: boolean }[] }
  | { type: 'commitDetails'; hash: string }
  | { type: 'openRevDiff'; hash: string; parent: string; path: string }
  | {
      type:
        | 'copyHash'
        | 'checkoutRev'
        | 'newBranchAt'
        | 'cherryPick'
        | 'revertCommit'
        | 'resetTo'
        | 'editMessage'
        | 'undoCommit'
        | 'squashTo'
        | 'dropCommit'
        | 'fixupCommit'
        | 'interactiveRebase'
        | 'openCommitRemote';
      hash: string;
    }
  | { type: 'shelve'; items: { path: string; untracked: boolean }[] }
  | { type: 'unshelve'; id: string; keep?: boolean }
  | { type: 'deleteShelf'; id: string }
  | { type: 'renameShelf'; id: string }
  | { type: 'openFile'; path: string }
  | { type: 'mergeResolve'; path: string }
  | { type: 'markResolved'; paths: string[] }
  | { type: 'addToGitignore'; path: string }
  | { type: 'fileHistory'; path: string }
  | { type: 'tagAt'; hash: string }
  | { type: 'commitHunks'; path: string }
  | { type: 'createPatch'; items: { path: string; untracked: boolean }[] }
  | { type: 'copyPath'; path: string; absolute: boolean }
  | { type: 'setLogScope'; scope: string }
  | { type: 'compareCommits'; a: string; b: string }
  | { type: 'branchCmd'; ref: string; action: string; isRemote: boolean }
  | CommitMsg;

/** The JetBrains-style Version Control tool window, rendered as a webview. */
export class VersionControlView implements vscode.WebviewViewProvider {
  static readonly viewId = 'jegit.versionControl';
  private view?: vscode.WebviewView;
  private readonly consoleLog: string[] = [];
  private logScope = '--all';
  private logPath = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: Repository,
  ) {
    this.repo.onDidChange(() => this.postState());
    this.repo.git.commandLogger = (line) => this.pushConsole(line);
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: Incoming) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.repo.refresh();
    });
    void this.repo.refresh();
  }

  private postState(): void {
    this.view?.webview.postMessage({ type: 'state', payload: this.repo.view() });
  }

  private postShelf(): void {
    this.view?.webview.postMessage({ type: 'shelfData', entries: this.repo.shelves() });
  }

  /** Send the branch tree (and the active log scope) to the Log tab's left panel. */
  private async postBranches(): Promise<void> {
    try {
      const { current, locals, remotes } = await this.repo.git.branches();
      this.view?.webview.postMessage({
        type: 'branchData',
        current,
        locals,
        remotes,
        scope: this.logScope,
        logPath: this.logPath,
      });
    } catch {
      /* no branches yet (empty repo) */
    }
  }

  private pushConsole(line: string): void {
    const entry = `$ ${line}`;
    this.consoleLog.push(entry);
    if (this.consoleLog.length > 500) this.consoleLog.shift();
    this.view?.webview.postMessage({ type: 'consoleLine', line: entry });
  }

  /** Focus the Log tab and select a commit by hash (used by the blame "Show Commit in Log" link). */
  async revealCommitInLog(hash: string): Promise<void> {
    await vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`);
    const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
    const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
    this.view?.webview.postMessage({ type: 'logData', commits });
    await this.postBranches();
    this.view?.webview.postMessage({ type: 'revealCommit', hash });
  }

  private async onMessage(m: Incoming): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.postState();
        break;
      case 'refresh':
        await this.repo.refresh();
        break;
      case 'branches':
        await vscode.commands.executeCommand('jegit.branches');
        break;
      case 'requestShelf':
        this.postShelf();
        break;
      case 'requestConsole':
        this.view?.webview.postMessage({ type: 'consoleData', lines: this.consoleLog });
        break;
      case 'getLastCommitMessage': {
        const message = await this.repo.git.commitBody('HEAD');
        this.view?.webview.postMessage({ type: 'lastCommitMessage', message });
        break;
      }
      case 'shelve': {
        if (!m.items?.length) {
          vscode.window.showWarningMessage('JeGit: select files to shelve.');
          break;
        }
        const def = this.repo.store.getChangelist(this.repo.store.activeId)?.name ?? 'Shelved changes';
        const name = await vscode.window.showInputBox({ prompt: 'Shelf name', value: def });
        if (name === undefined) break;
        try {
          await this.repo.shelve(name.trim() || def, m.items);
          this.postShelf();
          vscode.window.showInformationMessage(`JeGit: shelved ${m.items.length} file(s).`);
        } catch (err) {
          vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }
      case 'unshelve':
        try {
          const res = await this.repo.unshelve(m.id, !!m.keep);
          this.postShelf();
          if (res === 'conflicts') {
            vscode.window.showWarningMessage(
              'JeGit: unshelved with conflicts -- resolve them, then commit. The shelf was kept.',
            );
          } else {
            vscode.window.showInformationMessage(m.keep ? 'JeGit: unshelved (shelf kept).' : 'JeGit: unshelved.');
          }
        } catch (err) {
          vscode.window.showErrorMessage(
            `JeGit: ${err instanceof Error ? err.message : String(err)} (patch may not apply cleanly)`,
          );
        }
        break;
      case 'renameShelf': {
        const entry = this.repo.shelves().find((e) => e.id === m.id);
        const name = await vscode.window.showInputBox({ prompt: 'Rename shelf', value: entry?.name });
        if (name === undefined || !name.trim()) break;
        await this.repo.renameShelf(m.id, name.trim());
        this.postShelf();
        break;
      }
      case 'deleteShelf': {
        const ok = await vscode.window.showWarningMessage('Delete this shelf?', { modal: true }, 'Delete');
        if (ok !== 'Delete') break;
        await this.repo.deleteShelf(m.id);
        this.postShelf();
        break;
      }
      case 'requestLog': {
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        await this.postBranches();
        break;
      }
      case 'setLogScope': {
        this.logScope = m.scope || '--all';
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        await this.postBranches();
        break;
      }
      case 'compareCommits': {
        const files = await this.repo.git.diffRefs(m.a, m.b);
        if (!files.length) {
          vscode.window.showInformationMessage('JeGit: no differences between the selected commits.');
          break;
        }
        type F = vscode.QuickPickItem & { path: string };
        const items: F[] = files.map((f) => ({
          label: f.path.split('/').pop() ?? f.path,
          description: `${f.status}  ${f.path}`,
          path: f.path,
        }));
        const file = await vscode.window.showQuickPick(items, {
          placeHolder: `Changed files: ${m.a.slice(0, 7)} <-> ${m.b.slice(0, 7)}`,
        });
        if (!file) break;
        const left = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + file.path, query: m.a });
        const right = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + file.path, query: m.b });
        const name = file.path.split('/').pop() ?? file.path;
        await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${m.a.slice(0, 7)} <-> ${m.b.slice(0, 7)})`);
        break;
      }
      case 'branchCmd': {
        const { current } = await this.repo.git.branches();
        await performBranchAction(this.repo, m.ref, current, m.isRemote, m.action);
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        await this.postBranches();
        break;
      }
      case 'logBranchFilter': {
        const { current, locals, remotes } = await this.repo.git.branches();
        type Item = vscode.QuickPickItem & { scope: string };
        const items: Item[] = [{ label: '$(git-branch) All branches', scope: '--all' }];
        for (const b of locals) items.push({ label: b, description: b === current ? 'current' : undefined, scope: b });
        for (const b of remotes) items.push({ label: '$(cloud) ' + b, scope: b });
        const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Show log for' });
        if (!pick) break;
        this.logScope = pick.scope;
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        break;
      }
      case 'logPathFilter': {
        const p = await vscode.window.showInputBox({
          prompt: 'Filter Log by path (empty = all paths)',
          value: this.logPath,
          placeHolder: 'src/app/foo.ts',
        });
        if (p === undefined) break;
        this.logPath = p.trim();
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        await this.postBranches();
        break;
      }
      case 'commitDetails': {
        const [files, body, committer] = await Promise.all([
          this.repo.git.commitFiles(m.hash),
          this.repo.git.commitBody(m.hash),
          this.repo.git.commitCommitter(m.hash),
        ]);
        this.view?.webview.postMessage({ type: 'commitDetailsData', hash: m.hash, files, body, committer });
        break;
      }
      case 'openRevDiff':
        await this.openRevDiff(m.hash, m.parent, m.path);
        break;
      case 'copyHash':
        await vscode.env.clipboard.writeText(m.hash);
        vscode.window.showInformationMessage(`JeGit: copied ${m.hash.slice(0, 10)}`);
        break;
      case 'openCommitRemote': {
        const remotes = await this.repo.git.remotesList();
        const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
        const web = origin ? toWebUrl(origin.url) : '';
        if (!web) {
          vscode.window.showInformationMessage('JeGit: could not determine the remote web URL.');
          break;
        }
        await vscode.env.openExternal(vscode.Uri.parse(commitWebUrl(web, m.hash)));
        break;
      }
      case 'checkoutRev':
        await this.runLogOp(() => this.repo.git.checkout(m.hash), `checked out ${m.hash.slice(0, 7)} (detached)`);
        break;
      case 'newBranchAt': {
        const name = await vscode.window.showInputBox({ prompt: `New branch at ${m.hash.slice(0, 7)}`, placeHolder: 'feature/x' });
        if (!name) break;
        await this.runLogOp(() => this.repo.git.checkoutNew(name.trim(), m.hash), `created ${name.trim()}`);
        break;
      }
      case 'cherryPick':
        await this.runLogOp(() => this.repo.git.cherryPick(m.hash), `cherry-picked ${m.hash.slice(0, 7)}`);
        break;
      case 'revertCommit':
        await this.runLogOp(() => this.repo.git.revert(m.hash), `reverted ${m.hash.slice(0, 7)}`);
        break;
      case 'resetTo': {
        type ModeItem = vscode.QuickPickItem & { mode: 'soft' | 'mixed' | 'hard' };
        const items: ModeItem[] = [
          { label: 'Soft', description: 'keep all changes staged', mode: 'soft' },
          { label: 'Mixed', description: 'keep changes, unstaged', mode: 'mixed' },
          { label: 'Hard', description: 'discard all local changes', mode: 'hard' },
        ];
        const choice = await vscode.window.showQuickPick(items, {
          placeHolder: `Reset ${this.repo.branch} to ${m.hash.slice(0, 7)}`,
        });
        if (!choice) break;
        if (choice.mode === 'hard') {
          const ok = await vscode.window.showWarningMessage(
            'Hard reset will discard local changes. Continue?',
            { modal: true },
            'Reset',
          );
          if (ok !== 'Reset') break;
        }
        await this.runLogOp(() => this.repo.git.reset(m.hash, choice.mode), `reset to ${m.hash.slice(0, 7)}`);
        break;
      }
      case 'editMessage': {
        const head = await this.repo.git.headHash();
        const current = await this.repo.git.commitBody(m.hash);
        const message = await vscode.window.showInputBox({ prompt: 'Edit commit message', value: current });
        if (message === undefined || !message.trim()) break;
        if (m.hash === head) {
          await this.runLogOp(() => this.repo.git.amendMessage(message.trim()), 'reworded the latest commit');
        } else {
          await this.runLogOp(
            () => this.repo.git.rebaseAction(`${m.hash}~1`, m.hash, 'reword', this.rebaseScript(), message.trim()),
            `reworded ${m.hash.slice(0, 7)}`,
          );
        }
        break;
      }
      case 'dropCommit': {
        const ok = await vscode.window.showWarningMessage(
          `Drop commit ${m.hash.slice(0, 7)}? Its changes will be discarded.`,
          { modal: true },
          'Drop',
        );
        if (ok !== 'Drop') break;
        const head = await this.repo.git.headHash();
        if (m.hash === head) {
          await this.runLogOp(() => this.repo.git.resetHard(`${m.hash}~1`), `dropped ${m.hash.slice(0, 7)}`);
        } else {
          await this.runLogOp(
            () => this.repo.git.rebaseAction(`${m.hash}~1`, m.hash, 'drop', this.rebaseScript()),
            `dropped ${m.hash.slice(0, 7)}`,
          );
        }
        break;
      }
      case 'fixupCommit':
        await this.runLogOp(
          () => this.repo.git.rebaseAction(`${m.hash}~2`, m.hash, 'fixup', this.rebaseScript()),
          `fixed up ${m.hash.slice(0, 7)} into its parent`,
        );
        break;
      case 'interactiveRebase': {
        await showRebaseDialog(this.context, this.repo, m.hash);
        const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
        const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
        this.view?.webview.postMessage({ type: 'logData', commits });
        break;
      }
      case 'undoCommit': {
        const head = await this.repo.git.headHash();
        if (m.hash !== head) {
          vscode.window.showInformationMessage('JeGit: only the latest commit can be undone.');
          break;
        }
        const ok = await vscode.window.showWarningMessage(
          'Undo the last commit? Its changes return to Local Changes.',
          { modal: true },
          'Undo Commit',
        );
        if (ok !== 'Undo Commit') break;
        await this.runLogOp(() => this.repo.git.undoLastCommit(), 'undid the last commit');
        break;
      }
      case 'squashTo': {
        const head = await this.repo.git.headHash();
        if (m.hash === head) {
          vscode.window.showInformationMessage('JeGit: pick an older commit; this squashes it and all newer commits into one.');
          break;
        }
        if (!(await this.repo.git.isAncestor(m.hash, 'HEAD'))) {
          vscode.window.showInformationMessage('JeGit: that commit is not in the current branch history.');
          break;
        }
        const combined = await this.repo.git.rangeMessages(`${m.hash}~1..HEAD`);
        const message = await vscode.window.showInputBox({
          prompt: `Squash ${m.hash.slice(0, 7)}..HEAD into one commit`,
          value: combined.split('\n')[0] || '',
        });
        if (!message || !message.trim()) break;
        await this.runLogOp(async () => {
          await this.repo.git.reset(`${m.hash}~1`, 'soft');
          await this.repo.git.commitIndex(message.trim());
        }, `squashed ${m.hash.slice(0, 7)}..HEAD`);
        break;
      }
      case 'newChangelist': {
        const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
        if (name) await this.repo.newChangelist(name.trim());
        break;
      }
      case 'renameChangelist': {
        const cl = this.repo.store.getChangelist(m.id);
        const name = await vscode.window.showInputBox({ prompt: 'Rename changelist', value: cl?.name });
        if (name) await this.repo.rename(m.id, name.trim());
        break;
      }
      case 'deleteChangelist':
        if (m.id === DEFAULT_CHANGELIST_ID) {
          vscode.window.showWarningMessage('JeGit: the default changelist cannot be deleted.');
        } else {
          await this.repo.remove(m.id);
        }
        break;
      case 'setActive':
        await this.repo.setActive(m.id);
        break;
      case 'move':
        await this.moveToChangelist(m.paths);
        break;
      case 'assignTo':
        await this.repo.move(m.paths, m.id);
        break;
      case 'openDiff':
        await this.openDiff(m.path, m.untracked);
        break;
      case 'openFile':
        await vscode.commands.executeCommand('vscode.open', this.repo.absUri(m.path));
        break;
      case 'mergeResolve':
        await showMergeResolver(this.context, this.repo, m.path);
        break;
      case 'markResolved':
        await this.repo.git.add(m.paths);
        await this.repo.refresh();
        break;
      case 'addToGitignore':
        await this.addToGitignore(m.path);
        break;
      case 'fileHistory':
        await showFileHistory(this.repo, m.path);
        break;
      case 'tagAt': {
        const name = await vscode.window.showInputBox({ prompt: 'New tag name', placeHolder: 'v1.0.0' });
        if (!name) break;
        const message = await vscode.window.showInputBox({ prompt: 'Tag message (optional, empty = lightweight tag)' });
        await this.runLogOp(
          () => this.repo.git.createTag(name.trim(), m.hash, message?.trim() || undefined),
          `created tag ${name.trim()}`,
        );
        break;
      }
      case 'rollback':
        await this.rollback(m.items);
        break;
      case 'commit':
        await this.commit(m);
        break;
      case 'commitHunks':
        await this.commitHunks(m.path);
        break;
      case 'createPatch':
        await this.createPatch(m.items);
        break;
      case 'copyPath':
        await vscode.env.clipboard.writeText(m.absolute ? this.repo.absUri(m.path).fsPath : m.path);
        vscode.window.showInformationMessage('JeGit: path copied to clipboard.');
        break;
    }
  }

  private async commit(m: CommitMsg): Promise<void> {
    if (!m.paths?.length) {
      vscode.window.showWarningMessage('JeGit: select at least one file to commit.');
      return;
    }
    if (!m.message?.trim()) {
      vscode.window.showWarningMessage('JeGit: enter a commit message first.');
      return;
    }
    try {
      await this.repo.commit(m.paths, m.message.trim(), {
        amend: m.amend,
        push: m.push,
        signoff: m.signoff,
        author: m.author?.trim() || undefined,
      });
      this.view?.webview.postMessage({ type: 'committed' });
      vscode.window.showInformationMessage(
        `JeGit: committed ${m.paths.length} file(s)${m.push ? ' and pushed' : ''}.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Commit a subset of a file's hunks: stage selected hunks to the index, commit. */
  private async commitHunks(rel: string): Promise<void> {
    const diff = await this.repo.git.diffHead([rel]);
    if (!diff.trim()) {
      vscode.window.showInformationMessage('JeGit: no changes to commit in this file.');
      return;
    }
    const { header, hunks } = splitHunks(diff);
    if (!hunks.length) {
      vscode.window.showInformationMessage('JeGit: no hunks found.');
      return;
    }
    type Hunk = vscode.QuickPickItem & { index: number };
    const items: Hunk[] = hunks.map((h, i) => ({
      label: h.header,
      detail: h.lines.slice(1, 4).join(' ').slice(0, 100),
      picked: true,
      index: i,
    }));
    const picked = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      placeHolder: `Select hunks of ${rel.split('/').pop()} to commit`,
    });
    if (!picked || !picked.length) return;
    const message = await vscode.window.showInputBox({ prompt: 'Commit message' });
    if (!message || !message.trim()) return;

    const patch = header + '\n' + picked.map((p) => hunks[p.index].lines.join('\n')).join('\n') + '\n';
    const tmp = path.join(os.tmpdir(), `jegit-hunks-${Date.now()}.patch`);
    try {
      fs.writeFileSync(tmp, patch, 'utf8');
      await this.repo.git.applyCached(tmp);
      await this.repo.git.commitIndex(message.trim());
      vscode.window.showInformationMessage(`JeGit: committed ${picked.length} hunk(s) of ${rel.split('/').pop()}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: partial commit failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      await this.repo.refresh();
    }
  }

  /** Write the diff of the given files to a .patch file chosen by the user. */
  private async createPatch(items: { path: string; untracked: boolean }[]): Promise<void> {
    if (!items.length) return;
    const untracked = items.filter((i) => i.untracked).map((i) => i.path);
    const all = items.map((i) => i.path);
    try {
      if (untracked.length) await this.repo.git.addIntentToAdd(untracked);
      const patch = await this.repo.git.diffHead(all);
      if (untracked.length) await this.repo.git.raw(['reset', '-q', '--', ...untracked]).catch(() => undefined);
      if (!patch.trim()) {
        vscode.window.showInformationMessage('JeGit: nothing to put in the patch.');
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        defaultUri: this.repo.absUri('changes.patch'),
        filters: { Patch: ['patch', 'diff'] },
      });
      if (!uri) return;
      fs.writeFileSync(uri.fsPath, patch, 'utf8');
      vscode.window.showInformationMessage(`JeGit: created patch ${uri.fsPath.split(/[\\/]/).pop()}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async moveToChangelist(paths: string[]): Promise<void> {
    if (!paths?.length) return;
    type Item = vscode.QuickPickItem & { id: string };
    const items: Item[] = this.repo.store.changelists
      .filter((c) => c.id !== this.repo.store.activeId)
      .map((c) => ({ label: c.name, id: c.id }));
    items.push({ label: '$(add) New changelist...', id: '__new__' });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Move to changelist' });
    if (!pick) return;
    let id = pick.id;
    if (id === '__new__') {
      const name = await vscode.window.showInputBox({ prompt: 'New changelist name' });
      if (!name) return;
      id = (await this.repo.newChangelist(name.trim(), false)).id;
    }
    await this.repo.move(paths, id);
  }

  private async rollback(items: { path: string; untracked: boolean }[]): Promise<void> {
    if (!items?.length) return;
    const confirm = await vscode.window.showWarningMessage(
      `Rollback ${items.length} file(s)? Local changes will be lost.`,
      { modal: true },
      'Rollback',
    );
    if (confirm !== 'Rollback') return;
    const tracked = items.filter((i) => !i.untracked).map((i) => i.path);
    const untracked = items.filter((i) => i.untracked).map((i) => i.path);
    try {
      if (tracked.length) await this.repo.git.raw(['checkout', 'HEAD', '--', ...tracked]);
      for (const rel of untracked) {
        try {
          fs.unlinkSync(this.repo.absUri(rel).fsPath);
        } catch {
          /* already gone */
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.repo.refresh();
    }
  }

  private async addToGitignore(rel: string): Promise<void> {
    const gi = this.repo.absUri('.gitignore').fsPath;
    try {
      let cur = '';
      try {
        cur = fs.readFileSync(gi, 'utf8');
      } catch {
        /* no .gitignore yet */
      }
      const existing = cur.split('\n').map((s) => s.trim());
      if (!existing.includes(rel)) {
        const sep = cur && !cur.endsWith('\n') ? '\n' : '';
        fs.appendFileSync(gi, sep + rel + '\n');
      }
      vscode.window.showInformationMessage(`JeGit: added ${rel} to .gitignore.`);
      await this.repo.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async openDiff(rel: string, untracked: boolean): Promise<void> {
    const abs = this.repo.absUri(rel);
    if (untracked) {
      await vscode.commands.executeCommand('vscode.open', abs);
      return;
    }
    const head = abs.with({ scheme: HEAD_SCHEME, query: rel });
    const name = rel.split('/').pop() ?? rel;
    await vscode.commands.executeCommand('vscode.diff', head, abs, `${name} (HEAD <-> Working Tree)`);
  }

  private async openRevDiff(hash: string, parent: string, rel: string): Promise<void> {
    const left = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + rel, query: parent });
    const right = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + rel, query: hash });
    const name = rel.split('/').pop() ?? rel;
    const sh = (h: string) => (h ? h.slice(0, 7) : '∅');
    await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${sh(parent)} <-> ${sh(hash)})`);
  }

  private rebaseScript(): string {
    return vscode.Uri.joinPath(this.context.extensionUri, 'media', 'rebase-editor.js').fsPath;
  }

  /** Run a Log action, report it, then refresh both the working tree and the log. */
  private async runLogOp(op: () => Promise<void>, ok: string): Promise<void> {
    try {
      await op();
      vscode.window.showInformationMessage(`JeGit: ${ok}.`);
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.repo.refresh();
      const limit = vscode.workspace.getConfiguration('jegit').get('log.maxCount', 400);
      const commits = await this.repo.git.log(limit, this.logScope, this.logPath);
      this.view?.webview.postMessage({ type: 'logData', commits });
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vcs.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vcs.js'));
    const codiconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'codicons', 'codicon.css'),
    );
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link href="${codiconUri}" rel="stylesheet" />
<link href="${cssUri}" rel="stylesheet" />
<title>JeGit</title>
</head>
<body>
  <div class="tabbar">
    <div class="tab active" data-tab="local">Local Changes</div>
    <div class="tab" data-tab="log">Log</div>
    <div class="tab" data-tab="shelf">Shelf</div>
    <div class="tab" data-tab="console">Console</div>
    <div class="branch" id="branch"></div>
  </div>

  <div class="tabpanel active" data-tab="local">
    <div class="toolbar">
      <button class="tool" id="tb-focus" title="Focus commit message"><i class="codicon codicon-check"></i></button>
      <button class="tool" id="tb-refresh" title="Refresh"><i class="codicon codicon-refresh"></i></button>
      <button class="tool" id="tb-new" title="New changelist"><i class="codicon codicon-add"></i></button>
      <span class="sep"></span>
      <button class="tool" id="tb-rollback" title="Rollback selected"><i class="codicon codicon-discard"></i></button>
      <button class="tool" id="tb-shelve" title="Shelve selected"><i class="codicon codicon-archive"></i></button>
      <span class="sep"></span>
      <button class="tool" id="tb-expand" title="Expand all"><i class="codicon codicon-expand-all"></i></button>
      <button class="tool" id="tb-collapse" title="Collapse all"><i class="codicon codicon-collapse-all"></i></button>
      <span class="sep"></span>
      <button class="tool" id="tb-group" title="Group by directory / flat list"><i class="codicon codicon-list-tree"></i></button>
    </div>
    <div class="tree" id="tree"></div>
    <div class="commit-area">
      <textarea id="message" placeholder="Commit Message" rows="2"></textarea>
      <div class="commit-row">
        <label class="opt"><input type="checkbox" id="amend" /> Amend</label>
        <label class="opt"><input type="checkbox" id="signoff" /> Sign-off</label>
        <input type="text" id="author" class="author-input" placeholder="Author (optional)" title="Commit as another author: Name &lt;email&gt;" />
        <span class="selinfo" id="selinfo"></span>
        <span class="spacer"></span>
        <button class="btn secondary" id="commit" disabled>Commit</button>
        <button class="btn primary" id="commitPush" disabled>Commit and Push</button>
      </div>
    </div>
  </div>

  <div class="tabpanel" data-tab="log">
    <div class="log-toolbar">
      <input id="log-search" class="log-search" placeholder="Filter commits by message, author or hash..." />
      <select id="log-user" class="log-select" title="Filter by author"><option value="">All users</option></select>
      <select id="log-date" class="log-select" title="Filter by date">
        <option value="">All time</option>
        <option value="1">Last 24 hours</option>
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="365">Last year</option>
      </select>
      <button class="tool" id="log-path" title="Filter by path"><i class="codicon codicon-filter"></i></button>
      <button class="tool" id="log-branch" title="Show log for a branch"><i class="codicon codicon-git-branch"></i></button>
      <span class="sep"></span>
      <button class="tool" id="log-cherrypick" title="Cherry-Pick the selected commit onto the current branch"><i class="codicon codicon-git-commit"></i></button>
      <button class="tool" id="log-refresh" title="Refresh log"><i class="codicon codicon-refresh"></i></button>
    </div>
    <div class="log-body">
      <div class="log-branches" id="log-branches"></div>
      <div class="splitter" id="split-branches"></div>
      <div class="log-left">
        <div class="log-header"><span class="lh-graph"></span><span class="lh-subject">Subject</span><span class="lh-author">Author</span><span class="lh-date">Date</span></div>
        <div class="log-list" id="log-list"></div>
      </div>
      <div class="splitter" id="split-details"></div>
      <div class="log-details" id="log-details"><div class="placeholder">Select a commit to see its details.</div></div>
    </div>
  </div>

  <div class="tabpanel" data-tab="shelf">
    <div class="toolbar">
      <button class="tool" id="shelf-refresh" title="Refresh shelf"><i class="codicon codicon-refresh"></i></button>
    </div>
    <div class="tree" id="shelf-list"></div>
  </div>
  <div class="tabpanel" data-tab="console"><div class="console" id="console-log"></div></div>

  <div class="ctx-menu" id="ctxmenu"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
