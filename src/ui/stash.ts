import * as vscode from 'vscode';
import { Repository } from '../model/repository';

/** git stash push, with an optional message. */
export async function stashChanges(repo: Repository): Promise<void> {
  const message = await vscode.window.showInputBox({ prompt: 'Stash message (optional)', placeHolder: 'WIP' });
  if (message === undefined) return;
  try {
    await repo.git.stashPush(message.trim());
    vscode.window.showInformationMessage('legit: changes stashed.');
  } catch (err) {
    vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}

/** Pick a stash and apply / pop / drop it. */
export async function unstash(repo: Repository): Promise<void> {
  const stashes = await repo.git.stashList();
  if (!stashes.length) {
    vscode.window.showInformationMessage('legit: no stashes.');
    return;
  }
  type Item = vscode.QuickPickItem & { ref: string };
  const items: Item[] = stashes.map((s) => ({ label: s.ref, description: s.subject, ref: s.ref }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a stash' });
  if (!pick) return;

  type Act = vscode.QuickPickItem & { a: 'apply' | 'pop' | 'drop' };
  const action = await vscode.window.showQuickPick<Act>(
    [
      { label: '$(check) Apply (keep stash)', a: 'apply' },
      { label: '$(arrow-down) Pop (apply and remove)', a: 'pop' },
      { label: '$(trash) Drop', a: 'drop' },
    ],
    { placeHolder: pick.ref },
  );
  if (!action) return;

  try {
    if (action.a === 'apply') {
      await repo.git.stashApply(pick.ref);
    } else if (action.a === 'pop') {
      await repo.git.stashPop(pick.ref);
    } else {
      const ok = await vscode.window.showWarningMessage(`Drop ${pick.ref}?`, { modal: true }, 'Drop');
      if (ok !== 'Drop') return;
      await repo.git.stashDrop(pick.ref);
    }
    vscode.window.showInformationMessage(`legit: stash ${action.a} done.`);
  } catch (err) {
    vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}
