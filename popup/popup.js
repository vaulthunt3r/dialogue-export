/* Popup owns preferences and presentation; collection stays in the content script. */
const $ = id => document.getElementById(id);
const formats = {
  txt: 'Plain text · easy to read in any text editor.',
  md: 'Markdown · for notes and text editors.',
  html: 'Web page · open the saved file in a browser.',
  json: 'Structured data · for tools and backups.',
  pdf: 'Opens a print page. Then choose “Save to PDF”.'
};
let tabId;
let info = null;
let state = 'connecting';
let busy = false;
let scope = 'all';
let format = 'md';
let pollTimer;
let storageQueue = Promise.resolve();
let initialized = false;
let sequence = 0;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
function send(message) {
  if (tabId == null) return Promise.reject(new Error('No active tab was found.'));
  return withTimeout(browser.tabs.sendMessage(tabId, message), 3000, 'The conversation did not respond. Refresh the page, then try again.');
}
function text(id, value) { if ($(id).textContent !== value) $(id).textContent = value; }
function error(message = '', retry = false) {
  text('error', message);
  $('errorBox').hidden = !message;
  $('retry').hidden = !retry;
}
function safeName(value) {
  let name = String(value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
    .replace(/\.(txt|md|html|json|pdf)$/i, '').trim().replace(/\s+/g, '-').replace(/^\.+|[. -]+$/g, '');
  name = Array.from(name).slice(0, 100).join('').replace(/[. -]+$/g, '') || 'conversation';
  // Leave room for the date and extension under common 255-byte filename limits.
  let bytes = 0;
  name = Array.from(name).filter(character => {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) return false;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    return bytes <= 180;
  }).join('').replace(/[. -]+$/g, '') || 'conversation';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `conversation-${name}`;
  return name;
}
function filename() {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  return `${safeName($('filename').value)}${$('appendDate').checked ? `-${date}` : ''}.${format}`;
}
function preferences() {
  return { scope, format, includeTitle: $('includeTitle').checked, includeLinks: $('includeLinks').checked, appendDate: $('appendDate').checked };
}
function savePreferences() {
  const saved = preferences();
  storageQueue = storageQueue.catch(() => {}).then(() => withTimeout(browser.storage.local.set(saved), 2500, 'Preferences could not be saved.'));
  storageQueue.catch(() => error('Your choices work for this export, but Firefox could not remember them.'));
}
function elapsed(job) {
  const seconds = Math.max(0, Math.floor(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function render() {
  const running = info?.activeExport === true;
  const ready = state === 'ready';
  const selected = scope === 'selected';
  document.body.dataset.state = ready && !running ? 'ready' : state;
  $('controls').disabled = !ready || busy || running;
  document.querySelectorAll('[name="scope"]').forEach(input => { input.checked = input.value === scope; });
  document.querySelectorAll('[name="format"]').forEach(input => { input.checked = input.value === format; });
  $('selectionTools').hidden = !selected;
  $('clearSelection').disabled = !info?.selected;
  text('selectionMode', info?.picking ? 'Continue choosing' : info?.selected ? 'Change selection' : 'Choose messages');
  text('scopeHint', selected ? info?.selected ? `${info.selected} selected · only these messages will be exported.` : 'Choose at least one message on the page.' : 'Earlier messages are loaded automatically.');
  text('formatHint', formats[format]);
  text('extension', `.${format}`);
  const name = filename();
  text('filenamePreview', `${format === 'pdf' ? 'Suggested name' : 'Save as'}: ${name}`);
  $('filenamePreview').title = name;
  $('exportButton').disabled = !ready || busy || running || (selected && !info?.selected);
  text('exportLabel', state === 'connecting' ? 'Connecting…' : !ready ? 'Conversation unavailable' : busy ? 'Starting export…' : running ? 'Export in progress…' : format === 'pdf' ? 'Prepare PDF' : `Export ${format.toUpperCase()}`);
  text('actionHint', running ? 'You can close this popup. Keep the conversation tab open.' : selected && !info?.selected ? 'Use “Choose messages” to select messages on the page.' : format === 'pdf' ? 'Save the PDF from Firefox’s print dialog.' : 'Firefox will ask where to save your file.');
  if (ready) text('status', `${info.provider || 'Conversation'} · ${running ? 'exporting' : 'ready to export'}`);
  const job = info?.exportStatus;
  $('activity').hidden = !job;
  if (job) {
    $('activity').dataset.state = job.state;
    text('activityTitle', job.state === 'error' ? 'Export stopped' : job.label);
    text('elapsed', elapsed(job));
    text('activityDetail', job.state === 'error' ? job.label : `${job.processed || 0} messages collected${job.state === 'running' ? ' · working in the conversation tab' : job.format === 'pdf' ? ' · save from the print page' : ' · check Firefox’s save dialog or Downloads'}`);
  }
}
function acceptInfo(next) {
  info = next;
  if (next.theme === 'light' || next.theme === 'dark') document.body.dataset.theme = next.theme;
  if (next.picking) scope = 'selected';
}
async function connect() {
  clearTimeout(pollTimer);
  const attempt = ++sequence;
  state = 'connecting'; busy = false; info = null;
  error(); text('status', 'Connecting to your conversation…'); render();
  try {
    const [tabs, saved] = await Promise.all([
      withTimeout(browser.tabs.query({ active: true, currentWindow: true }), 3000, 'Firefox did not return the active tab.'),
      initialized ? Promise.resolve(null) : withTimeout(browser.storage.local.get(['scope', 'format', 'includeTitle', 'includeLinks', 'appendDate']), 2500, 'Preferences unavailable').catch(() => ({}))
    ]);
    if (attempt !== sequence) return;
    const tab = tabs[0];
    tabId = tab?.id;
    if (saved) {
      scope = saved.scope === 'selected' ? 'selected' : 'all';
      format = Object.hasOwn(formats, saved.format) ? saved.format : 'md';
      $('includeTitle').checked = saved.includeTitle !== false;
      $('includeLinks').checked = saved.includeLinks !== false;
      $('appendDate').checked = saved.appendDate === true;
      initialized = true;
    }
    if (tab?.url && !/^https:\/\/(chatgpt\.com|gemini\.google\.com)(\/|$)/i.test(tab.url)) {
      throw new Error('Open a conversation on ChatGPT or Gemini, then open Dialogue Export.');
    }
    let next;
    for (let retry = 0; retry < 2; retry++) {
      try { next = await send({ type: 'PING' }); if (!next?.ok) throw new Error('No response'); break; }
      catch (e) { if (retry === 1) throw e; await new Promise(resolve => setTimeout(resolve, 350)); }
    }
    if (attempt !== sequence) return;
    if (!next.count && !next.activeExport) throw new Error('No messages found yet. Open a conversation, wait for its messages to appear, then try again.');
    acceptInfo(next);
    if (!$('filename').value) $('filename').value = safeName(next.title);
    state = 'ready'; render(); schedulePoll();
  } catch (e) {
    if (attempt !== sequence) return;
    state = 'disconnected';
    text('status', 'Conversation unavailable');
    const message = /receiving end|establish connection|No response/i.test(e.message) ? 'Refresh the conversation page, then try connecting again.' : e.message;
    error(message, true); render();
  }
}
function schedulePoll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refresh, 1000);
}
async function refresh() {
  if (busy || state !== 'ready') { if (state === 'ready') schedulePoll(); return; }
  const current = sequence;
  try {
    const next = await send({ type: 'PING' });
    if (current !== sequence) return;
    if (busy) { schedulePoll(); return; }
    if (!next?.ok) throw new Error('Refresh the conversation page, then reconnect.');
    acceptInfo(next);
    if (!next.count && !next.activeExport) throw new Error('This page has no messages to export. Open a conversation and reconnect.');
    render(); schedulePoll();
  } catch (e) {
    if (current !== sequence) return;
    state = 'disconnected'; text('status', 'Connection lost');
    error('The conversation is no longer responding. Refresh the page if needed, then reconnect.', true); render();
  }
}
async function chooseScope(next) {
  if (busy || state !== 'ready' || info?.activeExport) return;
  busy = true; error(); render();
  try {
    // Complete the page action before changing the visible scope.
    if (next === 'all' && info.picking) {
      const result = await send({ type: 'SET_PICKING', enabled: false });
      if (!result?.ok) throw new Error(result?.error || 'Could not finish message selection.');
      info.picking = false;
    }
    scope = next; savePreferences();
  } catch (e) { error(e.message); }
  finally { busy = false; render(); }
}
document.querySelectorAll('[name="scope"]').forEach(input => input.addEventListener('change', () => chooseScope(input.value)));
document.querySelectorAll('[name="format"]').forEach(input => input.addEventListener('change', () => { format = input.value; error(); savePreferences(); render(); }));
['includeTitle', 'includeLinks', 'appendDate'].forEach(id => $(id).addEventListener('change', () => { savePreferences(); render(); }));
$('filename').addEventListener('input', render);
$('retry').addEventListener('click', connect);
$('selectionMode').addEventListener('click', async () => {
  if (busy || state !== 'ready' || info?.activeExport) return;
  busy = true; error(); render();
  try {
    const result = await send({ type: 'SET_PICKING', enabled: true });
    if (!result?.ok) throw new Error(result?.error || 'Could not start message selection.');
    info.picking = true; scope = 'selected'; savePreferences(); window.close();
  } catch (e) { error(e.message); }
  finally { busy = false; render(); }
});
$('clearSelection').addEventListener('click', async () => {
  if (busy || state !== 'ready' || info?.activeExport) return;
  busy = true; error(); render();
  try { const result = await send({ type: 'CLEAR_SELECTION' }); if (!result?.ok) throw new Error(result?.error || 'Could not clear selection.'); info.selected = 0; }
  catch (e) { error(e.message); }
  finally { busy = false; render(); }
});
$('exportForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || state !== 'ready' || info?.activeExport || (scope === 'selected' && !info?.selected)) return;
  busy = true; error(); render();
  savePreferences();
  const previousJob = info?.exportStatus?.startedAt;
  try {
    const result = await send({ type: 'BEGIN_EXPORT', job: { format, filename: filename(), options: { selectedOnly: scope === 'selected', includeTitle: $('includeTitle').checked, includeLinks: $('includeLinks').checked } } });
    if (!result?.ok) throw new Error(result?.error || 'The export could not start.');
    info.activeExport = true;
    info.exportStatus = result.exportStatus || { state: 'running', label: 'Preparing export', startedAt: Date.now(), processed: 0, format };
  } catch (e) {
    // A delayed acknowledgement must not cause a second export.
    try {
      const next = await send({ type: 'PING' });
      if (!next?.ok) throw e;
      acceptInfo(next);
      if (!next.activeExport && (!next.exportStatus || next.exportStatus.startedAt === previousJob)) error(e.message);
    }
    catch { state = 'disconnected'; text('status', 'Export status unavailable'); error('Could not confirm the export status. Check the conversation tab before trying again.', true); }
  } finally { busy = false; render(); if (state === 'ready') schedulePoll(); }
});
text('version', `v${browser.runtime.getManifest().version}`);
window.addEventListener('pagehide', () => { ++sequence; clearTimeout(pollTimer); });
connect();
