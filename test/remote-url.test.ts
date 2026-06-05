import { describe, it, expect } from 'vitest';
import { toWebUrl, commitWebUrl, fileWebUrl } from '../src/util/remoteUrl';

describe('toWebUrl', () => {
  it('https with .git', () => {
    expect(toWebUrl('https://github.com/u/r.git')).toBe('https://github.com/u/r');
  });
  it('scp shorthand', () => {
    expect(toWebUrl('git@github.com:u/r.git')).toBe('https://github.com/u/r');
  });
  it('ssh://', () => {
    expect(toWebUrl('ssh://git@gitlab.com/u/r.git')).toBe('https://gitlab.com/u/r');
  });
  it('empty or invalid', () => {
    expect(toWebUrl('')).toBe('');
    expect(toWebUrl('not-a-url')).toBe('');
  });
});

describe('commit and file urls', () => {
  it('commit url', () => {
    expect(commitWebUrl('https://github.com/u/r', 'abc123')).toBe('https://github.com/u/r/commit/abc123');
  });
  it('file url', () => {
    expect(fileWebUrl('https://github.com/u/r', 'main', 'src/a.ts')).toBe('https://github.com/u/r/blob/main/src/a.ts');
  });
});
