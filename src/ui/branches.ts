import * as vscode from 'vscode';
import { Repository } from '../model/repository';
import { REV_SCHEME } from './quickDiff';

type BranchItem = vscode.QuickPickItem & { ref?: string; action?: string; tag?: string };
type ActionItem = vscode.QuickPickItem & { a: string };

/** JetBrains-style Branches popup: pick a branch, then pick an action. */
export async function showBranches(repo: Repository): Promise<void> {
  const { current, locals, remotes } = await repo.git.branches();
  const items: BranchItem[] = [
    { label: '$(add) New Branch...', action: 'new' },
    { label: '$(tag) Checkout Tag or Revision...', action: 'checkoutRef' },
    { label: '$(trash) Clean Up Merged Branches...', action: 'cleanup' },
  ];

  const recent = (await repo.git.recentBranches(5)).filter((b) => b !== current && locals.includes(b));
  if (recent.length) {
    items.push({ label: 'Recent', kind: vscode.QuickPickItemKind.Separator });
    for (const b of recent) items.push({ label: '$(history) ' + b, ref: b });
  }
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
  const tags = await repo.git.tags(50);
  if (tags.length) {
    items.push({ label: 'Tags', kind: vscode.QuickPickItemKind.Separator });
    for (const t of tags) items.push({ label: '$(tag) ' + t, tag: t });
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Git branches (current: ${current})`,
    matchOnDescription: true,
  });
  if (!pick) return;
  if (pick.action === 'new') return newBranchFrom(repo, current);
  if (pick.action === 'checkoutRef') return checkoutRef(repo);
  if (pick.action === 'cleanup') {
    await vscode.commands.executeCommand('jegit.cleanupBranches');
    return;
  }
  if (pick.tag) return checkoutRef(repo, pick.tag);
  if (!pick.ref) return;
  await branchActions(repo, pick.ref, current, remotes.includes(pick.ref));
}

async function branchActions(repo: Repository, ref: string, current: string, isRemote: boolean): Promise<void> {
  const actions: ActionItem[] = [];
  if (ref !== current) {
    actions.push({ label: '$(check) Checkout', a: 'checkout' });
    actions.push({ label: '$(sync) Checkout and Update', a: 'checkoutUpdate' });
  }
  actions.push({ label: `$(git-branch) New Branch from ${ref}...`, a: 'newfrom' });
  if (ref !== current) {
    actions.push({ label: `$(git-merge) Merge ${ref} into ${current}`, a: 'merge' });
    actions.push({ label: `$(git-pull-request) Rebase ${current} onto ${ref}`, a: 'rebase' });
    actions.push({ label: '$(git-compare) Compare with Current', a: 'compare' });
  }
  if (!isRemote && ref !== current) {
    actions.push({ label: '$(edit) Rename...', a: 'rename' });
    actions.push({ label: '$(trash) Delete', a: 'delete' });
  }
  if (isRemote) {
    actions.push({ label: `$(link) Set as Upstream of ${current}`, a: 'setupstream' });
  }

  const pick = await vscode.window.showQuickPick(actions, { placeHolder: ref });
  if (!pick) return;
  await performBranchAction(repo, ref, current, isRemote, pick.a);
}

/** Run a named branch action; shared by the Branches popup and the Log branch context menu. */
export async function performBranchAction(
  repo: Repository,
  ref: string,
  current: string,
  isRemote: boolean,
  action: string,
): Promise<void> {
  try {
    switch (action) {
      case 'checkout':
        await repo.git.checkout(isRemote ? ref.substring(ref.indexOf('/') + 1) : ref);
        break;
      case 'checkoutUpdate':
        // Checkout the branch and update it from its tracked branch in one step.
        await repo.git.checkout(isRemote ? ref.substring(ref.indexOf('/') + 1) : ref);
        await repo.git.fetch().catch(() => undefined);
        await repo.git.pull(false);
        break;
      case 'newfrom':
        await newBranchFrom(repo, ref);
        return;
      case 'merge': {
        type MM = vscode.QuickPickItem & { mode: 'default' | 'no-ff' | 'squash' };
        const modes: MM[] = [
          { label: 'Merge', description: 'fast-forward when possible', mode: 'default' },
          { label: 'Merge (no fast-forward)', description: '--no-ff, always create a merge commit', mode: 'no-ff' },
          { label: 'Squash Merge', description: '--squash, stage changes without committing', mode: 'squash' },
        ];
        const mm = await vscode.window.showQuickPick(modes, { placeHolder: `Merge ${ref} into ${current}` });
        if (!mm) return;
        await repo.git.mergeBranch(ref, mm.mode);
        break;
      }
      case 'rebase':
        await repo.git.rebaseOnto(ref);
        break;
      case 'setupstream':
        await repo.git.setUpstream(ref);
        break;
      case 'compare': {
        const files = await repo.git.diffRefs(current, ref);
        if (!files.length) {
          vscode.window.showInformationMessage(`JeGit: no differences between ${current} and ${ref}.`);
          return;
        }
        type F = vscode.QuickPickItem & { path: string };
        const items: F[] = files.map((f) => ({ label: f.path, description: f.status, path: f.path }));
        const file = await vscode.window.showQuickPick(items, { placeHolder: `Changed files: ${current} <-> ${ref}` });
        if (!file) return;
        const left = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + file.path, query: current });
        const right = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + file.path, query: ref });
        const name = file.path.split('/').pop() ?? file.path;
        await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${current} <-> ${ref})`);
        return;
      }
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
    vscode.window.showInformationMessage(`JeGit: ${action} (${ref}) done.`);
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}

async function checkoutRef(repo: Repository, preset?: string): Promise<void> {
  const ref =
    preset ??
    (await vscode.window.showInputBox({
      prompt: 'Checkout tag or revision (detached HEAD)',
      placeHolder: 'v1.2.0 or a commit hash',
    }));
  if (!ref || !ref.trim()) return;
  try {
    await repo.git.checkout(ref.trim());
    vscode.window.showInformationMessage(`JeGit: checked out ${ref.trim()} (detached HEAD).`);
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}

async function newBranchFrom(repo: Repository, from: string): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: `New branch from ${from}`, placeHolder: 'feature/my-branch' });
  if (!name) return;
  try {
    await repo.git.checkoutNew(name.trim(), from);
    vscode.window.showInformationMessage(`JeGit: created and checked out ${name.trim()}.`);
  } catch (err) {
    vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await repo.refresh();
  }
}
