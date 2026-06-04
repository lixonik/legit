# legit – JetBrains-style Git for VS Code

A VS Code extension that recreates the JetBrains (WebStorm / IntelliJ) Git
workflow and UI, for people migrating off the JetBrains IDEs. Standalone: it does
not depend on GitLens or the built-in SCM view for its UI.

> Status: early but usable. The Version Control tool window with the **Local
> Changes** tab (changelists + commit/push) is implemented; Log graph, Shelf and
> the rest of the parity work are on the roadmap below.

## The idea

VS Code's native SCM view does not look or feel like the JetBrains Version Control
tool window. `legit` rebuilds that experience as a dedicated **bottom panel** with
tabs (Local Changes / Log / Shelf / Console), a Darcula-styled changelist tree
with checkboxes, and an embedded commit box, the way IntelliJ classic UI does it.

## What works now

- A dedicated **legit** panel in the bottom tool-window area (Darcula styling).
- **Local Changes** tab: changelists rendered as a tree, each with a tri-state
  checkbox, the active list marked with an *Active* badge, files colored by status
  (modified / added / deleted / unversioned / conflict) with the dimmed path.
- **Changelists**: create, rename, delete, set active, move files between lists
  (toolbar + right-click context menus).
- **Commit** the checked files with a message, plus **Commit and Push** and an
  **Amend** option. Commits use a pathspec so only the checked files are recorded.
- **Rollback** selected files (discards local changes; deletes unversioned files).
- Click a file to open a **HEAD <-> working tree** diff; change bars appear in the
  editor gutter.

## Roadmap

1. Scaffold + git CLI wrapper – done
2. Changelists model – done
3. Commit and Push – done
4. JetBrains-style webview tool window (Local Changes) – done
5. Log / commit graph tab – next
6. Shelf (shelve / unshelve) tab
7. Branches popup
8. Diff polish, per-hunk partial commit, interactive rebase, conflict resolver, blame

## Development

```bash
npm install
npm run compile        # one-shot bundle to dist/
npm run watch          # incremental rebuilds
npm run typecheck      # tsc --noEmit
```

Press **F5** in VS Code (with this folder open) to launch an Extension Development
Host with `legit` loaded, then open any git repository. The **legit** panel appears
in the bottom tool-window area (View > Appearance > Panel, or Ctrl+J if hidden).

## License

MIT
