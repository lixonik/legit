export interface NameStatus {
  /** Single-letter status code (M, A, D, R, C, ...). */
  status: string;
  /** Repo-relative path, forward-slash separated. */
  path: string;
  /** Original path for renames/copies. */
  origPath?: string;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Parse `git diff[-tree] --name-status -z` output (renames carry old + new). */
export function parseNameStatusZ(out: string): NameStatus[] {
  const tokens = out.split('\0');
  const files: NameStatus[] = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    if (!status) {
      i++;
      continue;
    }
    const code = status[0];
    if (code === 'R' || code === 'C') {
      const from = tokens[i + 1];
      const to = tokens[i + 2];
      if (to === undefined) break;
      files.push({ status: code, path: norm(to), origPath: norm(from) });
      i += 3;
    } else {
      const p = tokens[i + 1];
      if (p === undefined) break;
      files.push({ status: code, path: norm(p) });
      i += 2;
    }
  }
  return files;
}
