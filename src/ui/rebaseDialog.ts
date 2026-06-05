import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Repository } from '../model/repository';

/**
 * A small webview dialog for interactive rebase: reorder the commits from the
 * selected one up to HEAD and choose pick / fixup / drop per commit. The plan is
 * applied via a scripted sequence editor; the rebase auto-aborts on conflict.
 */
export async function showRebaseDialog(
  context: vscode.ExtensionContext,
  repo: Repository,
  baseHash: string,
): Promise<void> {
  const base = `${baseHash}~1`;
  const commits = await repo.git.rangeCommits(`${base}..HEAD`);
  if (!commits.length) {
    vscode.window.showInformationMessage('JeGit: nothing to rebase from here (or this is the root commit).');
    return;
  }

  const panel = vscode.window.createWebviewPanel('jegitRebase', 'Interactive Rebase', vscode.ViewColumn.Active, {
    enableScripts: true,
  });
  panel.webview.html = html(commits);

  panel.webview.onDidReceiveMessage(async (m: { type: string; plan?: { hash: string; action: string }[] }) => {
    if (m.type === 'cancel') {
      panel.dispose();
      return;
    }
    if (m.type !== 'start' || !m.plan) return;

    const kept = m.plan.filter((p) => p.action !== 'drop');
    if (!kept.length) {
      vscode.window.showWarningMessage('JeGit: keep at least one commit.');
      return;
    }
    if (kept[0].action !== 'pick') {
      vscode.window.showWarningMessage('JeGit: the first kept commit must be "pick".');
      return;
    }

    const todo = m.plan.map((p) => `${p.action} ${p.hash}`).join('\n') + '\n';
    const tmp = path.join(os.tmpdir(), `jegit-rebase-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmp, todo, 'utf8');
      const script = vscode.Uri.joinPath(context.extensionUri, 'media', 'rebase-editor.js').fsPath;
      await repo.git.rebaseTodo(base, script, tmp);
      vscode.window.showInformationMessage('JeGit: rebase applied.');
      panel.dispose();
    } catch (err) {
      vscode.window.showErrorMessage(
        `JeGit: rebase could not be applied cleanly (${err instanceof Error ? err.message : String(err)}); it was aborted.`,
      );
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      await repo.refresh();
    }
  });
}

function html(commits: { hash: string; subject: string }[]): string {
  const nonce = Math.random().toString(36).slice(2);
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  const data = JSON.stringify(commits.map((c) => ({ hash: c.hash, short: c.hash.slice(0, 7), subject: c.subject }))).replace(
    /</g,
    '\\u003c',
  );
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: "Segoe UI", sans-serif; font-size: 12px; color: #bbb; background: #3c3f41; padding: 10px; }
  h3 { margin: 0 0 8px; font-weight: 600; color: #ddd; }
  .hint { color: #888; margin-bottom: 8px; }
  .row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; background: #2b2b2b; border: 1px solid #323232; margin-bottom: 3px; border-radius: 3px; cursor: move; }
  .row.dragover { border-color: #4a88c7; }
  .grip { color: #6a6a6a; cursor: move; }
  .row select { background: #45494a; color: #bbb; border: 1px solid #5e6263; border-radius: 3px; padding: 1px 4px; }
  .mv { background: transparent; border: 1px solid #5e6263; color: #bbb; border-radius: 3px; cursor: pointer; width: 22px; }
  .mv:hover:not(:disabled) { background: #4b5052; }
  .mv:disabled { opacity: 0.4; cursor: default; }
  .hash { color: #6a8759; font-family: "Consolas", monospace; }
  .subj { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .drop .subj { text-decoration: line-through; color: #777; }
  .bar { margin-top: 10px; display: flex; gap: 8px; }
  button.primary { background: #365880; color: #fff; border: 1px solid #4c708c; border-radius: 3px; padding: 4px 12px; cursor: pointer; }
  button.secondary { background: transparent; color: #bbb; border: 1px solid #5e6263; border-radius: 3px; padding: 4px 12px; cursor: pointer; }
</style></head>
<body>
  <h3>Interactive Rebase</h3>
  <div class="hint">Drag rows (or use the arrows) to reorder, and choose an action per commit. Oldest is at the top. (Reword and Squash are available as single-commit actions in the Log.)</div>
  <div id="list"></div>
  <div class="bar">
    <button class="primary" id="start">Start Rebase</button>
    <button class="secondary" id="cancel">Cancel</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let rows = ${data}.map((c) => ({ ...c, action: 'pick' }));
    const list = document.getElementById('list');
    function render() {
      list.innerHTML = '';
      rows.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'row' + (r.action === 'drop' ? ' drop' : '');
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; };
        div.ondragover = (e) => { e.preventDefault(); div.classList.add('dragover'); };
        div.ondragleave = () => div.classList.remove('dragover');
        div.ondrop = (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          if (Number.isInteger(from) && from !== i) {
            const [moved] = rows.splice(from, 1);
            rows.splice(i, 0, moved);
            render();
          }
        };
        const grip = document.createElement('span');
        grip.className = 'grip';
        grip.textContent = '\\u2630';
        const up = document.createElement('button');
        up.className = 'mv'; up.textContent = '\\u2191'; up.disabled = i === 0;
        up.onclick = () => { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; render(); };
        const down = document.createElement('button');
        down.className = 'mv'; down.textContent = '\\u2193'; down.disabled = i === rows.length - 1;
        down.onclick = () => { [rows[i + 1], rows[i]] = [rows[i], rows[i + 1]]; render(); };
        const sel = document.createElement('select');
        ['pick', 'fixup', 'drop'].forEach((a) => {
          const o = document.createElement('option'); o.value = a; o.textContent = a;
          if (a === r.action) o.selected = true; sel.appendChild(o);
        });
        sel.onchange = () => { r.action = sel.value; render(); };
        const h = document.createElement('span'); h.className = 'hash'; h.textContent = r.short;
        const s = document.createElement('span'); s.className = 'subj'; s.textContent = r.subject;
        div.append(grip, up, down, sel, h, s);
        list.appendChild(div);
      });
    }
    document.getElementById('start').onclick = () =>
      vscode.postMessage({ type: 'start', plan: rows.map((r) => ({ hash: r.hash, action: r.action })) });
    document.getElementById('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });
    render();
  </script>
</body></html>`;
}
