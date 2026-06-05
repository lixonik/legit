/** Convert a git remote URL (https or ssh/scp) to a browseable web base URL. */
export function toWebUrl(remote: string): string {
  if (!remote) return '';
  const s = remote.trim().replace(/\.git$/, '');
  // scp shorthand: user@host:owner/repo
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(s);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  // ssh://user@host/owner/repo  or  https://host/owner/repo
  const m = /^(?:ssh|https?):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/.exec(s);
  if (m) return `https://${m[1]}/${m[2]}`;
  return '';
}

export function commitWebUrl(web: string, hash: string): string {
  return web ? `${web}/commit/${hash}` : '';
}

export function fileWebUrl(web: string, branch: string, path: string): string {
  return web ? `${web}/blob/${encodeURIComponent(branch)}/${path}` : '';
}
