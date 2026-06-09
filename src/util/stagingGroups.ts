/** Split porcelain status entries into staged / unstaged / untracked groups
 *  for the optional index/staging-area mode. A file modified both in the index
 *  and the working tree (e.g. "MM") appears in both staged and unstaged. */
export interface StagedEntry {
  path: string;
  letter: string;
}
export interface StagedSplit {
  staged: StagedEntry[];
  unstaged: StagedEntry[];
  untracked: { path: string }[];
}

export function splitStaged(items: { path: string; status: string }[]): StagedSplit {
  const staged: StagedEntry[] = [];
  const unstaged: StagedEntry[] = [];
  const untracked: { path: string }[] = [];
  for (const it of items) {
    const s = (it.status || '').padEnd(2, ' ');
    const x = s[0];
    const y = s[1];
    if (x === '?' || y === '?') {
      untracked.push({ path: it.path });
      continue;
    }
    if (x !== ' ') staged.push({ path: it.path, letter: x });
    if (y !== ' ') unstaged.push({ path: it.path, letter: y });
  }
  return { staged, unstaged, untracked };
}
