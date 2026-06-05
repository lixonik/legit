import { describe, it, expect } from 'vitest';
import { parseNameStatusZ } from '../src/util/parse';

describe('parseNameStatusZ', () => {
  it('parses modified and added entries', () => {
    expect(parseNameStatusZ('M\0src/a.ts\0A\0b.txt\0')).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'A', path: 'b.txt' },
    ]);
  });

  it('parses a rename with similarity (old then new)', () => {
    expect(parseNameStatusZ('R100\0old/x.ts\0new/x.ts\0')).toEqual([
      { status: 'R', path: 'new/x.ts', origPath: 'old/x.ts' },
    ]);
  });

  it('normalises backslashes', () => {
    expect(parseNameStatusZ('M\0a\\b.ts\0')[0].path).toBe('a/b.ts');
  });

  it('returns empty for empty input', () => {
    expect(parseNameStatusZ('')).toEqual([]);
  });
});
