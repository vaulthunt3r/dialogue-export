const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
const pageSize = 20;
let items = [], selected = new Set(), page = 0, busy = false, timer, listLoaded = false, pending = false;
let failureSignature = '';
async function send(type, fields = {}) {
  const result = await browser.runtime.sendMessage({ type, id, ...fields });
  if (!result?.ok) throw Error(result?.error || 'The archive session is unavailable. Reopen it from the export menu.');
  return result;
}
function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function drawList() {
  const query = $('search').value.trim().toLocaleLowerCase(), filtered = items.filter(item => item.title.toLocaleLowerCase().includes(query));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)); page = Math.min(page, pages - 1);
  $('list').replaceChildren();
  for (const item of filtered.slice(page * pageSize, page * pageSize + pageSize)) {
    const label = document.createElement('label'); label.className = 'chat';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(item.id); input.disabled = busy;
    input.addEventListener('change', () => { input.checked ? selected.add(item.id) : selected.delete(item.id); drawCount(); });
    const title = document.createElement('span'); title.textContent = item.title;
    if (item.archived) { const note = document.createElement('small'); note.textContent = ' [archived]'; title.append(note); }
    label.append(input, title); $('list').append(label);
  }
  const first = filtered.length ? page * pageSize + 1 : 0, last = Math.min(filtered.length, (page + 1) * pageSize);
  $('page').textContent = `${page + 1} / ${pages} · showing ${first}–${last} of ${filtered.length}`;
  $('previous').disabled = page === 0; $('next').disabled = page + 1 >= pages; drawCount();
}
function drawCount() { $('count').textContent = `${items.length} found · ${selected.size} selected`; $('run').disabled = busy || pending || !selected.size || !listLoaded; }
function controls() { for (const key of ['load','archived','format','all','none']) $(key).disabled = busy || pending; $('stop').disabled = pending; drawCount(); }
function drawActivity(state) {
  const seconds = state.startedAt == null ? 0 : Math.max(0, Math.floor(((state.finishedAt ?? Date.now()) - state.startedAt) / 1000));
  $('elapsed').textContent = state.startedAt == null ? '' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const stages = ['load','read','save'], stage = Math.max(0, stages.indexOf(state.stage));
  document.querySelectorAll('[data-stage]').forEach((node, index) => {
    node.className = state.running ? index === stage ? 'current' : index < stage ? 'done' : '' : state.state === 'done' ? 'done' : '';
  });
  const position = Math.floor(Date.now() / 600) % 12;
  $('activityBar').textContent = state.running ? '[' + '.'.repeat(position) + '>' + '.'.repeat(11 - position) + ']'
    : state.state === 'done' ? '[############]'
    : ['partial','error'].includes(state.state) ? '[! see details]'
    : state.state === 'stopped' ? '[ stopped ]' : '[............]';
}
function drawFailures(state) {
  const failures = state.failures || [], signature = JSON.stringify([state.failed || 0, failures]);
  if (signature === failureSignature) return;
  failureSignature = signature;
  $('failureDetails').hidden = !state.failed;
  $('failureSummary').textContent = `Failed chats (${state.failed || 0}) — show reasons`;
  $('failureHint').textContent = state.failed > failures.length ? `Showing the last ${failures.length}. The JSON report contains every failure.` : 'These chats are not included in the ZIP.';
  $('failureList').replaceChildren();
  for (const failure of failures) {
    const item = document.createElement('li'), title = document.createElement('a');
    title.textContent = failure.title || 'Untitled';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(failure.id)) {
      title.href = `https://chatgpt.com/c/${failure.id}`; title.target = '_blank'; title.rel = 'noopener noreferrer';
    }
    const reason = document.createElement('p'); reason.textContent = failure.reason;
    const code = document.createElement('code'); code.textContent = failure.code;
    item.append(title, reason, code);
    if (failure.suggestion) {const next = document.createElement('p'); next.textContent = failure.suggestion; item.append(next);}
    $('failureList').append(item);
  }
}
async function refresh() {
  clearTimeout(timer);
  try {
    const state = await send('ARCHIVE_STATE');
    const changed = busy !== state.running; busy = state.running;
    drawActivity(state);
    drawFailures(state);
    $('stop').hidden = !busy; $('report').hidden = busy || !state.hasReport;
    $('progress').textContent = state.selected ? `${state.processed} / ${state.selected} processed · ${state.ready || 0} ready to save · ${state.saved} saved · ${state.failed} failed · ${state.parts} ZIP parts saved${!state.running && state.notAttempted ? ` · ${state.notAttempted} not attempted` : ''}` : `${state.count} chats found`;
    $('status').textContent = state.label || ({ idle:'Ready to load the list.', listed:'List loaded. Choose a few chats for the first test.', done:'Finished. ZIP parts and report saved to Downloads.',
      partial:state.saved ? 'Finished with skipped chats. Saved chats are in Downloads; expand the failure details.' : 'Finished. No chats exported; expand the failure details.', stopped:'Stopped. Completed ZIP downloads are kept. Save the report for details.', error:state.saved ? `Archive stopped. ${state.saved} chats saved to Downloads; see details below.` : 'Archive stopped. No chat downloads were confirmed; see the reason below.' }[state.state] || state.state);
    error(state.error ? `${state.errorCode ? `[${state.errorCode}] ` : ''}${state.error}` : '');
    if (state.listReady && !listLoaded) { items = (await send('ARCHIVE_ITEMS')).items; selected.clear(); listLoaded = true; $('selection').hidden = false; drawList(); }
    if (changed) drawList(); controls();
  } catch (e) { busy = false; drawActivity({ state: 'error' }); $('status').textContent = 'Archive status unavailable.'; $('stop').hidden = true; error(e.message); $('run').disabled = true; $('load').disabled = true; return; }
  timer = setTimeout(refresh, 750);
}
async function action(run) {
  if (pending) return; pending = true; error(); controls();
  try { await run(); }
  catch (e) { error(e.message); pending = false; controls(); return; }
  pending = false; await refresh();
}
$('load').addEventListener('click', () => action(async () => {
  await send('ARCHIVE_LIST', { archived: $('archived').checked }); listLoaded = false; selected.clear(); items = []; $('selection').hidden = true;
}));
$('run').addEventListener('click', () => action(() => send('ARCHIVE_RUN', { ids: [...selected], format: $('format').value })));
$('stop').addEventListener('click', () => action(() => send('ARCHIVE_STOP')));
$('report').addEventListener('click', () => action(() => send('ARCHIVE_REPORT')));
$('all').addEventListener('click', () => { selected = new Set(items.map(item => item.id)); drawList(); });
$('none').addEventListener('click', () => { selected.clear(); drawList(); });
$('search').addEventListener('input', () => { page = 0; drawList(); });
$('previous').addEventListener('click', () => { page--; drawList(); });
$('next').addEventListener('click', () => { page++; drawList(); });
window.addEventListener('pagehide', () => clearTimeout(timer));
refresh();
