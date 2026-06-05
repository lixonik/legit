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
});

describe('parseRefs', () => {
  it('strips "HEAD ->" and keeps branches, remotes and tags', () => {
    expect(parseRefs('HEAD -> main, origin/main, tag: v1')).toEqual(['main', 'origin/main', 'tag: v1']);
  });

  it('returns empty for empty input', () => {
    expect(parseRefs('')).toEqual([]);
  });
});
