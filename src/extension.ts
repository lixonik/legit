import * as vscode from 'vscode';
import { Git } from './git/git';
import { ChangelistStore } from './model/changelistStore';
import { Repository } from './model/repository';
import { registerDiff } from './ui/quickDiff';
import { VersionControlView } from './ui/versionControlView';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const repoRoot = await Git.findRepoRoot(folder.uri.fsPath);
  if (!repoRoot) return; // not a git repo -- legit stays dormant

  const git = new Git(repoRoot);
  const store = new ChangelistStore(context.workspaceState);
  const repo = new Repository(git, store);
  context.subscriptions.push(repo);
  context.subscriptions.push(registerDiff(git));

  const view = new VersionControlView(context, repo);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VersionControlView.viewId, view, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('legit.refresh', () => repo.refresh());
  reg('legit.newChangelist', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
    if (name) await repo.newChangelist(name.trim());
  });
  reg('legit.focus', () => vscode.commands.executeCommand(`${VersionControlView.viewId}.focus`));

  await repo.refresh();
}

export function deactivate(): void {}
