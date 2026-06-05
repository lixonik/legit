// Non-interactive editor used by legit for git rebase -i.
// Invoked two ways, distinguished by the first arg:
//   node rebase-editor.js seq <todo-file>   (GIT_SEQUENCE_EDITOR)
//   node rebase-editor.js msg <message-file> (GIT_EDITOR)
// It rewrites a single target commit's todo line (drop / fixup / reword) and,
// for reword, supplies the new message. Everything is driven by env vars so no
// interactive editor ever opens.
const fs = require('fs');

const mode = process.argv[2];
const file = process.argv[3];
if (!file) process.exit(0);

if (mode === 'seq') {
  // Full plan (reorder dialog): replace the whole todo with a prepared file.
  const planFile = process.env.LEGIT_REBASE_TODO_FILE;
  if (planFile) {
    fs.writeFileSync(file, fs.readFileSync(planFile, 'utf8'));
    process.exit(0);
  }
  const target = process.env.LEGIT_REBASE_TARGET || '';
  const action = process.env.LEGIT_REBASE_ACTION || '';
  if (!target || !action) process.exit(0);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    const m = /^pick\s+([0-9a-f]+)\s/.exec(line);
    if (m && target.startsWith(m[1])) {
      if (action === 'drop') continue;
      if (action === 'fixup') {
        out.push('fixup ' + line.slice(5));
        continue;
      }
      if (action === 'reword') {
        out.push('reword ' + line.slice(5));
        continue;
      }
    }
    out.push(line);
  }
  fs.writeFileSync(file, out.join('\n'));
} else if (mode === 'msg') {
  const msg = process.env.LEGIT_REBASE_MSG;
  if (msg != null && msg !== '') fs.writeFileSync(file, msg);
}
