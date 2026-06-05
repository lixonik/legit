import * as vscode from 'vscode';
import * as fs from 'fs';
import { Repository } from '../model/repository';

/**
 * JetBrains-style three-pane conflict resolver: Yours (ours) on the left, an
 * editable Result in the centre, Theirs (incoming) on the right. The Result
 * starts from the working-tree file (with conflict markers); per-conflict and
 * whole-file accept buttons help build it. Apply writes the file and stages it.
 */
export async function showMergeResolver(
  context: vscode.ExtensionContext,
  repo: Repository,
  rel: string,
): Promise<void> {
  const [ours, theirs] = await Promise.all([repo.git.showStage(2, rel), repo.git.showStage(3, rel)]);
  let working = '';
  try {
    working = fs.readFileSync(repo.absUri(rel).fsPath, 'utf8');
  } catch {
    /* file may have been deleted on one side */
  }
  const name = rel.split('/').pop() ?? rel;

  const panel = vscode.window.createWebviewPanel('jegitMerge', `Merge: ${name}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  });
  panel.webview.html = html(panel.webview, context);

  panel.webview.onDidReceiveMessage(async (m: { type: string; content?: string }) => {
    if (m.type === 'ready') {
      panel.webview.postMessage({ type: 'init', ours, theirs, working });
      return;
    }
    if (m.type === 'cancel') {
      panel.dispose();
      return;
    }
    if (m.type === 'apply') {
      try {
        fs.writeFileSync(repo.absUri(rel).fsPath, m.content ?? '', 'utf8');
        await repo.git.add([rel]);
        vscode.window.showInformationMessage(`JeGit: resolved ${name}.`);
        panel.dispose();
      } catch (err) {
        vscode.window.showErrorMessage(`JeGit: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        await repo.refresh();
      }
    }
  });
}

function html(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const css = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'merge.css'));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'merge.js'));
  const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link href="${css}" rel="stylesheet" />
<title>Merge</title>
</head>
<body>
  <div class="toolbar">
    <button id="useYours" title="Resolve the next conflict using your side">◀ Use Yours (next)</button>
    <button id="useTheirs" title="Resolve the next conflict using the incoming side">Use Theirs (next) ▶</button>
    <span class="sep"></span>
    <button id="yours">Take all Yours</button>
    <button id="both">Take Both</button>
    <button id="theirs">Take all Theirs</button>
    <span class="spacer"></span>
    <button class="primary" id="apply">Apply &amp; Mark Resolved</button>
    <button id="cancel">Cancel</button>
  </div>
  <div class="panes">
    <div class="pane ours"><h4>Yours (current)</h4><pre class="code" id="oursPane"></pre></div>
    <div class="pane"><h4>Result (editable)</h4><textarea class="code" id="result" spellcheck="false"></textarea></div>
    <div class="pane theirs"><h4>Theirs (incoming)</h4><pre class="code" id="theirsPane"></pre></div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
}
