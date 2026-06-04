import * as vscode from 'vscode';
import { Git } from '../git/git';

/** URI scheme backing the left (HEAD) side of working-tree diffs. */
export const HEAD_SCHEME = 'legit-head';
/** URI scheme serving an arbitrary revision of a file (query = rev, path = file). */
export const REV_SCHEME = 'legit-rev';

/**
 * Registers the content providers that serve git blobs for diffs: HEAD for the
 * working tree, and arbitrary revisions for the Log. We deliberately do NOT create
 * a SourceControl -- legit's UI is the bottom panel, and registering an SCM
 * provider only added a confusing empty "legit" entry to the Source Control view.
 */
export function registerContentProviders(git: Git): vscode.Disposable {
  const head = vscode.workspace.registerTextDocumentContentProvider(HEAD_SCHEME, {
    provideTextDocumentContent: (uri) => git.showHead(uri.query),
  });
  const rev = vscode.workspace.registerTextDocumentContentProvider(REV_SCHEME, {
    provideTextDocumentContent: (uri) => git.showRev(uri.query, uri.path.replace(/^\//, '')),
  });
  return vscode.Disposable.from(head, rev);
}
