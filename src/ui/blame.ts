import * as vscode from 'vscode';
import { Repository } from '../model/repository';

/** Toggleable per-line git blame annotation in the editor, like JetBrains Annotate. */
export class BlameController implements vscode.Disposable {
  private readonly deco = vscode.window.createTextEditorDecorationType({
    before: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 1.5em 0 0',
    },
  });
  private readonly annotated = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repo: Repository) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.annotated.has(e.document.uri.toString())) this.clear(e.document.uri);
      }),
    );
  }

  async toggle(editor?: vscode.TextEditor): Promise<void> {
    const ed = editor ?? vscode.window.activeTextEditor;
    if (!ed || ed.document.uri.scheme !== 'file') return;
    const key = ed.document.uri.toString();
    if (this.annotated.has(key)) {
      ed.setDecorations(this.deco, []);
      this.annotated.delete(key);
      return;
    }
    const rel = this.repo.relPathOf(ed.document.uri);
    if (rel.startsWith('..')) {
      vscode.window.showInformationMessage('JeGit: file is outside the repository.');
      return;
    }
    const blame = await this.repo.git.blame(rel);
    if (!blame.length) {
      vscode.window.showInformationMessage('JeGit: no blame information (file may be untracked).');
      return;
    }
    const lineCount = Math.min(ed.document.lineCount, blame.length);
    const options: vscode.DecorationOptions[] = [];
    for (let i = 0; i < lineCount; i++) {
      const b = blame[i];
      if (!b) continue;
      const args = encodeURIComponent(JSON.stringify([b.hash]));
      const md = new vscode.MarkdownString(
        `**${b.hash.slice(0, 8)}** · ${b.author} · ${b.date}\n\n[$(git-commit) Show Commit in Log](command:jegit.showCommitInLog?${args})`,
      );
      md.isTrusted = true;
      md.supportThemeIcons = true;
      options.push({
        range: new vscode.Range(i, 0, i, 0),
        renderOptions: { before: { contentText: `${b.date} ${shorten(b.author, 16)}` } },
        hoverMessage: md,
      });
    }
    ed.setDecorations(this.deco, options);
    this.annotated.add(key);
  }

  private clear(uri: vscode.Uri): void {
    const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString());
    if (ed) ed.setDecorations(this.deco, []);
    this.annotated.delete(uri.toString());
  }

  dispose(): void {
    this.deco.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
