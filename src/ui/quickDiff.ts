import * as vscode from 'vscode';
import * as path from 'path';
import { Git } from '../git/git';

/** URI scheme backing the left (HEAD) side of diffs and the gutter quick-diff. */
export const HEAD_SCHEME = 'legit-head';

/**
 * Registers a minimal SourceControl purely so VS Code draws JetBrains-style change
 * bars in the editor gutter, plus the content provider that serves the HEAD blob.
 * The changelist UI itself lives in the webview, not in the SCM view.
 */
export function registerDiff(git: Git): vscode.Disposable {
  const sc = vscode.scm.createSourceControl('legit', 'legit', vscode.Uri.file(git.repoRoot));
  sc.quickDiffProvider = {
    provideOriginalResource: (uri) => {
      if (uri.scheme !== 'file') return undefined;
      const rel = path.relative(git.repoRoot, uri.fsPath).replace(/\\/g, '/');
      if (rel.startsWith('..')) return undefined;
      return uri.with({ scheme: HEAD_SCHEME, query: rel });
    },
  };
  const content = vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, {
    provideTextDocumentContent: (uri) => git.showHead(uri.query),
  });
  return vscode.Disposable.from(sc, content);
}
