(function () {
  const vscode = acquireVsCodeApi();
  let OURS = '';
  let THEIRS = '';
  let WORKING = '';
  const $ = (id) => document.getElementById(id);
  const result = $('result');

  $('yours').onclick = () => {
    result.value = OURS;
  };
  $('theirs').onclick = () => {
    result.value = THEIRS;
  };
  $('both').onclick = () => {
    result.value = OURS + (OURS.endsWith('\n') || OURS === '' ? '' : '\n') + THEIRS;
  };
  $('useYours').onclick = () => resolveNext(1);
  $('useTheirs').onclick = () => resolveNext(2);
  $('apply').onclick = () => vscode.postMessage({ type: 'apply', content: result.value });
  $('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });

  // Replace the next conflict block with the chosen side (1 = ours, 2 = theirs).
  function resolveNext(side) {
    const re = /<<<<<<<[^\n]*\n([\s\S]*?)(?:\n\|\|\|\|\|\|\|[^\n]*\n[\s\S]*?)?\n=======\n([\s\S]*?)\n>>>>>>>[^\n]*/;
    const m = re.exec(result.value);
    if (!m) return;
    const repl = side === 1 ? m[1] : m[2];
    result.value = result.value.slice(0, m.index) + repl + result.value.slice(m.index + m[0].length);
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m.type === 'init') {
      OURS = m.ours || '';
      THEIRS = m.theirs || '';
      WORKING = m.working || '';
      $('oursPane').textContent = OURS;
      $('theirsPane').textContent = THEIRS;
      result.value = WORKING;
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
