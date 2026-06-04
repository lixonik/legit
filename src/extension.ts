import * as vscode from 'vscode';
import { Git } from './git/git';
import { ChangelistStore, DEFAULT_CHANGELIST_ID } from './model/changelistStore';
import { ChangelistScm } from './scm/changelistScm';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const repoRoot = await Git.findRepoRoot(folder.uri.fsPath);
  if (!repoRoot) return; // not a git repo -- legit stays dormant

  const git = new Git(repoRoot);
  const store = new ChangelistStore(context.workspaceState);
  const scm = new ChangelistScm(git, store);
  context.subscriptions.push(scm);

  const reg = (id: string, fn: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg('legit.refresh', () => scm.refresh());

  reg('legit.newChangelist', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
    if (!name) return;
    const cl = await store.create(name.trim());
    await store.setActive(cl.id);
  });

  reg('legit.renameChangelist', async (group?: vscode.SourceControlResourceGroup) => {
    const id = await resolveChangelistId(store, group);
    if (!id) return;
    const current = store.getChangelist(id);
    const name = await vscode.window.showInputBox({ prompt: 'Rename changelist', value: current?.name });
    if (name) await store.rename(id, name.trim());
  });

  reg('legit.deleteChangelist', async (group?: vscode.SourceControlResourceGroup) => {
    const id = await resolveChangelistId(store, group);
    if (!id) return;
    if (id === DEFAULT_CHANGELIST_ID) {
      vscode.window.showWarningMessage('legit: the default changelist cannot be deleted.');
      return;
    }
    await store.remove(id);
  });

  reg('legit.setActiveChangelist', async (group?: vscode.SourceControlResourceGroup) => {
    const id = await resolveChangelistId(store, group);
    if (id) await store.setActive(id);
  });

  reg(
    'legit.moveToChangelist',
    async (state?: vscode.SourceControlResourceState, selected?: vscode.SourceControlResourceState[]) => {
      const states = selected?.length ? selected : state ? [state] : [];
      if (!states.length) return;

      type Pick = vscode.QuickPickItem & { id: string };
      const items: Pick[] = store.changelists
        .filter((c) => c.id !== store.activeId)
        .map((c) => ({ label: c.name, id: c.id }));
      items.push({ label: '$(add) New changelist…', id: '__new__' });

      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Move to changelist' });
      if (!pick) return;

      let targetId = pick.id;
      if (targetId === '__new__') {
        const name = await vscode.window.showInputBox({ prompt: 'New changelist name' });
        if (!name) return;
        targetId = (await store.create(name.trim())).id;
      }
      await store.assign(states.map((s) => scm.relPath(s.resourceUri)), targetId);
    },
  );

  reg('legit.commitChangelist', (arg?: unknown) => commitFlow(git, store, scm, arg, false));
  reg('legit.commitAndPush', (arg?: unknown) => commitFlow(git, store, scm, arg, true));

  await scm.refresh();
}

async function resolveChangelistId(
  store: ChangelistStore,
  group?: vscode.SourceControlResourceGroup,
): Promise<string | undefined> {
  if (group && 'id' in group && store.getChangelist(group.id)) return group.id;
  const pick = await vscode.window.showQuickPick(
    store.changelists.map((c) => ({ label: c.name, id: c.id })),
    { placeHolder: 'Select changelist' },
  );
  return pick?.id;
}

async function commitFlow(
  git: Git,
  store: ChangelistStore,
  scm: ChangelistScm,
  arg: unknown,
  push: boolean,
): Promise<void> {
  // `arg` is a resource group (group context menu) or undefined (input box / title bar).
  const groupId =
    arg && typeof arg === 'object' && 'id' in arg && store.getChangelist((arg as { id: string }).id)
      ? (arg as { id: string }).id
      : store.activeId;

  const message = scm.inputMessage.trim();
  if (!message) {
    vscode.window.showWarningMessage('legit: enter a commit message first.');
    return;
  }

  const paths = scm.pathsInChangelist(groupId);
  if (paths.length === 0) {
    vscode.window.showWarningMessage('legit: no changes in this changelist.');
    return;
  }

  try {
    await git.add(paths);
    await git.commit(message, paths);
    scm.clearInput();
    if (push) {
      await git.push();
      vscode.window.showInformationMessage(`legit: committed & pushed ${paths.length} file(s).`);
    } else {
      vscode.window.showInformationMessage(`legit: committed ${paths.length} file(s).`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`legit: ${msg}`);
  } finally {
    await scm.refresh();
  }
}

export function deactivate(): void {}
