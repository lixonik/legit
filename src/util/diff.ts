export interface Hunk {
  header: string;
  lines: string[];
}

/** Split a unified diff into its file header and individual hunks. */
export function splitHunks(diff: string): { header: string; hunks: Hunk[] } {
  const lines = diff.split('\n');
  let i = 0;
  const header: string[] = [];
  while (i < lines.length && !lines[i].startsWith('@@')) {
    header.push(lines[i]);
    i++;
  }
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) {
      if (cur) hunks.push(cur);
      cur = { header: lines[i], lines: [lines[i]] };
    } else if (cur) {
      cur.lines.push(lines[i]);
    }
  }
  if (cur) hunks.push(cur);
  return { header: header.join('\n'), hunks };
}
