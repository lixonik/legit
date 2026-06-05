import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface FileChange {
  /** Path relative to the repo root, forward-slash separated. */
  path: string;
  /** Original path for renames/copies. */
  origPath?: string;
  /** Two-letter porcelain status code, e.g. ' M', '??', 'A ', 'R '. */
  status: string;
  staged: boolean;
  untracked: boolean;
}

export interface LogCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface CommitFile {
  status: string;
  path: string;
  origPath?: string;
}

/** Thin wrapper over the git CLI, scoped to a single repository root. */
export class Git {
  constructor(public readonly repoRoot: string) {}

  async raw(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  }

  static async findRepoRoot(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        windowsHide: true,
      });
      const root = stdout.trim();
      return root || undefined;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<FileChange[]> {
    const out = await this.raw(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return parseStatus(out);
  }

  async currentBranch(): Promise<string> {
    try {
      return (await this.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    } catch {
      return '';
    }
  }

  /** Stage adds/modifications/deletions for the given paths. */
  async add(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.raw(['add', '-A', '--', ...paths]);
  }

  /**
   * Commit exactly the given paths. Passing the pathspec to `commit` performs a
   * partial commit limited to those files, so changes staged elsewhere are left
   * untouched -- matching JetBrains "commit only this changelist" semantics.
   */
  async commit(message: string, paths: string[], opts: { amend?: boolean } = {}): Promise<void> {
    const args = ['commit', '-m', message];
    if (opts.amend) args.push('--amend');
    if (paths.length) args.push('--', ...paths);
    await this.raw(args);
  }

  async push(): Promise<string> {
    return this.raw(['push']);
  }

  /** Contents of a path at HEAD, or '' if it does not exist there (new file). */
  async showHead(relPath: string): Promise<string> {
    try {
      return await this.raw(['show', `HEAD:${relPath}`]);
    } catch {
      return '';
    }
  }

  async hasUpstream(): Promise<boolean> {
    try {
      await this.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
      return true;
    } catch {
      return false;
    }
  }

  /** Commits across all refs, newest first, for the Log graph. */
  async log(limit = 400): Promise<LogCommit[]> {
    const FS = '\x1f';
    const RS = '\x1e';
    const fmt = ['%H', '%P', '%an', '%ae', '%cI', '%D', '%s'].join(FS) + RS;
    let out = '';
    try {
      out = await this.raw(['log', '--all', `--max-count=${limit}`, '--date-order', `--pretty=format:${fmt}`]);
    } catch {
      return [];
    }
    const commits: LogCommit[] = [];
    for (const rec of out.split(RS)) {
      const line = rec.replace(/^\s+/, '');
      if (!line) continue;
      const [hash, parents, author, email, date, refs, subject] = line.split(FS);
      commits.push({
        hash,
        parents: parents ? parents.split(' ').filter(Boolean) : [],
        author,
        email,
        date,
        subject: subject ?? '',
        refs: parseRefs(refs ?? ''),
      });
    }
    return commits;
  }

  /** Files changed by a commit, compared with its first parent. */
  async commitFiles(hash: string): Promise<CommitFile[]> {
    let out = '';
    try {
      out = await this.raw(['diff-tree', '--no-commit-id', '-r', '-z', '--name-status', hash]);
    } catch {
      return [];
    }
    const tokens = out.split('\0');
    const files: CommitFile[] = [];
    let i = 0;
    while (i < tokens.length) {
      const status = tokens[i];
      if (!status) {
        i++;
        continue;
      }
      const code = status[0];
      if (code === 'R' || code === 'C') {
        const from = tokens[i + 1];
        const to = tokens[i + 2];
        if (to === undefined) break;
        files.push({ status: code, path: normalize(to), origPath: normalize(from) });
        i += 3;
      } else {
        const p = tokens[i + 1];
        if (p === undefined) break;
        files.push({ status: code, path: normalize(p) });
        i += 2;
      }
    }
    return files;
  }

  async commitBody(hash: string): Promise<string> {
    try {
      return (await this.raw(['show', '-s', '--format=%B', hash])).replace(/\s+$/, '');
    } catch {
      return '';
    }
  }

  /** Contents of a path at an arbitrary revision (empty if absent). */
  async showRev(rev: string, relPath: string): Promise<string> {
    if (!rev) return '';
    try {
      return await this.raw(['show', `${rev}:${relPath}`]);
    } catch {
      return '';
    }
  }

  async branches(): Promise<{ current: string; locals: string[]; remotes: string[] }> {
    const current = await this.currentBranch();
    const l = await this.raw(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).catch(() => '');
    const r = await this.raw(['for-each-ref', '--format=%(refname:short)', 'refs/remotes']).catch(() => '');
    const locals = l.split('\n').map((s) => s.trim()).filter(Boolean);
    const remotes = r
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((x) => !x.endsWith('/HEAD'));
    return { current, locals, remotes };
  }

  async checkout(ref: string): Promise<void> {
    await this.raw(['checkout', ref]);
  }
  async checkoutNew(name: string, from?: string): Promise<void> {
    const args = ['checkout', '-b', name];
    if (from) args.push(from);
    await this.raw(args);
  }
  async mergeBranch(ref: string): Promise<void> {
    await this.raw(['merge', ref]);
  }
  async rebaseOnto(ref: string): Promise<void> {
    await this.raw(['rebase', ref]);
  }
  async deleteBranch(name: string, force = false): Promise<void> {
    await this.raw(['branch', force ? '-D' : '-d', name]);
  }
  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.raw(['branch', '-m', oldName, newName]);
  }

  async cherryPick(hash: string): Promise<void> {
    await this.raw(['cherry-pick', hash]);
  }
  async revert(hash: string): Promise<void> {
    await this.raw(['revert', '--no-edit', hash]);
  }
  async reset(hash: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
    await this.raw(['reset', `--${mode}`, hash]);
  }

  /** Record untracked files in the index (intent-to-add) so they show up in a diff. */
  async addIntentToAdd(files: string[]): Promise<void> {
    if (!files.length) return;
    await this.raw(['add', '-N', '--', ...files]);
  }

  /** Unified diff of the given paths against HEAD (working tree vs HEAD). */
  async diffHead(files: string[]): Promise<string> {
    return this.raw(['diff', 'HEAD', '--', ...files]);
  }

  async applyPatch(patchPath: string): Promise<void> {
    await this.raw(['apply', '--whitespace=nowarn', patchPath]);
  }

  async fetch(): Promise<void> {
    await this.raw(['fetch', '--prune']);
  }
  async pull(rebase: boolean): Promise<void> {
    await this.raw(['pull', rebase ? '--rebase' : '--no-rebase']);
  }
  async pushSetUpstream(): Promise<void> {
    const b = await this.currentBranch();
    await this.raw(['push', '--set-upstream', 'origin', b]);
  }
  async aheadBehind(): Promise<{ ahead: number; behind: number } | null> {
    try {
      const out = await this.raw(['rev-list', '--left-right', '--count', '@{u}...HEAD']);
      const parts = out.trim().split(/\s+/).map((n) => parseInt(n, 10));
      return { behind: parts[0] || 0, ahead: parts[1] || 0 };
    } catch {
      return null;
    }
  }
  async outgoingSubjects(): Promise<string[]> {
    try {
      const out = await this.raw(['log', '--format=%h %s', '@{u}..HEAD']);
      return out.split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async headHash(): Promise<string> {
    try {
      return (await this.raw(['rev-parse', 'HEAD'])).trim();
    } catch {
      return '';
    }
  }
  async amendMessage(message: string): Promise<void> {
    await this.raw(['commit', '--amend', '-m', message]);
  }
  async undoLastCommit(): Promise<void> {
    await this.raw(['reset', '--soft', 'HEAD~1']);
  }

  async blame(relPath: string): Promise<{ hash: string; author: string; date: string }[]> {
    let out = '';
    try {
      out = await this.raw(['blame', '--line-porcelain', '--', relPath]);
    } catch {
      return [];
    }
    const result: { hash: string; author: string; date: string }[] = [];
    let hash = '';
    let author = '';
    let time = 0;
    for (const line of out.split('\n')) {
      if (/^[0-9a-f]{40} /.test(line)) {
        hash = line.slice(0, 8);
      } else if (line.startsWith('author ')) {
        author = line.slice(7);
      } else if (line.startsWith('author-time ')) {
        time = parseInt(line.slice(12), 10) || 0;
      } else if (line.startsWith('\t')) {
        const date = time ? new Date(time * 1000).toISOString().slice(0, 10) : '';
        result.push({ hash, author, date });
      }
    }
    return result;
  }

  async fileLog(
    relPath: string,
    limit = 100,
  ): Promise<{ hash: string; parent: string; author: string; date: string; subject: string }[]> {
    const FS = '\x1f';
    const RS = '\x1e';
    const fmt = ['%H', '%P', '%an', '%cI', '%s'].join(FS) + RS;
    let out = '';
    try {
      out = await this.raw(['log', `--max-count=${limit}`, `--pretty=format:${fmt}`, '--', relPath]);
    } catch {
      return [];
    }
    const res: { hash: string; parent: string; author: string; date: string; subject: string }[] = [];
    for (const rec of out.split(RS)) {
      const line = rec.replace(/^\s+/, '');
      if (!line) continue;
      const [hash, parents, author, date, subject] = line.split(FS);
      res.push({ hash, parent: parents ? parents.split(' ')[0] : '', author, date, subject: subject ?? '' });
    }
    return res;
  }
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function parseStatus(out: string): FileChange[] {
  const result: FileChange[] = [];
  if (!out) return result;
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry || entry.length < 3) continue;
    const x = entry[0];
    const status = entry.slice(0, 2);
    const pathField = entry.slice(3);
    let origPath: string | undefined;
    // For rename/copy, porcelain -z emits "<new>\0<old>"; consume the next token.
    if (x === 'R' || x === 'C') {
      origPath = tokens[++i];
    }
    const untracked = status === '??';
    const staged = x !== ' ' && x !== '?';
    result.push({
      path: normalize(pathField),
      origPath: origPath ? normalize(origPath) : undefined,
      status,
      staged,
      untracked,
    });
  }
  return result;
}

function parseRefs(s: string): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith('HEAD -> ') ? x.slice('HEAD -> '.length) : x));
}
