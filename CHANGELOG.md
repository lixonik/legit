# Changelog

## 0.1.0

A feature-complete JetBrains-style Git tool window.

### Local Changes
- Changelists as a directory tree or flat list, tri-state checkboxes, an active list, and drag-and-drop between lists.
- Commit, Commit and Push, Amend (message prefilled), Sign-off, commit as another author, and per-hunk Commit Selected Hunks.
- Rollback, Shelve, Create Patch, Add to .gitignore; merge-conflict detection.
- `Ctrl+Enter` commits, `Ctrl+Shift+Enter` commits and pushes.

### Log
- Branch graph with ref chips, Subject / Author / Date columns, and a details panel showing the changed files as a tree.
- Filters: free text, Branch, User, Date, and Path.
- Commit actions: Checkout, New Branch, Cherry-Pick, Revert, Reset, Edit Commit Message (any commit), Undo Commit, Squash, Fixup into Previous, Drop Commit, Interactively Rebase from Here (drag-reorder + pick/fixup/drop), New Tag, Copy Revision.

### Conflicts
- Three-pane merge resolver (Yours | editable Result | Theirs) with per-conflict and whole-file accept.

### Shelf, Console, stash and patches
- Shelve / Unshelve; a Console git-command log; Stash / Unstash; Create / Apply Patch.

### Branches and remotes
- Branches popup (Checkout, New, Merge, Rebase, Rename, Delete, Compare with Current) and an ahead/behind status-bar widget.
- Update (fetch then pull), Push (with an outgoing-commit preview), Force Push, Push Tags, and Manage Remotes.

### Editor
- Git blame annotation; file history with restore to a revision; Copy Path.

### Quality
- Unit tests (vitest) for porcelain status / name-status / ref parsing, diff hunk splitting, and the changelist model.

### Settings
- `jegit.log.maxCount`, `jegit.panel.autoReveal`.
