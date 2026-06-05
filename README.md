# legit – JetBrains-style Git for VS Code

A VS Code extension that recreates the JetBrains (WebStorm / IntelliJ) Git
workflow and UI, for people migrating off the JetBrains IDEs. It is standalone:
it does not depend on GitLens or the built-in SCM view for its UI.

The whole experience lives in a dedicated **legit** panel in the bottom
tool-window area (like the JetBrains Version Control tool window), with a
Darcula-styled, tabbed UI: **Local Changes / Log / Shelf / Console**.

## Features

### Local Changes
- **Changelists** rendered as a directory tree (toggle to a flat list), each with
  a tri-state checkbox; the active list carries an *Active* badge and collects
  every change not explicitly assigned elsewhere.
- Create / rename / delete / set-active changelists; move files between them.
- Files are colored by status (modified / added / deleted / unversioned) with
  real folder/file icons; **merge conflicts** are detected and can be opened in
  VS Code's merge UI or marked resolved.
- **Commit** the checked files, **Commit and Push**, and **Amend** (which prefills
  the last message). Commits use a pathspec so only the checked files are recorded.
- **Commit Selected Hunks**: pick individual hunks of a file to commit, leaving
  the rest in the working tree.
- **Rollback** and **Shelve** selected files; click a file for a HEAD diff.
- Keyboard: `Ctrl+Enter` commits, `Ctrl+Shift+Enter` commits and pushes.

### Log
- Commit graph with colored branch lanes, ref chips (local / remote / tag / HEAD),
  Subject / Author / Date columns, and a details panel on the right with the
  commit message and changed files (click a file to diff it against its parent).
- Filter by message / author / hash.
- Commit context menu: Checkout, New Branch from Here, Cherry-Pick, Revert, Reset
  (soft / mixed / hard), Edit Commit Message, Undo Commit, New Tag, Copy Revision.

### Shelf
- Shelve changelists or files to a named patch that survives branch switches,
  then Unshelve or Delete from the Shelf tab.

### Branches and remotes
- A status-bar widget (`branch ↓behind ↑ahead`) and the panel header open the
  **Branches popup**: Checkout, New Branch, Merge, Rebase, Rename, Delete, and
  Compare with Current (lists differing files and diffs them).
- **Update** (fetch then pull with rebase or merge) and **Push** (with a preview
  of outgoing commits, setting the upstream when missing).

### In the editor
- **Annotate with Git Blame**: per-line author and date, toggled from the editor
  context menu or command palette.
- **Show File History**: a file's commits, each opening the revision's diff.

## Development

```bash
npm install
npm run compile        # one-shot bundle to dist/
npm run watch          # incremental rebuilds
npm run typecheck      # tsc --noEmit
```

Press **F5** in VS Code (with this folder open) to launch an Extension Development
Host with `legit` loaded, then open any git repository. The **legit** panel opens
in the bottom tool-window area (also `Alt+9`, or the LEGIT tab next to Terminal).

## Roadmap

The JetBrains Git tool window is largely covered. Still on the list:

- Interactive rebase (reorder / squash / edit) with a GUI
- A three-pane merge resolver of legit's own (today conflicts open the VS Code
  merge editor)
- Richer Log filters (by branch / user / path) and a Console tab

## License

MIT
