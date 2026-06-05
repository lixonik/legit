import { describe, it, expect } from 'vitest';
import { splitHunks } from '../src/util/diff';

describe('splitHunks', () => {
  it('returns no hunks for an empty diff', () => {
    expect(splitHunks('').hunks).toHaveLength(0);
  });

  it('separates the file header from two hunks', () => {
    const diff = [
      'diff --git a/f b/f',
      'index 0000000..1111111 100644',
      '--- a/f',
      '+++ b/f',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -10,2 +10,2 @@',
      ' x',
      '-y',
      '+Y',
    ].join('\n');
    const { header, hunks } = splitHunks(diff);
    expect(header).toContain('--- a/f');
    expect(header).not.toContain('@@');
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe('@@ -1,2 +1,2 @@');
    expect(hunks[0].lines).toContain('+B');
    expect(hunks[1].lines).toContain('+Y');
  });
});
