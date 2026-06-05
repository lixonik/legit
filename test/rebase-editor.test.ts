import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../media/rebase-editor.js');
const TODO = 'pick aaaaaaa c1\npick bbbbbbb c2\npick ccccccc c3\n';

function runSeq(todo: string, env: Record<string, string>): string {
  const f = path.join(os.tmpdir(), `jegit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(f, todo, 'utf8');
  try {
    execFileSync('node', [SCRIPT, 'seq', f], { env: { ...process.env, ...env } });
    return fs.readFileSync(f, 'utf8');
  } finally {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

describe('rebase-editor.js sequence editor', () => {
  it('drops the targeted commit line', () => {
    const out = runSeq(TODO, { JEGIT_REBASE_TARGET: 'bbbbbbb', JEGIT_REBASE_ACTION: 'drop' });
    expect(out).not.toContain('bbbbbbb');
    expect(out).toContain('aaaaaaa');
    expect(out).toContain('ccccccc');
  });

  it('changes the targeted line to fixup', () => {
    const out = runSeq(TODO, { JEGIT_REBASE_TARGET: 'ccccccc', JEGIT_REBASE_ACTION: 'fixup' });
    expect(out).toContain('fixup ccccccc c3');
    expect(out).toContain('pick aaaaaaa');
  });

  it('replaces the whole todo from a plan file', () => {
    const plan = path.join(os.tmpdir(), `jegit-plan-${Date.now()}.txt`);
    const planText = 'pick ccccccc c3\npick aaaaaaa c1\n';
    fs.writeFileSync(plan, planText, 'utf8');
    try {
      expect(runSeq(TODO, { JEGIT_REBASE_TODO_FILE: plan })).toBe(planText);
    } finally {
      fs.unlinkSync(plan);
    }
  });
});
