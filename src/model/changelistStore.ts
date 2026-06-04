import * as vscode from 'vscode';

export interface Changelist {
  id: string;
  name: string;
}

interface PersistedState {
  changelists: Changelist[];
  activeId: string;
  /** Map of repo-relative file path -> changelist id. */
  assignments: Record<string, string>;
}

const STORAGE_KEY = 'legit.changelists.v1';
export const DEFAULT_CHANGELIST_ID = 'default';

/**
 * Holds the set of changelists and which file is assigned to which list.
 * Persisted in workspaceState (per-machine, never committed) -- the same place
 * JetBrains keeps changelists (workspace.xml), so they are an IDE-side concept
 * layered over git, not a git feature.
 */
export class ChangelistStore {
  private state: PersistedState;
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly memento: vscode.Memento) {
    const saved = memento.get<PersistedState>(STORAGE_KEY);
    if (saved && saved.changelists?.length) {
      this.state = saved;
      this.state.assignments ??= {};
      if (!this.getChangelist(this.state.activeId)) {
        this.state.activeId = this.state.changelists[0].id;
      }
    } else {
      this.state = {
        changelists: [{ id: DEFAULT_CHANGELIST_ID, name: 'Changes' }],
        activeId: DEFAULT_CHANGELIST_ID,
        assignments: {},
      };
    }
  }

  get changelists(): readonly Changelist[] {
    return this.state.changelists;
  }

  get activeId(): string {
    return this.state.activeId;
  }

  getChangelist(id: string): Changelist | undefined {
    return this.state.changelists.find((c) => c.id === id);
  }

  /** Which changelist a path belongs to; unassigned paths fall to the active list. */
  changelistOf(path: string): string {
    const assigned = this.state.assignments[path];
    if (assigned && this.getChangelist(assigned)) return assigned;
    return this.state.activeId;
  }

  async create(name: string): Promise<Changelist> {
    const id = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const cl: Changelist = { id, name };
    this.state.changelists.push(cl);
    await this.persist();
    return cl;
  }

  async rename(id: string, name: string): Promise<void> {
    const cl = this.getChangelist(id);
    if (cl) {
      cl.name = name;
      await this.persist();
    }
  }

  async remove(id: string): Promise<void> {
    if (id === DEFAULT_CHANGELIST_ID) return;
    this.state.changelists = this.state.changelists.filter((c) => c.id !== id);
    for (const [path, clId] of Object.entries(this.state.assignments)) {
      if (clId === id) delete this.state.assignments[path];
    }
    if (this.state.activeId === id) this.state.activeId = DEFAULT_CHANGELIST_ID;
    await this.persist();
  }

  async setActive(id: string): Promise<void> {
    if (this.getChangelist(id)) {
      this.state.activeId = id;
      await this.persist();
    }
  }

  async assign(paths: string[], changelistId: string): Promise<void> {
    for (const p of paths) {
      this.state.assignments[p] = changelistId;
    }
    await this.persist();
  }

  /** Drop assignments for files that are no longer changed. */
  async reconcile(existingPaths: Set<string>): Promise<void> {
    let changed = false;
    for (const p of Object.keys(this.state.assignments)) {
      if (!existingPaths.has(p)) {
        delete this.state.assignments[p];
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    await this.memento.update(STORAGE_KEY, this.state);
    this._onDidChange.fire();
  }
}
