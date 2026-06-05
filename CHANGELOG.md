# Changelog

## 0.1.0

First feature-complete preview of the JetBrains-style Git tool window.

### Local Changes
- Changelists as a directory tree or flat list, with tri-state checkboxes and an active list.
- Create / rename / delete / set-active changelists; move files by menu or drag and drop.
- Commit, Commit and Push, Amend (message prefilled), and per-hunk Commit Selected Hunks.
- Rollback, Shelve, Create Patch; merge-conflict detection with resolve / mark-resolved.
- `Ctrl+Enter` commits, `Ctrl+Shift+Enter` commits and pushes.

### Log
- Branch graph with ref chips, Subject / Author / Date columns, and a details panel on the right.
- Filter by message / author / hash.
- Commit actions: Checkout, New Branch, Cherry-Pick, Revert, Reset, Edit Commit Message (any commit), Undo Commit, Squash, Fixup into Previous, Drop Commit, New Tag, Copy Revision.

### Shelf and Console
- Shelve / Unshelve patches that survive branch switches.
- Console tab logging git commands.

### Branches and remotes
- Branches popup (Checkout, New, Merge, Rebase, Rename, Delete, Compare with Current) and a status-bar widget showing ahead / behind.
- Update (fetch then pull, rebase or merge) and Push with an outgoing-commit preview.

### Editor and misc
- Git blame annotation and file history.
- Apply Patch, Stash / Unstash.
- Settings: `legit.log.maxCount`, `legit.panel.autoReveal`.

### Not yet implemented
- A full drag-to-reorder interactive rebase GUI (reword, fixup and drop are available from the Log); conflicts currently open the VS Code merge editor.
