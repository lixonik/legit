import { describe, it, expect } from 'vitest';
import { ChangelistStore } from '../src/model/changelistStore';

function fakeMemento() {
  const store = new Map<string, unknown>();
  return {
    get: (k: string) => store.get(k),
    update: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    keys: () => [...store.keys()],
  } as never;
}

describe('ChangelistStore', () => {
  it('starts with a single active "Changes" list', () => {
    const s = new ChangelistStore(fakeMemento());
    expect(s.changelists).toHaveLength(1);
    expect(s.changelists[0].name).toBe('Changes');
    expect(s.activeId).toBe(s.changelists[0].id);
  });

  it('creates, renames and removes changelists', async () => {
    const s = new ChangelistStore(fakeMemento());
    const cl = await s.create('Feature');
    expect(s.changelists).toHaveLength(2);
    await s.rename(cl.id, 'Renamed');
    expect(s.getChangelist(cl.id)?.name).toBe('Renamed');
    await s.remove(cl.id);
    expect(s.getChangelist(cl.id)).toBeUndefined();
  });

  it('assigns files and falls back to the active list for unassigned paths', async () => {
    const s = new ChangelistStore(fakeMemento());
    const cl = await s.create('B');
    await s.assign(['a.ts'], cl.id);
    expect(s.changelistOf('a.ts')).toBe(cl.id);
    expect(s.changelistOf('unknown.ts')).toBe(s.activeId);
  });

  it('reconcile drops assignments for files no longer changed', async () => {
    const s = new ChangelistStore(fakeMemento());
    const cl = await s.create('B');
    await s.assign(['a.ts', 'b.ts'], cl.id);
    await s.reconcile(new Set(['a.ts']));
    expect(s.changelistOf('a.ts')).toBe(cl.id);
    expect(s.changelistOf('b.ts')).toBe(s.activeId);
  });

  it('persists across instances via the memento', async () => {
    const mem = fakeMemento();
    const cl = await new ChangelistStore(mem).create('Persisted');
    const reloaded = new ChangelistStore(mem);
    expect(reloaded.getChangelist(cl.id)?.name).toBe('Persisted');
  });
});
