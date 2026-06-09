import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { parseNameStatusZ } from '../util/parse';

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert';

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

  /** Optional sink that receives each executed git command (for the Console tab). */
  commandLogger?: (line: string) => void;

  async raw(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: this.repoRoot,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      });
      this.commandLogger?.(`git ${args.join(' ')}`);
      return stdout;
    } catch (e) {
      this.commandLogger?.(`git ${args.join(' ')}  [failed]`);
      throw e;
    }
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

  /** Staging-area operations (for the optional index/staging mode). */
  async unstage(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.raw(['reset', '-q', 'HEAD', '--', ...paths]);
  }
  async stageAll(): Promise<void> {
    await this.raw(['add', '-A']);
  }
  async unstageAll(): Promise<void> {
    await this.raw(['reset', '-q', 'HEAD']);
  }

  /**
   * Commit exactly the given paths. Passing the pathspec to `commit` performs a
   * partial commit limited to those files, so changes staged elsewhere are left
   * untouched -- matching JetBrains "commit only this changelist" semantics.
   */
  async commit(
    message: string,
    paths: string[],
    opts: { amend?: boolean; signoff?: boolean; author?: string } = {},
  ): Promise<void> {
    const args = ['commit', '-m', message];
    if (opts.amend) args.push('--amend');
    if (opts.signoff) args.push('--signoff');
    if (opts.author) args.push('--author', opts.author);
    if (paths.length) args.push('--', ...paths);
    await this.raw(args);
  }

  async push(): Promise<string> {
    return this.raw(['push']);
  }
  async pushForce(): Promise<void> {
    await this.raw(['push', '--force-with-lease']);
  }
  async pushTags(): Promise<void> {
    await this.raw(['push', '--tags']);
  }

  async remotesList(): Promise<{ name: string; url: string }[]> {
    let out = '';
    try {
      out = await this.raw(['remote', '-v']);
    } catch {
      return [];
    }
    const map = new Map<string, string>();
    for (const line of out.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
      if (m) map.set(m[1], m[2]);
    }
    return [...map].map(([name, url]) => ({ name, url }));
  }
  async remoteAdd(name: string, url: string): Promise<void> {
    await this.raw(['remote', 'add', name, url]);
  }
  async remoteRemove(name: string): Promise<void> {
    await this.raw(['remote', 'remove', name]);
  }
  async remoteRename(oldName: string, newName: string): Promise<void> {
    await this.raw(['remote', 'rename', oldName, newName]);
  }
  async remoteSetUrl(name: string, url: string): Promise<void> {
    await this.raw(['remote', 'set-url', name, url]);
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

  /** Commits for the Log graph; scope is `--all` or a branch ref. */
  async log(limit = 400, scope = '--all', pathFilter = ''): Promise<LogCommit[]> {
    const FS = '\x1f';
    const RS = '\x1e';
    const fmt = ['%H', '%P', '%an', '%ae', '%cI', '%D', '%s'].join(FS) + RS;
    const args = ['log', scope, `--max-count=${limit}`, '--date-order', `--pretty=format:${fmt}`];
    if (pathFilter) args.push('--', pathFilter);
    let out = '';
    try {
      out = await this.raw(args);
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
    return parseNameStatusZ(out);
  }

  async commitBody(hash: string): Promise<string> {
    try {
      return (await this.raw(['show', '-s', '--format=%B', hash])).replace(/\s+$/, '');
    } catch {
      return '';
    }
  }

  /** A single commit exported as a patch (git format-patch), for "Create Patch from commit". */
  async commitPatch(hash: string): Promise<string> {
    return this.raw(['format-patch', '-1', '--stdout', hash]);
  }

  /** Committer name and ISO date (shown in details when it differs from the author). */
  async commitCommitter(hash: string): Promise<{ name: string; date: string }> {
    try {
      const out = await this.raw(['show', '-s', '--format=%cn%x1f%cI', hash]);
      const [name, date] = out.trim().split('\x1f');
      return { name: name ?? '', date: date ?? '' };
    } catch {
      return { name: '', date: '' };
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

  /** Overwrite a file in the working tree with its content at a revision. */
  async restoreFile(rev: string, relPath: string): Promise<void> {
    await this.raw(['checkout', rev, '--', relPath]);
  }

  /** A conflicted file's stage content (1=base, 2=ours, 3=theirs); '' if absent. */
  async showStage(stage: 1 | 2 | 3, relPath: string): Promise<string> {
    try {
      return await this.raw(['show', `:${stage}:${relPath}`]);
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
  async mergeBranch(ref: string, mode: 'default' | 'no-ff' | 'squash' = 'default'): Promise<void> {
    const args = ['merge'];
    if (mode === 'no-ff') args.push('--no-ff');
    else if (mode === 'squash') args.push('--squash');
    args.push(ref);
    await this.raw(args);
  }
  async rebaseOnto(ref: string): Promise<void> {
    await this.raw(['rebase', ref]);
  }

  /** Detect an in-progress merge/rebase/cherry-pick/revert by inspecting the git dir. */
  async operationState(): Promise<GitOperation | null> {
    let gitDir = '';
    try {
      gitDir = (await this.raw(['rev-parse', '--absolute-git-dir'])).trim();
    } catch {
      return null;
    }
    const has = (p: string) => {
      try {
        return fs.existsSync(path.join(gitDir, p));
      } catch {
        return false;
      }
    };
    if (has('rebase-merge') || has('rebase-apply')) return 'rebase';
    if (has('MERGE_HEAD')) return 'merge';
    if (has('CHERRY_PICK_HEAD')) return 'cherry-pick';
    if (has('REVERT_HEAD')) return 'revert';
    return null;
  }

  async abortOperation(kind: GitOperation): Promise<void> {
    await this.raw([kind, '--abort']);
  }

  /** Continue an in-progress operation; uses a no-op editor so it never blocks. */
  async continueOperation(kind: GitOperation): Promise<void> {
    if (kind === 'merge') {
      await this.raw(['commit', '--no-edit']);
      return;
    }
    await execFileAsync('git', [kind, '--continue'], {
      cwd: this.repoRoot,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GIT_EDITOR: 'true' },
    });
    this.commandLogger?.(`git ${kind} --continue`);
  }

  async skipRebase(): Promise<void> {
    await this.raw(['rebase', '--skip']);
  }

  /** Push the current branch up to (and including) the given commit. */
  async pushUpTo(hash: string): Promise<void> {
    const branch = (await this.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    let remote = 'origin';
    try {
      const up = (await this.raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim();
      remote = up.split('/')[0] || 'origin';
    } catch {
      /* no upstream yet -- default to origin */
    }
    await this.raw(['push', remote, `${hash}:refs/heads/${branch}`]);
  }

  /** Local branches already merged into the current branch (excludes the current branch). */
  async mergedBranches(): Promise<string[]> {
    try {
      const out = await this.raw(['branch', '--merged']);
      return out
        .split('\n')
        .filter((l) => !l.startsWith('*'))
        .map((l) => l.trim())
        .filter((b) => b && !b.startsWith('('));
    } catch {
      return [];
    }
  }

  async worktrees(): Promise<{ path: string; branch: string; head: string }[]> {
    try {
      const out = await this.raw(['worktree', 'list', '--porcelain']);
      const list: { path: string; branch: string; head: string }[] = [];
      let cur: { path: string; branch: string; head: string } | null = null;
      for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (cur) list.push(cur);
          cur = { path: line.slice(9).trim(), branch: '', head: '' };
        } else if (cur && line.startsWith('HEAD ')) {
          cur.head = line.slice(5).trim();
        } else if (cur && line.startsWith('branch ')) {
          cur.branch = line.slice(7).trim().replace('refs/heads/', '');
        } else if (cur && line.trim() === 'detached') {
          cur.branch = '(detached)';
        }
      }
      if (cur) list.push(cur);
      return list;
    } catch {
      return [];
    }
  }
  async worktreeAdd(dir: string, ref: string): Promise<void> {
    await this.raw(['worktree', 'add', dir, ref]);
  }
  async worktreeAddNewBranch(dir: string, newBranch: string, base: string): Promise<void> {
    await this.raw(['worktree', 'add', '-b', newBranch, dir, base]);
  }
  async worktreeRemove(dir: string): Promise<void> {
    await this.raw(['worktree', 'remove', dir]);
  }
  async worktreePrune(): Promise<void> {
    await this.raw(['worktree', 'prune']);
  }

  /** All file paths present at a given revision (for "Browse Repository at Revision"). */
  async lsTree(rev: string, limit = 5000): Promise<string[]> {
    try {
      const out = await this.raw(['ls-tree', '-r', '--name-only', rev]);
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /** Tag names, newest first. */
  async tags(limit = 100): Promise<string[]> {
    try {
      const out = await this.raw(['tag', '--sort=-creatordate']);
      return out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, limit);
    } catch {
      return [];
    }
  }
  async deleteBranch(name: string, force = false): Promise<void> {
    await this.raw(['branch', force ? '-D' : '-d', name]);
  }
  async renameBranch(oldName: string, newName: string): Promise<void> {
    await this.raw(['branch', '-m', oldName, newName]);
  }
  async setUpstream(remoteRef: string): Promise<void> {
    await this.raw(['branch', `--set-upstream-to=${remoteRef}`]);
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

  /**
   * Apply a patch to the working tree, falling back to a 3-way merge when a
   * straight apply fails (e.g. the tree has diverged from when it was created).
   * A clean apply lands as unstaged working-tree changes; a 3-way merge leaves
   * conflict markers and unmerged entries for the resolver. Returns 'clean' or
   * 'conflicts'; throws only when the patch cannot be applied at all (so the
   * caller can keep a shelf rather than lose it).
   */
  async applyPatch3way(patchPath: string): Promise<'clean' | 'conflicts'> {
    try {
      await this.raw(['apply', '--whitespace=nowarn', patchPath]);
      return 'clean';
    } catch {
      /* straight apply failed -- fall back to a 3-way merge */
    }
    try {
      await this.raw(['apply', '--3way', '--whitespace=nowarn', patchPath]);
      return 'clean';
    } catch (e) {
      // --3way exits non-zero both when it applied with conflicts and when it
      // failed outright; distinguish by checking for unmerged index entries.
      const unmerged = await this.raw(['ls-files', '-u'])
        .then((o) => o.trim().length > 0)
        .catch(() => false);
      if (unmerged) return 'conflicts';
      throw e;
    }
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

  async blame(
    relPath: string,
  ): Promise<{ hash: string; author: string; email: string; date: string; summary: string }[]> {
    let out = '';
    try {
      out = await this.raw(['blame', '--line-porcelain', '--', relPath]);
    } catch {
      return [];
    }
    const result: { hash: string; author: string; email: string; date: string; summary: string }[] = [];
    let hash = '';
    let author = '';
    let email = '';
    let summary = '';
    let time = 0;
    for (const line of out.split('\n')) {
      if (/^[0-9a-f]{40} /.test(line)) {
        hash = line.slice(0, 40);
      } else if (line.startsWith('author ')) {
        author = line.slice(7);
      } else if (line.startsWith('author-mail ')) {
        email = line.slice(12).replace(/^<|>$/g, '');
      } else if (line.startsWith('author-time ')) {
        time = parseInt(line.slice(12), 10) || 0;
      } else if (line.startsWith('summary ')) {
        summary = line.slice(8);
      } else if (line.startsWith('\t')) {
        const date = time ? new Date(time * 1000).toISOString().slice(0, 10) : '';
        result.push({ hash, author, email, date, summary });
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

  async createTag(name: string, ref: string, message?: string): Promise<void> {
    const args = ['tag'];
    if (message) args.push('-a', name, '-m', message);
    else args.push(name);
    if (ref) args.push(ref);
    await this.raw(args);
  }

  async diffRefs(a: string, b: string): Promise<{ status: string; path: string }[]> {
    let out = '';
    try {
      out = await this.raw(['diff', '--name-status', '-z', a, b]);
    } catch {
      return [];
    }
    return parseNameStatusZ(out);
  }

  async applyCached(patchPath: string): Promise<void> {
    await this.raw(['apply', '--cached', '--whitespace=nowarn', patchPath]);
  }
  async commitIndex(message: string): Promise<void> {
    await this.raw(['commit', '-m', message]);
  }

  async isAncestor(a: string, b: string): Promise<boolean> {
    try {
      await this.raw(['merge-base', '--is-ancestor', a, b]);
      return true;
    } catch {
      return false;
    }
  }

  async rangeMessages(range: string): Promise<string> {
    try {
      return (await this.raw(['log', '--reverse', '--format=%B', range])).trim();
    } catch {
      return '';
    }
  }

  async stashPush(message: string): Promise<void> {
    const args = ['stash', 'push'];
    if (message) args.push('-m', message);
    await this.raw(args);
  }
  async stashList(): Promise<{ ref: string; subject: string }[]> {
    let out = '';
    try {
      out = await this.raw(['stash', 'list', '--format=%gd%x1f%gs']);
    } catch {
      return [];
    }
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [ref, subject] = l.split('\x1f');
        return { ref, subject: subject ?? '' };
      });
  }
  async stashApply(ref: string): Promise<void> {
    await this.raw(['stash', 'apply', ref]);
  }
  async stashPop(ref: string): Promise<void> {
    await this.raw(['stash', 'pop', ref]);
  }
  async stashDrop(ref: string): Promise<void> {
    await this.raw(['stash', 'drop', ref]);
  }
  async stashClear(): Promise<void> {
    await this.raw(['stash', 'clear']);
  }
  /** Create a new branch from the stash base and apply the stash onto it (git stash branch). */
  async stashBranch(name: string, ref: string): Promise<void> {
    await this.raw(['stash', 'branch', name, ref]);
  }

  async resetHard(ref: string): Promise<void> {
    await this.raw(['reset', '--hard', ref]);
  }

  /**
   * Run a single-commit interactive rebase action (drop / fixup / reword) using a
   * scripted sequence editor. If the rebase stops (e.g. a conflict), it is aborted
   * so the repository is never left mid-rebase.
   */
  async rebaseAction(
    base: string,
    target: string,
    action: 'drop' | 'fixup' | 'reword',
    scriptPath: string,
    message?: string,
  ): Promise<void> {
    const script = scriptPath.replace(/\\/g, '/');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_SEQUENCE_EDITOR: `node "${script}" seq`,
      GIT_EDITOR: `node "${script}" msg`,
      JEGIT_REBASE_TARGET: target,
      JEGIT_REBASE_ACTION: action,
    };
    if (message != null) env.JEGIT_REBASE_MSG = message;
    try {
      await execFileAsync('git', ['rebase', '-i', base], {
        cwd: this.repoRoot,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env,
      });
      this.commandLogger?.(`git rebase -i ${base} (${action} ${target.slice(0, 7)})`);
    } catch (e) {
      this.commandLogger?.(`git rebase -i ${base} (${action}) [failed -> abort]`);
      await this.raw(['rebase', '--abort']).catch(() => undefined);
      throw e;
    }
  }

  /** Commits in a range, oldest first, for the interactive-rebase dialog. */
  async rangeCommits(range: string): Promise<{ hash: string; subject: string }[]> {
    let out = '';
    try {
      out = await this.raw(['log', '--reverse', '--format=%H%x1f%s', range]);
    } catch {
      return [];
    }
    return out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [hash, subject] = l.split('\x1f');
        return { hash, subject: subject ?? '' };
      });
  }

  /** Run an interactive rebase from a full prepared todo file (reorder dialog). */
  async rebaseTodo(base: string, scriptPath: string, todoFile: string): Promise<void> {
    const script = scriptPath.replace(/\\/g, '/');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_SEQUENCE_EDITOR: `node "${script}" seq`,
      GIT_EDITOR: `node "${script}" msg`,
      JEGIT_REBASE_TODO_FILE: todoFile,
    };
    try {
      await execFileAsync('git', ['rebase', '-i', base], {
        cwd: this.repoRoot,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        env,
      });
      this.commandLogger?.(`git rebase -i ${base} (reorder)`);
    } catch (e) {
      this.commandLogger?.(`git rebase -i ${base} (reorder) [failed -> abort]`);
      await this.raw(['rebase', '--abort']).catch(() => undefined);
      throw e;
    }
  }
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

export function parseStatus(out: string): FileChange[] {
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

export function parseRefs(s: string): string[] {
  if (!s) return [];
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith('HEAD -> ') ? x.slice('HEAD -> '.length) : x));
}
