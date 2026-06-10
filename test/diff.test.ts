import { describe, it, expect } from 'vitest';
import { splitHunks } from '../src/util/diff';

describe('splitHunks', () => {
  it('returns no hunks for an empty diff', () => {
    expect(splitHunks('').hunks).toHaveLength(0);
  });

  it('keeps the @@ line as the first element of the hunk body', () => {
    const diff = ['--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '+b'].join('\n');
    const { hunks } = splitHunks(diff);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines[0]).toBe('@@ -1 +1 @@');
    expect(hunks[0].lines).toEqual(['@@ -1 +1 @@', '-a', '+b']);
  });

  it('preserves the "No newline at end of file" marker inside a hunk', () => {
    const diff = ['--- a/f', '+++ b/f', '@@ -1 +1 @@', '-a', '+b', '\\ No newline at end of file'].join('\n');
    const { hunks } = splitHunks(diff);
    expect(hunks[0].lines).toContain('\\ No newline at end of file');
  });

  it('handles a whole-file addition as a single hunk', () => {
    const diff = ['--- /dev/null', '+++ b/new', '@@ -0,0 +1,2 @@', '+one', '+two'].join('\n');
    const { header, hunks } = splitHunks(diff);
    expect(header).toContain('/dev/null');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toEqual(['@@ -0,0 +1,2 @@', '+one', '+two']);
  });

  it('ignores lines before the first hunk by putting them in the header', () => {
    const diff = ['diff --git a/f b/f', 'similarity index 100%', '@@ -1 +1 @@', ' a'].join('\n');
    const { header, hunks } = splitHunks(diff);
    expect(header).toBe('diff --git a/f b/f\nsimilarity index 100%');
    expect(hunks).toHaveLength(1);
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
