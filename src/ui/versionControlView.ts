import * as vscode from 'vscode';
import * as fs from 'fs';
import { Repository } from '../model/repository';
import { DEFAULT_CHANGELIST_ID } from '../model/changelistStore';
import { HEAD_SCHEME } from './quickDiff';

interface CommitMsg {
  type: 'commit';
  paths: string[];
  message: string;
  amend: boolean;
  push: boolean;
}
type Incoming =
  | { type: 'ready' | 'refresh' | 'newChangelist' }
  | { type: 'setActive' | 'renameChangelist' | 'deleteChangelist'; id: string }
  | { type: 'move'; paths: string[] }
  | { type: 'openDiff'; path: string; untracked: boolean }
  | { type: 'rollback'; items: { path: string; untracked: boolean }[] }
  | CommitMsg;

/** The JetBrains-style Version Control tool window, rendered as a webview. */
export class VersionControlView implements vscode.WebviewViewProvider {
  static readonly viewId = 'legit.versionControl';
  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repo: Repository,
  ) {
    this.repo.onDidChange(() => this.postState());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((m: Incoming) => void this.onMessage(m));
    view.onDidChangeVisibility(() => {
      if (view.visible) void this.repo.refresh();
    });
    void this.repo.refresh();
  }

  private postState(): void {
    this.view?.webview.postMessage({ type: 'state', payload: this.repo.view() });
  }

  private async onMessage(m: Incoming): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.postState();
        break;
      case 'refresh':
        await this.repo.refresh();
        break;
      case 'newChangelist': {
        const name = await vscode.window.showInputBox({ prompt: 'New changelist name', placeHolder: 'Feature X' });
        if (name) await this.repo.newChangelist(name.trim());
        break;
      }
      case 'renameChangelist': {
        const cl = this.repo.store.getChangelist(m.id);
        const name = await vscode.window.showInputBox({ prompt: 'Rename changelist', value: cl?.name });
        if (name) await this.repo.rename(m.id, name.trim());
        break;
      }
      case 'deleteChangelist':
        if (m.id === DEFAULT_CHANGELIST_ID) {
          vscode.window.showWarningMessage('legit: the default changelist cannot be deleted.');
        } else {
          await this.repo.remove(m.id);
        }
        break;
      case 'setActive':
        await this.repo.setActive(m.id);
        break;
      case 'move':
        await this.moveToChangelist(m.paths);
        break;
      case 'openDiff':
        await this.openDiff(m.path, m.untracked);
        break;
      case 'rollback':
        await this.rollback(m.items);
        break;
      case 'commit':
        await this.commit(m);
        break;
    }
  }

  private async commit(m: CommitMsg): Promise<void> {
    if (!m.paths?.length) {
      vscode.window.showWarningMessage('legit: select at least one file to commit.');
      return;
    }
    if (!m.message?.trim()) {
      vscode.window.showWarningMessage('legit: enter a commit message first.');
      return;
    }
    try {
      await this.repo.commit(m.paths, m.message.trim(), { amend: m.amend, push: m.push });
      this.view?.webview.postMessage({ type: 'committed' });
      vscode.window.showInformationMessage(
        `legit: committed ${m.paths.length} file(s)${m.push ? ' and pushed' : ''}.`,
      );
    } catch (err) {
      vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async moveToChangelist(paths: string[]): Promise<void> {
    if (!paths?.length) return;
    type Item = vscode.QuickPickItem & { id: string };
    const items: Item[] = this.repo.store.changelists
      .filter((c) => c.id !== this.repo.store.activeId)
      .map((c) => ({ label: c.name, id: c.id }));
    items.push({ label: '$(add) New changelist...', id: '__new__' });
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Move to changelist' });
    if (!pick) return;
    let id = pick.id;
    if (id === '__new__') {
      const name = await vscode.window.showInputBox({ prompt: 'New changelist name' });
      if (!name) return;
      id = (await this.repo.newChangelist(name.trim(), false)).id;
    }
    await this.repo.move(paths, id);
  }

  private async rollback(items: { path: string; untracked: boolean }[]): Promise<void> {
    if (!items?.length) return;
    const confirm = await vscode.window.showWarningMessage(
      `Rollback ${items.length} file(s)? Local changes will be lost.`,
      { modal: true },
      'Rollback',
    );
    if (confirm !== 'Rollback') return;
    const tracked = items.filter((i) => !i.untracked).map((i) => i.path);
    const untracked = items.filter((i) => i.untracked).map((i) => i.path);
    try {
      if (tracked.length) await this.repo.git.raw(['checkout', 'HEAD', '--', ...tracked]);
      for (const rel of untracked) {
        try {
          fs.unlinkSync(this.repo.absUri(rel).fsPath);
        } catch {
          /* already gone */
        }
      }
    } catch (err) {
      vscode.window.showErrorMessage(`legit: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await this.repo.refresh();
    }
  }

  private async openDiff(rel: string, untracked: boolean): Promise<void> {
    const abs = this.repo.absUri(rel);
    if (untracked) {
      await vscode.commands.executeCommand('vscode.open', abs);
      return;
    }
    const head = abs.with({ scheme: HEAD_SCHEME, query: rel });
    const name = rel.split('/').pop() ?? rel;
    await vscode.commands.executeCommand('vscode.diff', head, abs, `${name} (HEAD <-> Working Tree)`);
  }

  private html(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vcs.css'));
    const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'vcs.js'));
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link href="${cssUri}" rel="stylesheet" />
<title>legit</title>
</head>
<body>
  <div class="tabbar">
    <div class="tab active" data-tab="local">Local Changes</div>
    <div class="tab" data-tab="log">Log</div>
    <div class="tab" data-tab="shelf">Shelf</div>
    <div class="tab" data-tab="console">Console</div>
    <div class="branch" id="branch"></div>
  </div>
  <div class="tabpanel active" data-tab="local">
    <div class="toolbar">
      <button class="tool" id="tb-focus" title="Focus commit message">✓</button>
      <button class="tool" id="tb-refresh" title="Refresh">⟳</button>
      <button class="tool" id="tb-new" title="New changelist">＋</button>
      <span class="sep"></span>
      <button class="tool" id="tb-rollback" title="Rollback selected">↶</button>
      <span class="sep"></span>
      <button class="tool" id="tb-expand" title="Expand all">⊞</button>
      <button class="tool" id="tb-collapse" title="Collapse all">⊟</button>
    </div>
    <div class="tree" id="tree"></div>
    <div class="commit-area">
      <textarea id="message" placeholder="Commit Message" rows="2"></textarea>
      <div class="commit-row">
        <label class="opt"><input type="checkbox" id="amend" /> Amend</label>
        <span class="selinfo" id="selinfo"></span>
        <span class="spacer"></span>
        <button class="btn secondary" id="commit" disabled>Commit</button>
        <button class="btn primary" id="commitPush" disabled>Commit and Push</button>
      </div>
    </div>
  </div>
  <div class="tabpanel" data-tab="log"><div class="placeholder">Commit graph / Log: coming next.</div></div>
  <div class="tabpanel" data-tab="shelf"><div class="placeholder">Shelf (shelved changes): coming soon.</div></div>
  <div class="tabpanel" data-tab="console"><div class="placeholder">Git console: coming soon.</div></div>
  <div class="ctx-menu" id="ctxmenu"></div>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}
