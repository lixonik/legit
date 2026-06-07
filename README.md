# JeGit – JetBrains-style Git for VS Code

A VS Code extension that recreates the JetBrains (WebStorm / IntelliJ) Git
workflow and UI, for people migrating off the JetBrains IDEs. It is standalone:
it does not depend on GitLens or the built-in SCM view for its UI.

The whole experience lives in a dedicated **JeGit** panel in the bottom
tool-window area (like the JetBrains Version Control tool window), with a
Darcula-styled, tabbed UI: **Local Changes / Log / Shelf / Console**.

## Features

### Local Changes
- **Changelists** as a directory tree (toggle to a flat list), tri-state
  checkboxes, an active list, and move by menu or drag and drop.
- Files colored by status with folder/file icons; **merge conflicts** detected.
- **Commit** the checked files, **Commit and Push**, **Amend** (prefilled),
  **Sign-off**, **commit as another author**, and per-hunk **Commit Selected Hunks**.
- **Rollback**, **Shelve**, **Create Patch**, **Add to .gitignore**; click a file
  for a HEAD diff.
- `Ctrl+Enter` commits, `Ctrl+Shift+Enter` commits and pushes.

### Log
- Commit graph with ref chips, Subject / Author / Date columns, and a details
  panel on the right showing the changed files as a tree (click to diff).
- Filters: free text, **Branch**, **User**, **Date**, and **Path**.
- Commit context menu: Checkout, New Branch, Cherry-Pick, Revert, Reset, Edit
  Commit Message (any commit), Undo Commit, Squash, Fixup, Drop, **Interactively
  Rebase from Here** (drag-reorder + pick/fixup/drop), New Tag, Copy Revision.

### Conflicts
- A **three-pane merge resolver** (Yours | editable Result | Theirs) with
  per-conflict and whole-file accept, opened from a conflicted file.

### Shelf and Console
- Shelve / Unshelve patches that survive branch switches.
- Console tab logging git commands.

### Branches and remotes
- A status-bar widget (`branch ↓behind ↑ahead`) and the panel header open the
  **Branches popup**: Checkout, New, Merge, Rebase, Rename, Delete, Compare,
  **Set Upstream**.
- **Fetch**, **Update** (fetch + pull), **Push** (with an outgoing-commit preview),
  **Force Push**, **Push Tags**, and **Manage Remotes** (add / rename / change
  URL / remove).

### Editor
- **Annotate with Git Blame**, **Show File History** (with restore to a revision),
  **Apply Patch** (from a file or the clipboard), **Stash / Unstash**, and **Copy Path**.

## Development

```bash
npm install
npm run compile        # bundle to dist/
npm run watch          # incremental rebuilds
npm run typecheck      # tsc --noEmit
npm test               # vitest unit tests
```

Press **F5** to launch an Extension Development Host with JeGit loaded, then open
any git repository. The **JeGit** panel opens in the bottom tool-window area
(also `Alt+9`, or the JEGIT tab next to Terminal).

## Settings

- `jegit.log.maxCount` – maximum commits loaded in the Log tab.
- `jegit.panel.autoReveal` – reveal the JeGit panel automatically on startup.

## License

JeGit is licensed under the **MIT License** (see [LICENSE](LICENSE)).
