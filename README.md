# legit – JetBrains-style Git for VS Code

A VS Code extension that brings the parts of the JetBrains (WebStorm / IntelliJ)
Git workflow that VS Code doesn't have natively – starting with **changelists**.

> Status: early. Phase 1 (changelists + commit/push) is implemented; shelve, the
> commit-graph log, the branches popup and the rest of the parity work are on the
> roadmap below.

## Why

VS Code's built-in Git and extensions like GitLens already cover diffs, blame,
the commit graph and conflict resolution well. What they *don't* replicate is the
signature JetBrains workflow:

- **Changelists** – named groups of uncommitted changes. No native VS Code equivalent.
- **Shelve / Unshelve** – smarter than `git stash` (per-file, browsable, survives branch switches).
- A **unified commit panel** – tree of changes grouped by changelist, partial (per-hunk) commit, amend, Commit & Push.

`legit` builds these from scratch as a standalone extension.

## What works now (Phase 1)

- A dedicated **legit** source control provider in the SCM view.
- **Changelists** as resource groups: create, rename, delete, set active, move files between them.
- The **active** changelist (marked `✓`) collects every change not explicitly assigned elsewhere – like JetBrains' default *Changes* list.
- **Commit** a changelist (stages and commits exactly its files via a pathspec commit, so nothing else sneaks in) and **Commit & Push**.
- Click a file to open a **HEAD ↔ working tree diff**.

## Roadmap

1. ✅ Scaffold + git CLI wrapper
2. ✅ Changelists (model, SCM groups, commands)
3. ✅ Commit & Push from a changelist
4. ⏳ Diff & per-hunk partial commit
5. ⏳ Shelve / Unshelve
6. ⏳ Commit graph / Git Log (webview)
7. ⏳ Branches popup
8. ⏳ Parity tail: conflict resolver, blame/annotate, interactive rebase, push dialog

## Development

```bash
npm install
npm run compile        # one-shot bundle to dist/
npm run watch          # incremental rebuilds
npm run typecheck      # tsc --noEmit
```

Press **F5** in VS Code (with this folder open) to launch an Extension Development
Host with `legit` loaded, then open any git repository to see the SCM provider.

## License

MIT
