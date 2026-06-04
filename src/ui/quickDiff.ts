import * as vscode from 'vscode';
import * as path from 'path';
import { Git } from '../git/git';

/** URI scheme backing the left (HEAD) side of working-tree diffs and the gutter. */
export const HEAD_SCHEME = 'legit-head';
/** URI scheme serving an arbitrary revision of a file (query = rev, path = file). */
export const REV_SCHEME = 'legit-rev';

/**
 * Registers a minimal SourceControl purely so VS Code draws JetBrains-style change
 * bars in the editor gutter, plus the content providers that serve git blobs for
 * diffs (HEAD for the working tree, and arbitrary revisions for the Log).
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
  const head = vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, {
    provideTextDocumentContent: (uri) => git.showHead(uri.query),
  });
  const rev = vscode.workspace.registerTextDocumentContentProvider(REV_SCHEME, {
    provideTextDocumentContent: (uri) => git.showRev(uri.query, uri.path.replace(/^\//, '')),
  });
  return vscode.Disposable.from(sc, head, rev);
}
