(function () {
  const vscode = acquireVsCodeApi();
  let state = { branch: '', total: 0, changelists: [] };
  const checked = new Set();
  const known = new Set();
  const collapsed = new Set();
  let groupByDir = true;
  let amendLoadedMsg = '';
  let selectedPath = null;

  // Log state
  let logCommits = [];
  let graphRows = [];
  let maxLanes = 1;
  let logLoaded = false;
  let selectedHash = null;
  let detailsCache = {};

  // Shelf state
  let shelfEntries = [];
  const shelfCollapsed = new Set();

  const LANE_COLORS = ['#5b9bd5', '#6a8759', '#cc7832', '#9876aa', '#c75450', '#4eade5', '#bbb529', '#499c54'];
  const LANE_W = 14;
  const ROW_H = 22;

  const $ = (id) => document.getElementById(id);
  const tree = $('tree');
  const msg = $('message');
  const amend = $('amend');
  const signoff = $('signoff');
  const author = $('author');
  const commitBtn = $('commit');
  const commitPushBtn = $('commitPush');
  const branchLabel = $('branch');
  const selInfo = $('selinfo');
  const ctx = $('ctxmenu');
  const logList = $('log-list');
  const logDetails = $('log-details');
  const logSearch = $('log-search');
  const logUser = $('log-user');
  const logDate = $('log-date');
  const shelfList = $('shelf-list');
  const consoleLogEl = $('console-log');

  // Tabs
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      const tab = t.getAttribute('data-tab');
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.tabpanel').forEach((p) =>
        p.classList.toggle('active', p.getAttribute('data-tab') === tab),
      );
      if (tab === 'log' && !logLoaded) {
        logLoaded = true;
        vscode.postMessage({ type: 'requestLog' });
      }
      if (tab === 'shelf') vscode.postMessage({ type: 'requestShelf' });
      if (tab === 'console') vscode.postMessage({ type: 'requestConsole' });
    });
  });

  // Local Changes toolbar
  $('tb-focus').addEventListener('click', () => msg.focus());
  $('tb-refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  $('tb-new').addEventListener('click', () => vscode.postMessage({ type: 'newChangelist' }));
  $('tb-expand').addEventListener('click', () => {
    collapsed.clear();
    render();
  });
  $('tb-collapse').addEventListener('click', () => {
    state.changelists.forEach((c) => collapsed.add(c.id));
    render();
  });
  $('tb-rollback').addEventListener('click', () => {
    const items = checkedItems();
    if (items.length) vscode.postMessage({ type: 'rollback', items });
  });
  $('tb-shelve').addEventListener('click', () => {
    const items = checkedItems();
    if (items.length) vscode.postMessage({ type: 'shelve', items });
  });
  $('shelf-refresh').addEventListener('click', () => vscode.postMessage({ type: 'requestShelf' }));
  $('tb-group').addEventListener('click', () => {
    groupByDir = !groupByDir;
    const i = document.querySelector('#tb-group .codicon');
    if (i) i.className = 'codicon ' + (groupByDir ? 'codicon-list-tree' : 'codicon-list-flat');
    render();
  });
  commitBtn.addEventListener('click', () => doCommit(false));
  commitPushBtn.addEventListener('click', () => doCommit(true));
  msg.addEventListener('input', updateCommitState);
  msg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!commitBtn.disabled) doCommit(e.shiftKey);
    }
  });
  amend.addEventListener('change', () => {
    if (amend.checked && !msg.value.trim()) {
      vscode.postMessage({ type: 'getLastCommitMessage' });
    } else if (!amend.checked && amendLoadedMsg && msg.value === amendLoadedMsg) {
      msg.value = '';
    }
    updateCommitState();
  });

  // Log toolbar
  $('log-refresh').addEventListener('click', () => vscode.postMessage({ type: 'requestLog' }));
  $('log-branch').addEventListener('click', () => vscode.postMessage({ type: 'logBranchFilter' }));
  $('log-path').addEventListener('click', () => vscode.postMessage({ type: 'logPathFilter' }));
  logSearch.addEventListener('input', renderLog);
  logUser.addEventListener('change', renderLog);
  logDate.addEventListener('change', renderLog);

  // Clicking the branch label opens the Branches popup (like the JetBrains widget).
  branchLabel.addEventListener('click', () => vscode.postMessage({ type: 'branches' }));

  function doCommit(push) {
    const all = allPaths();
    const paths = [...checked].filter((p) => all.has(p));
    vscode.postMessage({ type: 'commit', paths, message: msg.value, amend: amend.checked, push, signoff: signoff.checked, author: author.value });
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

  // ---- Local Changes rendering (directory tree) ----
  function render() {
    branchLabel.textContent = state.branch ? '⎇ ' + state.branch : '';
    tree.innerHTML = '';
    for (const cl of state.changelists) {
      tree.appendChild(changelistNode(cl));
      if (!collapsed.has(cl.id)) {
        if (groupByDir) {
          renderNode(buildTree(cl.files), cl, 1);
        } else {
          for (const f of cl.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
            tree.appendChild(fileRow(f, 1, true));
          }
        }
      }
    }
    updateCommitState();
  }

  function buildTree(files) {
    const root = { dirs: new Map(), files: [], path: '' };
    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const seg = parts[i];
        if (!node.dirs.has(seg)) {
          node.dirs.set(seg, { dirs: new Map(), files: [], path: (node.path ? node.path + '/' : '') + seg });
        }
        node = node.dirs.get(seg);
      }
      node.files.push(f);
    }
    return root;
  }

  function collectFiles(node, out) {
    for (const f of node.files) out.push(f.path);
    for (const d of node.dirs.values()) collectFiles(d, out);
    return out;
  }

  function renderNode(node, cl, depth) {
    const dirNames = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b));
    for (const dn of dirNames) {
      let child = node.dirs.get(dn);
      let label = dn;
      // Compact middle packages: collapse single-child directory chains.
      while (child.dirs.size === 1 && child.files.length === 0) {
        const onlyKey = [...child.dirs.keys()][0];
        label += '/' + onlyKey;
        child = child.dirs.get(onlyKey);
      }
      tree.appendChild(folderRow(child, cl, depth, label));
      if (!collapsed.has(cl.id + '::' + child.path)) renderNode(child, cl, depth + 1);
    }
    for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
      tree.appendChild(fileRow(f, depth));
    }
  }

  function indent(depth) {
    return 8 + depth * 14 + 'px';
  }

  function folderRow(node, cl, depth, label) {
    const key = cl.id + '::' + node.path;
    const isCollapsed = collapsed.has(key);
    const row = document.createElement('div');
    row.className = 'tree-row folder';
    row.style.paddingLeft = indent(depth);

    const chev = document.createElement('span');
    chev.className = 'chev' + (isCollapsed ? ' collapsed' : '');
    chev.textContent = '▾';

    const descendants = collectFiles(node, []);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const ch = descendants.filter((p) => checked.has(p)).length;
    cb.checked = descendants.length > 0 && ch === descendants.length;
    cb.indeterminate = ch > 0 && ch < descendants.length;
    cb.addEventListener('change', () => {
      descendants.forEach((p) => (cb.checked ? checked.add(p) : checked.delete(p)));
      render();
    });

    const icon = document.createElement('i');
    icon.className = 'codicon ' + (isCollapsed ? 'codicon-folder' : 'codicon-folder-opened');
    const name = document.createElement('span');
    name.className = 'fname dir';
    name.textContent = label;

    row.append(chev, cb, icon, name);
    const toggle = () => {
      if (isCollapsed) collapsed.delete(key);
      else collapsed.add(key);
      render();
    };
    chev.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    row.addEventListener('click', (e) => {
      if (e.target !== cb) toggle();
    });
    return row;
  }

  function fileRow(f, depth, showDir) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.style.paddingLeft = indent(depth);
    row.title = f.statusLabel + ': ' + f.path;
    if (f.path === selectedPath) row.classList.add('selected');

    const sp = document.createElement('span');
    sp.className = 'chev-spacer';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(f.path);
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(f.path);
      else checked.delete(f.path);
      render();
    });

    const icon = document.createElement('i');
    icon.className = 'codicon ' + (f.conflicted ? 'codicon-git-merge' : 'codicon-file');

    const fname = document.createElement('span');
    fname.className = 'fname ' + cls(f.letter) + (f.deleted ? ' deleted' : '');
    fname.textContent = baseName(f.path);

    row.append(sp, cb, icon, fname);
    if (showDir) {
      const dir = document.createElement('span');
      dir.className = 'fdir';
      dir.textContent = dirName(f.path);
      row.append(dir);
    }
    row.addEventListener('click', (e) => {
      if (e.target === cb) return;
      selectedPath = f.path;
      document.querySelectorAll('.tree-row.selected').forEach((x) => x.classList.remove('selected'));
      row.classList.add('selected');
    });
    row.addEventListener('dblclick', (e) => {
      if (e.target === cb) return;
      if (f.conflicted) vscode.postMessage({ type: 'mergeResolve', path: f.path });
      else vscode.postMessage({ type: 'openDiff', path: f.path, untracked: f.untracked });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menu = [];
      if (f.conflicted) {
        menu.push({ label: 'Resolve in 3-pane Merge', cmd: () => vscode.postMessage({ type: 'mergeResolve', path: f.path }) });
        menu.push({ label: 'Open in Editor', cmd: () => vscode.postMessage({ type: 'openFile', path: f.path }) });
        menu.push({ label: 'Mark as Resolved', cmd: () => vscode.postMessage({ type: 'markResolved', paths: [f.path] }) });
      }
      menu.push({ label: 'Show Diff', cmd: () => vscode.postMessage({ type: 'openDiff', path: f.path, untracked: f.untracked }) });
      menu.push({ label: 'Show History', cmd: () => vscode.postMessage({ type: 'fileHistory', path: f.path }) });
      menu.push({ label: 'Copy Relative Path', cmd: () => vscode.postMessage({ type: 'copyPath', path: f.path, absolute: false }) });
      menu.push({ label: 'Copy Path', cmd: () => vscode.postMessage({ type: 'copyPath', path: f.path, absolute: true }) });
      if (!f.untracked && !f.conflicted && !f.deleted) {
        menu.push({ label: 'Commit Selected Hunks...', cmd: () => vscode.postMessage({ type: 'commitHunks', path: f.path }) });
      }
      menu.push({ label: 'Create Patch...', cmd: () => vscode.postMessage({ type: 'createPatch', items: [{ path: f.path, untracked: f.untracked }] }) });
      menu.push({ label: 'Move to Another Changelist...', cmd: () => vscode.postMessage({ type: 'move', paths: [f.path] }) });
      menu.push({ label: 'Shelve...', cmd: () => vscode.postMessage({ type: 'shelve', items: [{ path: f.path, untracked: f.untracked }] }) });
      if (f.untracked) {
        menu.push({ label: 'Add to .gitignore', cmd: () => vscode.postMessage({ type: 'addToGitignore', path: f.path }) });
      }
      menu.push({ label: 'Rollback...', cmd: () => vscode.postMessage({ type: 'rollback', items: [{ path: f.path, untracked: f.untracked }] }) });
      showCtx(e, menu);
    });
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) e.dataTransfer.setData('text/plain', f.path);
    });
    return row;
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
      cl.files.forEach((f) => (cb.checked ? checked.add(f.path) : checked.delete(f.path)));
      render();
    });

    const icon = document.createElement('i');
    icon.className = 'codicon codicon-checklist';

    const name = document.createElement('span');
    name.className = 'cl-name' + (cl.active ? ' active' : '');
    name.textContent = cl.name;

    node.append(chev, cb, icon, name);
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

    const items = () => cl.files.map((f) => ({ path: f.path, untracked: f.untracked }));
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e, [
        { label: 'Set Active Changelist', cmd: () => vscode.postMessage({ type: 'setActive', id: cl.id }) },
        { label: 'New Changelist...', cmd: () => vscode.postMessage({ type: 'newChangelist' }) },
        { label: 'Rename...', cmd: () => vscode.postMessage({ type: 'renameChangelist', id: cl.id }) },
        { label: 'Shelve Changelist...', cmd: () => cl.files.length && vscode.postMessage({ type: 'shelve', items: items() }) },
        { label: 'Create Patch...', cmd: () => cl.files.length && vscode.postMessage({ type: 'createPatch', items: items() }) },
        { label: 'Delete', cmd: () => vscode.postMessage({ type: 'deleteChangelist', id: cl.id }) },
      ]);
    });
    node.addEventListener('dragover', (e) => {
      e.preventDefault();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      node.classList.remove('drop-target');
      const p = e.dataTransfer && e.dataTransfer.getData('text/plain');
      if (p) vscode.postMessage({ type: 'assignTo', paths: [p], id: cl.id });
    });
    return node;
  }

  function updateCommitState() {
    const all = allPaths();
    const n = [...checked].filter((p) => all.has(p)).length;
    selInfo.textContent = n + ' of ' + state.total + ' selected';
    const ok = n > 0 && msg.value.trim().length > 0;
    commitBtn.disabled = !ok;
    commitPushBtn.disabled = !ok;
  }

  // ---- Context menu ----
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

  // Suppress the native browser context menu everywhere except text fields, so our
  // custom menus are the only ones that appear (like a desktop IDE).
  document.addEventListener(
    'contextmenu',
    (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea')) return;
      e.preventDefault();
    },
    true,
  );

  // ---- Log: graph layout ----
  function computeGraph(commits) {
    const rows = [];
    let lanes = [];
    let widest = 1;
    for (const c of commits) {
      const lanesIn = lanes.slice();
      let nodeLane = lanes.indexOf(c.hash);
      if (nodeLane === -1) {
        nodeLane = lanes.indexOf(null);
        if (nodeLane === -1) {
          nodeLane = lanes.length;
          lanes.push(null);
        }
      }
      while (lanesIn.length <= nodeLane) lanesIn.push(null);
      for (let i = 0; i < lanes.length; i++) {
        if (i !== nodeLane && lanes[i] === c.hash) lanes[i] = null;
      }
      if (c.parents.length === 0) {
        lanes[nodeLane] = null;
      } else {
        lanes[nodeLane] = c.parents[0];
        for (let k = 1; k < c.parents.length; k++) {
          let pl = lanes.indexOf(c.parents[k]);
          if (pl === -1) {
            pl = lanes.indexOf(null);
            if (pl === -1) {
              pl = lanes.length;
              lanes.push(null);
            }
            lanes[pl] = c.parents[k];
          }
        }
      }
      while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
      const lanesOut = lanes.slice();
      widest = Math.max(widest, lanesIn.length, lanesOut.length, nodeLane + 1);
      rows.push({ lane: nodeLane, lanesIn, lanesOut, parents: c.parents, hash: c.hash });
    }
    maxLanes = widest;
    return rows;
  }

  const laneColor = (i) => LANE_COLORS[i % LANE_COLORS.length];
  const cx = (i) => LANE_W / 2 + i * LANE_W;

  function graphSvg(r) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const w = Math.max(1, maxLanes) * LANE_W;
    const mid = ROW_H / 2;
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'lg-graph');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(ROW_H));

    const line = (x1, y1, x2, y2, color) => {
      const el = document.createElementNS(svgNS, x1 === x2 ? 'line' : 'path');
      if (x1 === x2) {
        el.setAttribute('x1', x1);
        el.setAttribute('y1', y1);
        el.setAttribute('x2', x2);
        el.setAttribute('y2', y2);
      } else {
        const cy = (y1 + y2) / 2;
        el.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`);
        el.setAttribute('fill', 'none');
      }
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', '1.6');
      svg.appendChild(el);
    };

    for (let i = 0; i < r.lanesIn.length; i++) {
      const v = r.lanesIn[i];
      if (!v) continue;
      if (i === r.lane) line(cx(i), 0, cx(i), mid, laneColor(i));
      else if (v === r.hash) line(cx(i), 0, cx(r.lane), mid, laneColor(i));
      else line(cx(i), 0, cx(i), mid, laneColor(i));
    }
    for (let i = 0; i < r.lanesOut.length; i++) {
      if (!r.lanesOut[i]) continue;
      line(cx(i), mid, cx(i), ROW_H, laneColor(i));
    }
    for (let k = 1; k < r.parents.length; k++) {
      const pl = r.lanesOut.indexOf(r.parents[k]);
      if (pl >= 0 && pl !== r.lane) line(cx(r.lane), mid, cx(pl), ROW_H, laneColor(pl));
    }

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', String(cx(r.lane)));
    dot.setAttribute('cy', String(mid));
    dot.setAttribute('r', '3.4');
    dot.setAttribute('fill', laneColor(r.lane));
    dot.setAttribute('stroke', '#2b2b2b');
    dot.setAttribute('stroke-width', '1');
    svg.appendChild(dot);
    return svg;
  }

  // ---- Log rendering ----
  function populateUsers() {
    const cur = logUser.value;
    const authors = [...new Set(logCommits.map((c) => c.author))].sort((a, b) => a.localeCompare(b));
    logUser.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All users';
    logUser.appendChild(all);
    for (const a of authors) {
      const o = document.createElement('option');
      o.value = a;
      o.textContent = a;
      logUser.appendChild(o);
    }
    if (authors.includes(cur)) logUser.value = cur;
  }

  function renderLog() {
    const filter = logSearch.value.trim().toLowerCase();
    const user = logUser.value;
    const days = logDate.value ? Number(logDate.value) : 0;
    const dateMin = days ? Date.now() - days * 86400000 : 0;
    logList.innerHTML = '';
    for (let i = 0; i < logCommits.length; i++) {
      const c = logCommits[i];
      if (user && c.author !== user) continue;
      if (dateMin && new Date(c.date).getTime() < dateMin) continue;
      if (filter) {
        const hay = (c.subject + ' ' + c.author + ' ' + c.hash).toLowerCase();
        if (!hay.includes(filter)) continue;
      }
      logList.appendChild(logRow(c, graphRows[i], !filter && !user && !days));
    }
  }

  function logRow(c, gr, withGraph) {
    const row = document.createElement('div');
    row.className = 'log-row' + (c.hash === selectedHash ? ' selected' : '');
    if (withGraph && gr) {
      row.appendChild(graphSvg(gr));
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'lg-graph';
      spacer.style.width = '6px';
      row.appendChild(spacer);
    }

    const subject = document.createElement('span');
    subject.className = 'lg-subject';
    for (const ref of c.refs) subject.appendChild(refChip(ref));
    subject.appendChild(document.createTextNode(c.subject));
    row.appendChild(subject);

    const author = document.createElement('span');
    author.className = 'lg-meta';
    author.textContent = c.author;
    row.appendChild(author);

    const date = document.createElement('span');
    date.className = 'lg-date';
    date.textContent = (c.date || '').slice(0, 10);
    row.appendChild(date);

    row.addEventListener('click', () => {
      selectedHash = c.hash;
      document.querySelectorAll('.log-row').forEach((x) => x.classList.remove('selected'));
      row.classList.add('selected');
      if (detailsCache[c.hash]) renderDetails(detailsCache[c.hash]);
      else {
        logDetails.innerHTML = '<div class="placeholder">Loading...</div>';
        vscode.postMessage({ type: 'commitDetails', hash: c.hash });
      }
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showCtx(e, [
        { label: 'Checkout Revision', cmd: () => vscode.postMessage({ type: 'checkoutRev', hash: c.hash }) },
        { label: 'New Branch from Here...', cmd: () => vscode.postMessage({ type: 'newBranchAt', hash: c.hash }) },
        { label: 'Cherry-Pick', cmd: () => vscode.postMessage({ type: 'cherryPick', hash: c.hash }) },
        { label: 'Revert Commit', cmd: () => vscode.postMessage({ type: 'revertCommit', hash: c.hash }) },
        { label: 'Edit Commit Message...', cmd: () => vscode.postMessage({ type: 'editMessage', hash: c.hash }) },
        { label: 'Undo Commit', cmd: () => vscode.postMessage({ type: 'undoCommit', hash: c.hash }) },
        { label: 'Reset Current Branch to Here...', cmd: () => vscode.postMessage({ type: 'resetTo', hash: c.hash }) },
        { label: 'Squash Commits into One (down to here)', cmd: () => vscode.postMessage({ type: 'squashTo', hash: c.hash }) },
        { label: 'Fixup into Previous', cmd: () => vscode.postMessage({ type: 'fixupCommit', hash: c.hash }) },
        { label: 'Drop Commit', cmd: () => vscode.postMessage({ type: 'dropCommit', hash: c.hash }) },
        { label: 'Interactively Rebase from Here...', cmd: () => vscode.postMessage({ type: 'interactiveRebase', hash: c.hash }) },
        { label: 'New Tag...', cmd: () => vscode.postMessage({ type: 'tagAt', hash: c.hash }) },
        { label: 'Copy Revision Number', cmd: () => vscode.postMessage({ type: 'copyHash', hash: c.hash }) },
        { label: 'Open Commit on Remote', cmd: () => vscode.postMessage({ type: 'openCommitRemote', hash: c.hash }) },
      ]);
    });
    return row;
  }

  function refChip(ref) {
    const chip = document.createElement('span');
    let kind = 'local';
    let text = ref;
    if (ref === 'HEAD') kind = 'head';
    else if (ref.startsWith('tag: ')) {
      kind = 'tag';
      text = ref.slice(5);
    } else if (ref.indexOf('/') >= 0) kind = 'remote';
    chip.className = 'ref ' + kind;
    chip.textContent = text;
    return chip;
  }

  // Render a commit's changed files as a directory tree (JetBrains-style details).
  function detailNode(node, depth, hash, parent) {
    const frag = document.createDocumentFragment();
    for (const dn of [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
      let child = node.dirs.get(dn);
      let label = dn;
      while (child.dirs.size === 1 && child.files.length === 0) {
        const k = [...child.dirs.keys()][0];
        label += '/' + k;
        child = child.dirs.get(k);
      }
      const row = document.createElement('div');
      row.className = 'det-row';
      row.style.paddingLeft = depth * 14 + 'px';
      const ic = document.createElement('i');
      ic.className = 'codicon codicon-folder';
      const nm = document.createElement('span');
      nm.className = 'fname dir';
      nm.textContent = label;
      row.append(ic, nm);
      frag.appendChild(row);
      frag.appendChild(detailNode(child, depth + 1, hash, parent));
    }
    for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
      const code = f.status[0];
      const row = document.createElement('div');
      row.className = 'det-row det-file';
      row.style.paddingLeft = depth * 14 + 'px';
      const letter = document.createElement('span');
      letter.className = 'letter ' + cls(code);
      letter.textContent = code;
      const ic = document.createElement('i');
      ic.className = 'codicon codicon-file';
      const nm = document.createElement('span');
      nm.className = cls(code);
      nm.textContent = baseName(f.path);
      row.append(letter, ic, nm);
      row.addEventListener('click', () => vscode.postMessage({ type: 'openRevDiff', hash, parent, path: f.path }));
      frag.appendChild(row);
    }
    return frag;
  }

  function renderDetails(d) {
    const commit = logCommits.find((c) => c.hash === d.hash);
    logDetails.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'det-head';
    head.textContent = commit
      ? commit.author + ' <' + commit.email + '>  ' + (commit.date || '').replace('T', ' ').slice(0, 16)
      : '';
    logDetails.appendChild(head);

    const hash = document.createElement('div');
    hash.className = 'det-hash';
    hash.textContent = d.hash;
    logDetails.appendChild(hash);

    const message = document.createElement('div');
    message.className = 'det-msg';
    message.textContent = d.body || (commit ? commit.subject : '');
    logDetails.appendChild(message);

    const files = document.createElement('div');
    files.className = 'det-files';
    const parent = commit && commit.parents.length ? commit.parents[0] : '';
    if (d.files.length) {
      files.appendChild(detailNode(buildTree(d.files), 1, d.hash, parent));
    }
    if (d.files.length === 0) {
      const none = document.createElement('div');
      none.className = 'placeholder';
      none.textContent = 'No file changes (merge or empty commit).';
      files.appendChild(none);
    }
    logDetails.appendChild(files);
  }

  // ---- Shelf rendering ----
  function renderShelf() {
    shelfList.innerHTML = '';
    if (!shelfEntries.length) {
      const none = document.createElement('div');
      none.className = 'placeholder';
      none.textContent = 'No shelved changes. Select files in Local Changes and click Shelve.';
      shelfList.appendChild(none);
      return;
    }
    for (const sh of shelfEntries) {
      const node = document.createElement('div');
      node.className = 'cl-node';

      const chev = document.createElement('span');
      chev.className = 'chev' + (shelfCollapsed.has(sh.id) ? ' collapsed' : '');
      chev.textContent = '▾';
      chev.addEventListener('click', (e) => {
        e.stopPropagation();
        if (shelfCollapsed.has(sh.id)) shelfCollapsed.delete(sh.id);
        else shelfCollapsed.add(sh.id);
        renderShelf();
      });

      const icon = document.createElement('i');
      icon.className = 'codicon codicon-archive';
      const name = document.createElement('span');
      name.className = 'cl-name';
      name.textContent = sh.name;
      const meta = document.createElement('span');
      meta.className = 'cl-count';
      meta.textContent =
        sh.files.length + ' file' + (sh.files.length > 1 ? 's' : '') + '  ' + (sh.date || '').slice(0, 16).replace('T', ' ');

      node.append(chev, icon, name, meta);
      node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showCtx(e, [
          { label: 'Unshelve (apply and remove)', cmd: () => vscode.postMessage({ type: 'unshelve', id: sh.id }) },
          { label: 'Delete', cmd: () => vscode.postMessage({ type: 'deleteShelf', id: sh.id }) },
        ]);
      });
      shelfList.appendChild(node);

      if (!shelfCollapsed.has(sh.id)) {
        for (const f of sh.files) {
          const row = document.createElement('div');
          row.className = 'tree-row';
          row.style.paddingLeft = indent(1);
          const fi = document.createElement('i');
          fi.className = 'codicon codicon-file';
          const fname = document.createElement('span');
          fname.className = 'fname';
          fname.textContent = baseName(f);
          const dir = document.createElement('span');
          dir.className = 'fdir';
          dir.textContent = dirName(f);
          row.append(fi, fname, dir);
          shelfList.appendChild(row);
        }
      }
    }
  }

  // ---- Incoming messages ----
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
      logLoaded = false;
    } else if (m.type === 'logData') {
      logCommits = m.commits || [];
      detailsCache = {};
      graphRows = computeGraph(logCommits);
      populateUsers();
      renderLog();
    } else if (m.type === 'commitDetailsData') {
      detailsCache[m.hash] = m;
      if (m.hash === selectedHash) renderDetails(m);
    } else if (m.type === 'shelfData') {
      shelfEntries = m.entries || [];
      renderShelf();
    } else if (m.type === 'lastCommitMessage') {
      amendLoadedMsg = m.message || '';
      if (amend.checked && !msg.value.trim()) {
        msg.value = amendLoadedMsg;
        updateCommitState();
      }
    } else if (m.type === 'consoleData') {
      consoleLogEl.textContent = (m.lines || []).join('\n') + (m.lines && m.lines.length ? '\n' : '');
      consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
    } else if (m.type === 'consoleLine') {
      consoleLogEl.textContent += m.line + '\n';
      consoleLogEl.scrollTop = consoleLogEl.scrollHeight;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
