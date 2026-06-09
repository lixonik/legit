import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Git } from './git/git';
import { ChangelistStore } from './model/changelistStore';
import { ShelfStore } from './model/shelfStore';
import { Repository } from './model/repository';
import { registerContentProviders, REV_SCHEME } from './ui/quickDiff';
import { VersionControlView } from './ui/versionControlView';
import { showBranches } from './ui/branches';
import { manageRemotes } from './ui/remotes';
import { toWebUrl, fileWebUrl } from './util/remoteUrl';
import { pushFlow, updateFlow } from './ui/remoteOps';
import { stashChanges, unstash } from './ui/stash';
import { BlameController } from './ui/blame';
import { showFileHistory } from './ui/history';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const repoRoot = await Git.findRepoRoot(folder.uri.fsPath);
  if (!repoRoot) return; // not a git repo -- jegit stays dormant

  const git = new Git(repoRoot);
  const store = new ChangelistStore(context.workspaceState);
  const storageBase = (context.storageUri ?? context.globalStorageUri).fsPath;
  const shelf = new ShelfStore(context.workspaceState, path.join(storageBase, 'shelf'));
  const repo = new Repository(git, store, shelf);
  context.subscriptions.push(repo);
  context.subscriptions.push(registerContentProviders(git));

  const view = new VersionControlView(context, repo);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VersionControlView.viewId, view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  branchItem.command = 'jegit.branches';
  branchItem.tooltip = 'JeGit: Git branches';
  context.subscriptions.push(branchItem);
  const updateBranch = () => {
    const s = repo.sync;
    const ab = s && (s.ahead || s.behind) ? `  $(arrow-down)${s.behind} $(arrow-up)${s.ahead}` : '';
    branchItem.text = repo.branch ? `$(git-branch) ${repo.branch}${ab}` : '$(git-branch) JeGit';
    branchItem.show();
  };
  context.subscriptions.push(repo.onDidChange(updateBranch));

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('jegit.refresh', () => repo.refresh());
  reg('jegit.newChangelist', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
    if (name) await repo.newChangelist(name.trim());
  });
  reg('jegit.branches', () => showBranches(repo));
  reg('jegit.manageRemotes', () => manageRemotes(repo));
  reg('jegit.openFileOnRemote', async () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      vscode.window.showInformationMessage('JeGit: open a file first.');
      return;
    }
    const remotes = await git.remotesList();
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    const web = origin ? toWebUrl(origin.url) : '';
    if (!web) {
      vscode.window.showInformationMessage('JeGit: could not determine the remote web URL.');
      return;
    }
    await vscode.env.openExternal(vscode.Uri.parse(fileWebUrl(web, repo.branch || 'main', repo.relPathOf(uri))));
  });
  reg('jegit.compareFileWithBranch', async () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      vscode.window.showInformationMessage('JeGit: open a file to compare.');
      return;
    }
    const rel = repo.relPathOf(uri);
    const { current, locals, remotes } = await git.branches();
    const items = [...locals, ...remotes].filter((b) => b !== current).map((b) => ({ label: b }));
    if (!items.length) {
      vscode.window.showInformationMessage('JeGit: no other branches to compare with.');
      return;
    }
    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Compare ${rel.split('/').pop()} with branch`,
    });
    if (!pick) return;
    const left = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + rel, query: pick.label });
    const name = rel.split('/').pop() ?? rel;
    await vscode.commands.executeCommand('vscode.diff', left, uri, `${name} (${pick.label} <-> Working Tree)`);
  });
  reg('jegit.newTag', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New tag name', placeHolder: 'v1.0.0' });
    if (!name) return;
    const message = await vscode.window.showInputBox({ prompt: 'Tag message (optional, empty = lightweight tag)' });
    try {
      await git.createTag(name.trim(), '', message?.trim() || undefined);
      vscode.window.showInformationMessage(`JeGit: created tag ${name.trim()}.`);
      await repo.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  reg('jegit.push', () => pushFlow(repo));
  reg('jegit.update', () => updateFlow(repo));
  reg('jegit.fetch', async () => {
    try {
      await git.fetch();
      vscode.window.showInformationMessage('JeGit: fetched.');
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.applyPatchClipboard', async () => {
    const text = await vscode.env.clipboard.readText();
    if (!text.trim()) {
      vscode.window.showInformationMessage('JeGit: clipboard has no patch.');
      return;
    }
    const tmp = path.join(os.tmpdir(), `jegit-clip-${Date.now()}.patch`);
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      await git.applyPatch(tmp);
      vscode.window.showInformationMessage('JeGit: patch applied from clipboard.');
      await repo.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(
        `JeGit: ${err instanceof Error ? err.message : String(err)} (patch may not apply cleanly)`,
      );
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  });
  reg('jegit.pushForce', async () => {
    if (!(await git.hasUpstream())) {
      vscode.window.showWarningMessage('JeGit: no upstream to push to.');
      return;
    }
    const ok = await vscode.window.showWarningMessage(
      'Force push (--force-with-lease)? This overwrites the remote branch.',
      { modal: true },
      'Force Push',
    );
    if (ok !== 'Force Push') return;
    try {
      await git.pushForce();
      vscode.window.showInformationMessage('JeGit: force-pushed.');
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.pushTags', async () => {
    try {
      await git.pushTags();
      vscode.window.showInformationMessage('JeGit: pushed tags.');
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.applyPatch', async () => {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { Patch: ['patch', 'diff'] },
      openLabel: 'Apply Patch',
    });
    if (!uris || !uris.length) return;
    try {
      await git.applyPatch(uris[0].fsPath);
      vscode.window.showInformationMessage('JeGit: patch applied.');
      await repo.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(
        `JeGit: ${err instanceof Error ? err.message : String(err)} (patch may not apply cleanly)`,
      );
    }
  });

  const blame = new BlameController(repo);
  context.subscriptions.push(blame);
  reg('jegit.toggleBlame', () => blame.toggle());
  reg('jegit.showCommitInLog', (hash: string) => view.revealCommitInLog(hash));
  reg('jegit.fileHistory', () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      vscode.window.showInformationMessage('JeGit: open a file to see its history.');
      return undefined;
    }
    return showFileHistory(repo, repo.relPathOf(uri));
  });

  reg('jegit.continueOperation', async () => {
    const op = await git.operationState();
    if (!op) {
      vscode.window.showInformationMessage('JeGit: no merge/rebase/cherry-pick in progress.');
      return;
    }
    try {
      await git.continueOperation(op);
      vscode.window.showInformationMessage(`JeGit: ${op} continued.`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `JeGit: ${err instanceof Error ? err.message : String(err)} (resolve all conflicts first)`,
      );
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.abortOperation', async () => {
    const op = await git.operationState();
    if (!op) {
      vscode.window.showInformationMessage('JeGit: no merge/rebase/cherry-pick in progress.');
      return;
    }
    const ok = await vscode.window.showWarningMessage(`Abort the in-progress ${op}?`, { modal: true }, 'Abort');
    if (ok !== 'Abort') return;
    try {
      await git.abortOperation(op);
      vscode.window.showInformationMessage(`JeGit: ${op} aborted.`);
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.skipCommit', async () => {
    if ((await git.operationState()) !== 'rebase') {
      vscode.window.showInformationMessage('JeGit: skip is only available during a rebase.');
      return;
    }
    try {
      await git.skipRebase();
      vscode.window.showInformationMessage('JeGit: skipped the current commit.');
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.cleanupBranches', async () => {
    const { current } = await git.branches();
    const merged = (await git.mergedBranches()).filter((b) => b !== current && b !== 'main' && b !== 'master');
    if (!merged.length) {
      vscode.window.showInformationMessage('JeGit: no merged branches to clean up.');
      return;
    }
    const picks = await vscode.window.showQuickPick(
      merged.map((b) => ({ label: b, picked: true })),
      { canPickMany: true, placeHolder: 'Select merged branches to delete' },
    );
    if (!picks || !picks.length) return;
    try {
      for (const p of picks) await git.deleteBranch(p.label, false);
      vscode.window.showInformationMessage(`JeGit: deleted ${picks.length} merged branch(es).`);
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await repo.refresh();
    }
  });
  reg('jegit.stash', () => stashChanges(repo));
  reg('jegit.unstash', () => unstash(repo));
  reg('jegit.focus', () => vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`));

  await repo.refresh();
  updateBranch();

  // Reveal the jegit panel so it is discoverable instead of hidden behind the
  // Terminal tab in the bottom panel.
  if (vscode.workspace.getConfiguration('jegit').get('panel.autoReveal', true)) {
    void vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`);
  }
}

export function deactivate(): void {}
