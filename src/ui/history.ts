import * as vscode from 'vscode';
import { Repository } from '../model/repository';
import { REV_SCHEME } from './quickDiff';

/** Show a file's commit history as a quick pick; selecting a commit opens its diff. */
export async function showFileHistory(repo: Repository, rel: string): Promise<void> {
  const commits = await repo.git.fileLog(rel);
  if (!commits.length) {
    vscode.window.showInformationMessage('legit: no history for this file.');
    return;
  }
  type Item = vscode.QuickPickItem & { hash: string; parent: string };
  const items: Item[] = commits.map((c) => ({
    label: c.subject,
    description: `${c.author} · ${(c.date || '').slice(0, 10)}`,
    detail: c.hash.slice(0, 8),
    hash: c.hash,
    parent: c.parent,
  }));
  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `History of ${rel.split('/').pop()}`,
    matchOnDetail: true,
  });
  if (!pick) return;
  const name = rel.split('/').pop() ?? rel;
  const left = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + rel, query: pick.parent });
  const right = vscode.Uri.from({ scheme: REV_SCHEME, path: '/' + rel, query: pick.hash });
  const sh = (h: string) => (h ? h.slice(0, 7) : '∅');
  await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (${sh(pick.parent)} <-> ${sh(pick.hash)})`);
}
