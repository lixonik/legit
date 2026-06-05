import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The three-pane merge resolver lives in media/merge.js (a browser IIFE that
// cannot be imported directly). To guard the actual shipped regex against
// regressions, we extract its source from the file and exercise it here.
const src = readFileSync(join(__dirname, '..', 'media', 'merge.js'), 'utf8');
const match = src.match(/const re = (\/[^\n]*\/);/);
if (!match) throw new Error('could not find the conflict regex in media/merge.js');
// eslint-disable-next-line no-eval
const re: RegExp = (0, eval)(match[1]);

/** Mirror of resolveNext(): replace the next conflict block with the chosen side. */
function resolve(text: string, side: 1 | 2): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const repl = side === 1 ? m[1] : m[2];
  return text.slice(0, m.index) + repl + text.slice(m.index + m[0].length);
}

describe('merge resolver conflict regex (media/merge.js)', () => {
  it('resolves a standard conflict to either side', () => {
    const t = 'a\n<<<<<<< HEAD\nours line\n=======\ntheirs line\n>>>>>>> branch\nb\n';
    expect(resolve(t, 1)).toBe('a\nours line\nb\n');
    expect(resolve(t, 2)).toBe('a\ntheirs line\nb\n');
  });

  it('resolves a conflict with an empty "ours" side (deletion/addition)', () => {
    const t = 'a\n<<<<<<< HEAD\n=======\ntheirs line\n>>>>>>> branch\nb\n';
    expect(resolve(t, 1)).toBe('a\nb\n');
    expect(resolve(t, 2)).toBe('a\ntheirs line\nb\n');
  });

  it('resolves a conflict with an empty "theirs" side', () => {
    const t = 'a\n<<<<<<< HEAD\nours line\n=======\n>>>>>>> branch\nb\n';
    expect(resolve(t, 1)).toBe('a\nours line\nb\n');
    expect(resolve(t, 2)).toBe('a\nb\n');
  });

  it('discards the base section of a diff3-style conflict', () => {
    const t = 'a\n<<<<<<< HEAD\nours\n||||||| base\nbasecontent\n=======\ntheirs\n>>>>>>> branch\nb\n';
    expect(resolve(t, 1)).toBe('a\nours\nb\n');
    expect(resolve(t, 2)).toBe('a\ntheirs\nb\n');
  });

  it('handles multi-line sides', () => {
    const t = '<<<<<<< HEAD\no1\no2\n=======\nt1\nt2\n>>>>>>> x\n';
    expect(resolve(t, 1)).toBe('o1\no2\n');
    expect(resolve(t, 2)).toBe('t1\nt2\n');
  });
});
