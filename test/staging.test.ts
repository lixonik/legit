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
});
