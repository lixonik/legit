# JeGit – JetBrains-style Git for VS Code

A VS Code extension that recreates the JetBrains (WebStorm / IntelliJ) Git
workflow and UI, for people migrating off the JetBrains IDEs. It is standalone:
it does not depend on GitLens or the built-in SCM view for its UI.

The whole experience lives in a dedicated **JeGit** panel in the bottom
tool-window area (like the JetBrains Version Control tool window), with a
Darcula-styled, tabbed UI: **Local Changes / Log / Shelf / Console**.

## Features

### Local Changes
- **Changelists** rendered as a directory tree (toggle to a flat list), each with
  a tri-state checkbox; the active list carries an *Active* badge and collects
  every change not explicitly assigned elsewhere.
- Create / rename / delete / set-active changelists; move files by menu or drag and drop.
- Files are colored by status (modified / added / deleted / unversioned) with
  real folder/file icons; **merge conflicts** are detected and can be opened in
  VS Code's merge UI or marked resolved.
- **Commit** the checked files, **Commit and Push**, **Amend** (prefilled), a
  **Sign-off** option, and per-hunk **Commit Selected Hunks**.
- **Rollback**, **Shelve**, **Create Patch**; click a file for a HEAD diff.
- Keyboard: `Ctrl+Enter` commits, `Ctrl+Shift+Enter` commits and pushes.

### Log
- Commit graph with colored branch lanes, ref chips, Subject / Author / Date
  columns, and a details panel on the right (click a changed file to diff it).
- Filter by free text and by branch.
- Commit context menu: Checkout, New Branch, Cherry-Pick, Revert, Reset, Edit
  Commit Message (any commit), Undo Commit, Squash, Fixup, Drop, **Interactively
  Rebase from Here** (reorder + pick/fixup/drop), New Tag, Copy Revision.

### Shelf and Console
- Shelve / Unshelve patches that survive branch switches.
- Console tab logging git commands.

### Branches and remotes
- A status-bar widget (`branch ↓behind ↑ahead`) and the panel header open the
  **Branches popup**: Checkout, New, Merge, Rebase, Rename, Delete, Compare.
- **Update** (fetch then pull) and **Push** with an outgoing-commit preview.

### Editor
- **Annotate with Git Blame** and **Show File History** (with restore to a revision).
- **Apply Patch**, **Stash / Unstash**, **Copy Path**.

## Development

```bash
npm install
npm run compile        # one-shot bundle to dist/
npm run watch          # incremental rebuilds
npm run typecheck      # tsc --noEmit
```

Press **F5** in VS Code (with this folder open) to launch an Extension Development
Host with JeGit loaded, then open any git repository. The **JeGit** panel opens in
the bottom tool-window area (also `Alt+9`, or the JEGIT tab next to Terminal).

## Settings

- `jegit.log.maxCount` – maximum commits loaded in the Log tab.
- `jegit.panel.autoReveal` – reveal the JeGit panel automatically on startup.

## License

JeGit is licensed under the **PolyForm Noncommercial License 1.0.0** (see
[LICENSE](LICENSE)): free for any noncommercial use. Commercial use requires a
separate commercial license from the author (lixonik).
