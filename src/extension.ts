import * as vscode from 'vscode';
import * as path from 'path';
import { Git } from './git/git';
import { ChangelistStore } from './model/changelistStore';
import { ShelfStore } from './model/shelfStore';
import { Repository } from './model/repository';
import { registerContentProviders } from './ui/quickDiff';
import { VersionControlView } from './ui/versionControlView';
import { showBranches } from './ui/branches';
import { pushFlow, updateFlow } from './ui/remoteOps';
import { BlameController } from './ui/blame';
import { showFileHistory } from './ui/history';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const repoRoot = await Git.findRepoRoot(folder.uri.fsPath);
  if (!repoRoot) return; // not a git repo -- legit stays dormant

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
  branchItem.command = 'legit.branches';
  branchItem.tooltip = 'legit: Git branches';
  context.subscriptions.push(branchItem);
  const updateBranch = () => {
    const s = repo.sync;
    const ab = s && (s.ahead || s.behind) ? `  $(arrow-down)${s.behind} $(arrow-up)${s.ahead}` : '';
    branchItem.text = repo.branch ? `$(git-branch) ${repo.branch}${ab}` : '$(git-branch) legit';
    branchItem.show();
  };
  context.subscriptions.push(repo.onDidChange(updateBranch));

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('legit.refresh', () => repo.refresh());
  reg('legit.newChangelist', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
    if (name) await repo.newChangelist(name.trim());
  });
  reg('legit.branches', () => showBranches(repo));
  reg('legit.newTag', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New tag name', placeHolder: 'v1.0.0' });
    if (!name) return;
    const message = await vscode.window.showInputBox({ prompt: 'Tag message (optional, empty = lightweight tag)' });
    try {
      await git.createTag(name.trim(), '', message?.trim() || undefined);
      vscode.window.showInformationMessage(`legit: created tag ${name.trim()}.`);
      await repo.refresh();
    } catch (err) {
      vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  reg('legit.push', () => pushFlow(repo));
  reg('legit.update', () => updateFlow(repo));

  const blame = new BlameController(repo);
  context.subscriptions.push(blame);
  reg('legit.toggleBlame', () => blame.toggle());
  reg('legit.fileHistory', () => {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (!uri || uri.scheme !== 'file') {
      vscode.window.showInformationMessage('legit: open a file to see its history.');
      return undefined;
    }
    return showFileHistory(repo, repo.relPathOf(uri));
  });

  reg('legit.focus', () => vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`));

  await repo.refresh();
  updateBranch();

  // Reveal the legit panel so it is discoverable instead of hidden behind the
  // Terminal tab in the bottom panel.
  if (vscode.workspace.getConfiguration('legit').get('panel.autoReveal', true)) {
    void vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`);
  }
}

export function deactivate(): void {}
