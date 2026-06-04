import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ShelfEntry {
  id: string;
  name: string;
  date: string;
  files: string[];
}

interface Persisted {
  entries: ShelfEntry[];
}

const STORAGE_KEY = 'legit.shelf.v1';

/**
 * Stores shelved changes: metadata in workspaceState, the patch body as a file in
 * the extension's per-workspace storage. Unlike git stash, shelves are listed,
 * named and survive branch switches.
 */
export class ShelfStore {
  private state: Persisted;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly dir: string,
  ) {
    this.state = memento.get<Persisted>(STORAGE_KEY) ?? { entries: [] };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  list(): ShelfEntry[] {
    return this.state.entries.slice().sort((a, b) => b.date.localeCompare(a.date));
  }

  get(id: string): ShelfEntry | undefined {
    return this.state.entries.find((e) => e.id === id);
  }

  patchPath(id: string): string {
    return path.join(this.dir, id + '.patch');
  }

  async add(name: string, files: string[], patch: string): Promise<ShelfEntry> {
    const id = 'sh_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    fs.writeFileSync(this.patchPath(id), patch, 'utf8');
    const entry: ShelfEntry = { id, name, date: new Date().toISOString(), files };
    this.state.entries.push(entry);
    await this.memento.update(STORAGE_KEY, this.state);
    return entry;
  }

  async remove(id: string): Promise<void> {
    this.state.entries = this.state.entries.filter((e) => e.id !== id);
    try {
      fs.unlinkSync(this.patchPath(id));
    } catch {
      /* already gone */
    }
    await this.memento.update(STORAGE_KEY, this.state);
  }
}
