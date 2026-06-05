# JeGit webview preview

A standalone preview of the Version Control webview (`media/vcs.css` + `vcs.js`)
that runs in a plain browser, with `acquireVsCodeApi` mocked and sample data fed
in. Use it for quick visual QA of the Local Changes / Log / details UI without
launching an Extension Development Host.

Run a static server from the repo root and open the page:

```bash
npm run preview
# then open http://localhost:8099/test/preview/ in a browser
```

It is a dev tool only and is not part of the packaged extension.
