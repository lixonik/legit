import { describe, it, expect } from 'vitest';
import { splitStaged } from '../src/util/stagingGroups';

describe('splitStaged', () => {
  it('separates staged, unstaged and untracked entries', () => {
    const r = splitStaged([
      { path: 'staged.ts', status: 'M ' },
      { path: 'unstaged.ts', status: ' M' },
      { path: 'new.txt', status: '??' },
      { path: 'added.ts', status: 'A ' },
      { path: 'gone.ts', status: ' D' },
    ]);
    expect(r.staged.map((e) => e.path)).toEqual(['staged.ts', 'added.ts']);
    expect(r.unstaged.map((e) => e.path)).toEqual(['unstaged.ts', 'gone.ts']);
    expect(r.untracked.map((e) => e.path)).toEqual(['new.txt']);
  });

  it('lists a file modified in both index and worktree (MM) in both groups', () => {
    const r = splitStaged([{ path: 'both.ts', status: 'MM' }]);
    expect(r.staged.map((e) => e.path)).toEqual(['both.ts']);
    expect(r.unstaged.map((e) => e.path)).toEqual(['both.ts']);
    expect(r.untracked).toHaveLength(0);
  });

  it('carries the per-side status letter', () => {
    const r = splitStaged([{ path: 'a.ts', status: 'AM' }]);
    expect(r.staged[0]).toEqual({ path: 'a.ts', letter: 'A' });
    expect(r.unstaged[0]).toEqual({ path: 'a.ts', letter: 'M' });
  });

  it('puts conflict statuses (UU/AA/DD) in both staged and unstaged', () => {
    for (const status of ['UU', 'AA', 'DD']) {
      const r = splitStaged([{ path: 'c.ts', status }]);
      expect(r.staged).toEqual([{ path: 'c.ts', letter: status[0] }]);
      expect(r.unstaged).toEqual([{ path: 'c.ts', letter: status[1] }]);
      expect(r.untracked).toHaveLength(0);
    }
  });

  it('pads a one-character status (only the index side set)', () => {
    const r = splitStaged([{ path: 'a.ts', status: 'M' }]);
    expect(r.staged).toEqual([{ path: 'a.ts', letter: 'M' }]);
    expect(r.unstaged).toHaveLength(0);
  });

  it('returns empty groups for empty input', () => {
    const r = splitStaged([]);
    expect(r.staged).toHaveLength(0);
    expect(r.unstaged).toHaveLength(0);
    expect(r.untracked).toHaveLength(0);
  });
});
