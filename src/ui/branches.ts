import * as vscode from 'vscode';
import { Repository } from '../model/repository';

type BranchItem = vscode.QuickPickItem & { ref?: string; action?: string };
type ActionItem = vscode.QuickPickItem & { a: string };

/** JetBrains-style Branches popup: pick a branch, then pick an action. */
export async function showBranches(repo: Repository): Promise<void> {
  const { current, locals, remotes } = await repo.git.branches();
  const items: BranchItem[] = [{ label: '$(add) New Branch...', action: 'new' }];

  if (locals.length) {
    items.push({ label: 'Local', kind: vscode.QuickPickItemKind.Separator });
    for (const b of locals) {
      items.push({
        label: (b === current ? '$(check) ' : '$(git-branch) ') + b,
        description: b === current ? 'current' : undefined,
        ref: b,
      });
    }
  }
  if (remotes.length) {
    items.push({ label: 'Remote', kind: vscode.QuickPickItemKind.Separator });
    for (const b of remotes) items.push({ label: '$(cloud) ' + b, ref: b });
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Git branches (current: ${current})`,
    matchOnDescription: true,
  });
  if (!pick) return;
  if (pick.action === 'new') return newBranchFrom(repo, current);
  if (!pick.ref) return;
  await branchActions(repo, pick.ref, current, remotes.includes(pick.ref));
}

async function branchActions(repo: Repository, ref: string, current: string, isRemote: boolean): Promise<void> {
  const actions: ActionItem[] = [];
  if (ref !== current) actions.push({ label: '$(check) Checkout', a: 'checkout' });
  actions.push({ label: `$(git-branch) New Branch from ${ref}...`, a: 'newfrom' });
  if (ref !== current) {
    actions.push({ label: `$(git-merge) Merge ${ref} into ${current}`, a: 'merge' });
    actions.push({ label: `$(git-pull-request) Rebase ${current} onto ${ref}`, a: 'rebase' });
  }
  if (!isRemote && ref !== current) {
    actions.push({ label: '$(edit) Rename...', a: 'rename' });
    actions.push({ label: '$(trash) Delete', a: 'delete' });
  }

  const pick = await vscode.window.showQuickPick(actions, { placeHolder: ref });
  if (!pick) return;

  try {
    switch (pick.a) {
      case 'checkout':
        await repo.git.checkout(isRemote ? ref.substring(ref.indexOf('/') + 1) : ref);
        break;
      case 'newfrom':
        await newBranchFrom(repo, ref);
        return;
      case 'merge':
        await repo.git.mergeBranch(ref);
        break;
      case 'rebase':
        await repo.git.rebaseOnto(ref);
        break;
      case 'rename': {
        const name = await vscode.window.showInputBox({ prompt: `Rename ${ref} to`, value: ref });
        if (!name) return;
        await repo.git.renameBranch(ref, name.trim());
        break;
      }
      case 'delete': {
        const ok = await vscode.window.showWarningMessage(`Delete branch ${ref}?`, { modal: true }, 'Delete');
        if (ok !== 'Delete') return;
        try {
          await repo.git.deleteBranch(ref, false);
        } catch {
          const force = await vscode.window.showWarningMessage(
            `${ref} is not fully merged. Force delete?`,
            { modal: true },
            'Force Delete',
          );
          if (force !== 'Force Delete') return;
          await repo.git.deleteBranch(ref, true);
        }
        break;
      }
    }
    vscode.window.showInformationMessage(`legit: ${pick.a} (${ref}) done.`);
  } catch (err) {
    vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}

async function newBranchFrom(repo: Repository, from: string): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: `New branch from ${from}`, placeHolder: 'feature/my-branch' });
  if (!name) return;
  try {
    await repo.git.checkoutNew(name.trim(), from);
    vscode.window.showInformationMessage(`legit: created and checked out ${name.trim()}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}
