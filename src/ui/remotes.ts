import * as vscode from 'vscode';
import { Repository } from '../model/repository';

/** Manage git remotes: list, add, change URL, rename, remove. */
export async function manageRemotes(repo: Repository): Promise<void> {
  const remotes = await repo.git.remotesList();
  type Item = vscode.QuickPickItem & { name?: string; action?: string };
  const items: Item[] = [{ label: '$(add) Add remote...', action: 'add' }];
  for (const r of remotes) items.push({ label: r.name, description: r.url, name: r.name });

  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Git remotes' });
  if (!pick) return;

  try {
    if (pick.action === 'add') {
      const name = await vscode.window.showInputBox({ prompt: 'Remote name', value: 'origin' });
      if (!name) return;
      const url = await vscode.window.showInputBox({ prompt: 'Remote URL', placeHolder: 'https://github.com/user/repo.git' });
      if (!url) return;
      await repo.git.remoteAdd(name.trim(), url.trim());
      vscode.window.showInformationMessage(`JeGit: added remote ${name.trim()}.`);
      return;
    }
    if (!pick.name) return;

    type Act = vscode.QuickPickItem & { a: string };
    const act = await vscode.window.showQuickPick<Act>(
      [
        { label: '$(edit) Change URL', a: 'url' },
        { label: '$(edit) Rename', a: 'rename' },
        { label: '$(trash) Remove', a: 'remove' },
      ],
      { placeHolder: `${pick.name} (${pick.description})` },
    );
    if (!act) return;

    if (act.a === 'url') {
      const url = await vscode.window.showInputBox({ prompt: `New URL for ${pick.name}`, value: pick.description });
      if (!url) return;
      await repo.git.remoteSetUrl(pick.name, url.trim());
    } else if (act.a === 'rename') {
      const nn = await vscode.window.showInputBox({ prompt: `Rename ${pick.name} to`, value: pick.name });
      if (!nn) return;
      await repo.git.remoteRename(pick.name, nn.trim());
    } else {
      const ok = await vscode.window.showWarningMessage(`Remove remote ${pick.name}?`, { modal: true }, 'Remove');
      if (ok !== 'Remove') return;
      await repo.git.remoteRemove(pick.name);
    }
    vscode.window.showInformationMessage(`JeGit: remote ${pick.name} updated.`);
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}
