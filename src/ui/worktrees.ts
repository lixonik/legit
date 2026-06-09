import * as vscode from 'vscode';
import * as path from 'path';
import { Repository } from '../model/repository';

/** JetBrains-style Worktrees popup: list worktrees, add, open, remove, prune. */
export async function manageWorktrees(repo: Repository): Promise<void> {
  const trees = await repo.git.worktrees();
  type Item = vscode.QuickPickItem & { action?: string; dir?: string };
  const items: Item[] = [
    { label: '$(add) New Worktree...', action: 'add' },
    { label: '$(trash) Prune Stale Worktrees', action: 'prune' },
  ];
  if (trees.length) {
    items.push({ label: 'Worktrees', kind: vscode.QuickPickItemKind.Separator });
    for (const w of trees) {
      items.push({
        label: '$(folder) ' + (w.branch || w.head.slice(0, 7) || w.path),
        description: w.path,
        dir: w.path,
      });
    }
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Git worktrees' });
  if (!pick) return;
  if (pick.action === 'add') return addWorktree(repo);
  if (pick.action === 'prune') {
    try {
      await repo.git.worktreePrune();
      vscode.window.showInformationMessage('JeGit: pruned stale worktrees.');
    } catch (err) {
      vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }
  if (pick.dir) return worktreeActions(repo, pick.dir);
}

async function worktreeActions(repo: Repository, dir: string): Promise<void> {
  type Act = vscode.QuickPickItem & { a: string };
  const action = await vscode.window.showQuickPick<Act>(
    [
      { label: '$(window) Open in New Window', a: 'open' },
      { label: '$(trash) Remove Worktree', a: 'remove' },
    ],
    { placeHolder: dir },
  );
  if (!action) return;
  if (action.a === 'open') {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dir), { forceNewWindow: true });
    return;
  }
  const ok = await vscode.window.showWarningMessage(`Remove worktree at ${dir}?`, { modal: true }, 'Remove');
  if (ok !== 'Remove') return;
  try {
    await repo.git.worktreeRemove(dir);
    vscode.window.showInformationMessage('JeGit: worktree removed.');
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)} (use prune if it is already gone)`);
  }
}

async function addWorktree(repo: Repository): Promise<void> {
  const { current, locals } = await repo.git.branches();
  type B = vscode.QuickPickItem & { branch?: string; create?: boolean };
  const items: B[] = [{ label: '$(add) New branch in the worktree...', create: true }];
  for (const b of locals) items.push({ label: '$(git-branch) ' + b, branch: b });
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Branch to check out in the new worktree' });
  if (!choice) return;

  const base = path.dirname(repo.git.repoRoot);
  const repoName = path.basename(repo.git.repoRoot);
  try {
    if (choice.create) {
      const name = await vscode.window.showInputBox({ prompt: 'New branch name', placeHolder: 'feature/x' });
      if (!name || !name.trim()) return;
      const dir = await promptDir(base, `${repoName}-${name.trim().replace(/[/\\]/g, '-')}`);
      if (!dir) return;
      await repo.git.worktreeAddNewBranch(dir, name.trim(), current);
    } else {
      const dir = await promptDir(base, `${repoName}-${(choice.branch || '').replace(/[/\\]/g, '-')}`);
      if (!dir) return;
      await repo.git.worktreeAdd(dir, choice.branch as string);
    }
    vscode.window.showInformationMessage('JeGit: worktree created.');
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function promptDir(base: string, suggested: string): Promise<string | undefined> {
  const dir = await vscode.window.showInputBox({
    prompt: 'Worktree directory path',
    value: path.join(base, suggested),
  });
  return dir && dir.trim() ? dir.trim() : undefined;
}
