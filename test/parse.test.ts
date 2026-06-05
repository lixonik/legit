import { describe, it, expect } from 'vitest';
import { parseStatus, parseRefs } from '../src/git/git';

describe('parseStatus', () => {
  it('parses modified, untracked and rename entries (NUL-separated porcelain -z)', () => {
    const out = ' M src/a.ts\0?? new.txt\0R  to.ts\0from.ts\0';
    const r = parseStatus(out);
    expect(r).toHaveLength(3);
    expect(r[0]).toMatchObject({ path: 'src/a.ts', status: ' M', untracked: false });
    expect(r[1]).toMatchObject({ path: 'new.txt', status: '??', untracked: true });
    expect(r[2]).toMatchObject({ path: 'to.ts', origPath: 'from.ts', status: 'R ' });
  });

  it('normalises backslashes to forward slashes', () => {
    const r = parseStatus(' M src\\a\\b.ts\0');
    expect(r[0].path).toBe('src/a/b.ts');
  });

  it('returns empty for empty input', () => {
    expect(parseStatus('')).toHaveLength(0);
  });

  it('flags conflict statuses (UU/AA/DD) without treating them as untracked', () => {
    const r = parseStatus('UU both.ts\0AA added.ts\0DD gone.ts\0');
    expect(r.map((c) => c.status)).toEqual(['UU', 'AA', 'DD']);
    expect(r.every((c) => !c.untracked)).toBe(true);
    expect(r.every((c) => c.staged)).toBe(true);
  });

  it('sets the staged flag from the index column, not the worktree column', () => {
    const r = parseStatus('M  staged.ts\0 M worktree.ts\0');
    expect(r[0]).toMatchObject({ path: 'staged.ts', status: 'M ', staged: true });
    expect(r[1]).toMatchObject({ path: 'worktree.ts', status: ' M', staged: false });
  });

  it('parses a copy entry and consumes its source path', () => {
    const r = parseStatus('C  copy.ts\0orig.ts\0');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ path: 'copy.ts', origPath: 'orig.ts', status: 'C ' });
  });
});

describe('parseRefs', () => {
  it('strips "HEAD ->" and keeps branches, remotes and tags', () => {
    expect(parseRefs('HEAD -> main, origin/main, tag: v1')).toEqual(['main', 'origin/main', 'tag: v1']);
  });

  it('returns empty for empty input', () => {
    expect(parseRefs('')).toEqual([]);
  });
});
