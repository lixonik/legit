(function () {
  const vscode = acquireVsCodeApi();
  let state = { branch: '', total: 0, changelists: [] };
  const checked = new Set();
  const known = new Set();
  const collapsed = new Set();

  const $ = (id) => document.getElementById(id);
  const tree = $('tree');
  const msg = $('message');
  const amend = $('amend');
  const commitBtn = $('commit');
  const commitPushBtn = $('commitPush');
  const branchLabel = $('branch');
  const selInfo = $('selinfo');
  const ctx = $('ctxmenu');

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpanel').forEach((p) =>
        p.classList.toggle('active', p.getAttribute('data-tab') === tab),
      );
    });
  });

  // Toolbar
  $('tb-focus').addEventListener('click', () => msg.focus());
  $('tb-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('tb-new').addEventListener('click', () => vscode.postMessage({ type: 'newChangelist' }));
  $('tb-expand').addEventListener('click', () => { collapsed.clear(); render(); });
  $('tb-collapse').addEventListener('click', () => {
    state.changelists.forEach((c) => collapsed.add(c.id));
    render();
  });
  $('tb-rollback').addEventListener('click', () => {
    const items = checkedItems();
    if (items.length) vscode.postMessage({ type: 'rollback', items });
  });

  commitBtn.addEventListener('click', () => doCommit(false));
  commitPushBtn.addEventListener('click', () => doCommit(true));
  msg.addEventListener('input', updateCommitState);

  function doCommit(push) {
    const all = allPaths();
    const paths = [...checked].filter((p) => all.has(p));
    vscode.postMessage({ type: 'commit', paths, message: msg.value, amend: amend.checked, push });
  }

  function allPaths() {
    const s = new Set();
    state.changelists.forEach((c) => c.files.forEach((f) => s.add(f.path)));
    return s;
  }
  function fileByPath(p) {
    for (const c of state.changelists) {
      const f = c.files.find((x) => x.path === p);
      if (f) return f;
    }
    return null;
  }
  function checkedItems() {
    const all = allPaths();
    return [...checked]
      .filter((p) => all.has(p))
      .map((p) => {
        const f = fileByPath(p);
        return { path: p, untracked: f ? f.untracked : false };
      });
  }

  function reconcile() {
    const all = allPaths();
    all.forEach((p) => {
      if (!known.has(p)) {
        known.add(p);
        checked.add(p);
      }
    });
    [...known].forEach((p) => {
      if (!all.has(p)) {
        known.delete(p);
        checked.delete(p);
      }
    });
  }

  const baseName = (p) => p.split('/').pop();
  const dirName = (p) => {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
  };
  const cls = (letter) => 'st-' + (letter === '?' ? 'Q' : letter);

  function render() {
    branchLabel.textContent = state.branch ? '⎇ ' + state.branch : '';
    tree.innerHTML = '';
    for (const cl of state.changelists) {
      tree.appendChild(changelistNode(cl));
      if (!collapsed.has(cl.id)) {
        for (const f of cl.files) tree.appendChild(fileRow(f));
      }
    }
    updateCommitState();
  }

  function changelistNode(cl) {
    const node = document.createElement('div');
    node.className = 'cl-node';

    const chev = document.createElement('span');
    chev.className = 'chev' + (collapsed.has(cl.id) ? ' collapsed' : '');
    chev.textContent = '▾';
    chev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (collapsed.has(cl.id)) collapsed.delete(cl.id);
      else collapsed.add(cl.id);
      render();
    });

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const checkedCount = cl.files.filter((f) => checked.has(f.path)).length;
    cb.checked = cl.files.length > 0 && checkedCount === cl.files.length;
    cb.indeterminate = checkedCount > 0 && checkedCount < cl.files.length;
    cb.addEventListener('change', () => {
      cl.files.forEach((f) => {
        if (cb.checked) checked.add(f.path);
        else checked.delete(f.path);
      });
      render();
    });

    const name = document.createElement('span');
    name.className = 'cl-name' + (cl.active ? ' active' : '');
    name.textContent = cl.name;

    node.append(chev, cb, name);
    if (cl.active) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Active';
      node.append(badge);
    }
    const count = document.createElement('span');
    count.className = 'cl-count';
    count.textContent = cl.files.length ? cl.files.length + ' file' + (cl.files.length > 1 ? 's' : '') : 'empty';
    node.append(count);

    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e, [
        { label: 'Set Active Changelist', cmd: () => vscode.postMessage({ type: 'setActive', id: cl.id }) },
        { label: 'New Changelist...', cmd: () => vscode.postMessage({ type: 'newChangelist' }) },
        { label: 'Rename...', cmd: () => vscode.postMessage({ type: 'renameChangelist', id: cl.id }) },
        { label: 'Delete', cmd: () => vscode.postMessage({ type: 'deleteChangelist', id: cl.id }) },
      ]);
    });
    return node;
  }

  function fileRow(f) {
    const row = document.createElement('div');
    row.className = 'file-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(f.path);
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(f.path);
      else checked.delete(f.path);
      render();
    });

    const letter = document.createElement('span');
    letter.className = 'letter ' + cls(f.letter);
    letter.textContent = f.letter;
    letter.title = f.statusLabel;

    const fname = document.createElement('span');
    fname.className = 'fname ' + cls(f.letter) + (f.deleted ? ' deleted' : '');
    fname.textContent = baseName(f.path);

    const dir = document.createElement('span');
    dir.className = 'fdir';
    dir.textContent = dirName(f.path);

    row.append(cb, letter, fname, dir);
    row.addEventListener('click', (e) => {
      if (e.target === cb) return;
      vscode.postMessage({ type: 'openDiff', path: f.path, untracked: f.untracked });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e, [
        { label: 'Show Diff', cmd: () => vscode.postMessage({ type: 'openDiff', path: f.path, untracked: f.untracked }) },
        { label: 'Move to Another Changelist...', cmd: () => vscode.postMessage({ type: 'move', paths: [f.path] }) },
        { label: 'Rollback...', cmd: () => vscode.postMessage({ type: 'rollback', items: [{ path: f.path, untracked: f.untracked }] }) },
      ]);
    });
    return row;
  }

  function updateCommitState() {
    const all = allPaths();
    const n = [...checked].filter((p) => all.has(p)).length;
    selInfo.textContent = n + ' of ' + state.total + ' selected';
    const ok = n > 0 && msg.value.trim().length > 0;
    commitBtn.disabled = !ok;
    commitPushBtn.disabled = !ok;
  }

  function showCtx(e, items) {
    ctx.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'ctx-item';
      d.textContent = it.label;
      d.addEventListener('click', () => {
        hideCtx();
        it.cmd();
      });
      ctx.appendChild(d);
    }
    ctx.style.display = 'block';
    const x = Math.min(e.clientX, window.innerWidth - ctx.offsetWidth - 4);
    const y = Math.min(e.clientY, window.innerHeight - ctx.offsetHeight - 4);
    ctx.style.left = Math.max(2, x) + 'px';
    ctx.style.top = Math.max(2, y) + 'px';
  }
  function hideCtx() {
    ctx.style.display = 'none';
  }
  document.addEventListener('click', hideCtx);
  window.addEventListener('blur', hideCtx);

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'state') {
      state = m.payload;
      reconcile();
      render();
    } else if (m.type === 'committed') {
      msg.value = '';
      amend.checked = false;
      updateCommitState();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
