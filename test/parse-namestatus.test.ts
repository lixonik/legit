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

  it('parses a copy with similarity (old then new)', () => {
    expect(parseNameStatusZ('C75\0src.ts\0dst.ts\0')).toEqual([
      { status: 'C', path: 'dst.ts', origPath: 'src.ts' },
    ]);
  });

  it('parses a deleted entry', () => {
    expect(parseNameStatusZ('D\0gone.ts\0')).toEqual([{ status: 'D', path: 'gone.ts' }]);
  });

  it('steps correctly through a rename followed by a regular entry', () => {
    expect(parseNameStatusZ('R100\0old.ts\0new.ts\0M\0a.ts\0')).toEqual([
      { status: 'R', path: 'new.ts', origPath: 'old.ts' },
      { status: 'M', path: 'a.ts' },
    ]);
  });

  it('parses input without a trailing NUL', () => {
    expect(parseNameStatusZ('M\0a.ts')).toEqual([{ status: 'M', path: 'a.ts' }]);
  });

  it('normalises backslashes', () => {
    expect(parseNameStatusZ('M\0a\\b.ts\0')[0].path).toBe('a/b.ts');
  });

  it('returns empty for empty input', () => {
    expect(parseNameStatusZ('')).toEqual([]);
  });
});
