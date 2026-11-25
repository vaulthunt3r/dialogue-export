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
let notificationPermission = false;
let siteOrigin = null, siteAccessBusy = false;
const inPanel = new URLSearchParams(location.search).get('panel') === '1';
if (inPanel) { document.body.dataset.panel = 'true'; $('collapsePanel').hidden = false; }
function closeMenu() {
  if (inPanel) return send({ type: 'PANEL_COLLAPSE' }).catch(() => {});
  window.close();
}
$('collapsePanel').addEventListener('click', closeMenu);
$('enableSiteAccess').addEventListener('click', async () => {
  if (inPanel || !siteOrigin || siteAccessBusy) return;
  const origin = siteOrigin;
  siteAccessBusy = true; $('enableSiteAccess').disabled = true;
  try {
    // Call directly from the click: Firefox requires an explicit user gesture.
    const granted = await browser.permissions.request({ origins: [origin] });
    text('siteAccessStatus', granted ? 'Automatic site access enabled.' : 'Automatic access was not enabled. You can still start from the toolbar.');
    $('enableSiteAccess').hidden = granted;
    if (granted) await connect();
  } catch (_) {
    text('siteAccessStatus', 'Could not enable access. Right-click the Firefox toolbar icon to manage site permissions.');
  } finally { siteAccessBusy = false; $('enableSiteAccess').disabled = false; }
});

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
function send(message) {
  if (tabId == null) return Promise.reject(new Error('No active tab was found.'));
  return withTimeout(inPanel ? browser.runtime.sendMessage({ type: 'PANEL_SEND', message }) : browser.tabs.sendMessage(tabId, message, { frameId: 0 }), 3000, 'The conversation did not respond. Retrying automatically.');
}
async function ping() {
  try { return await send({ type: 'PING' }); }
  catch (error) {
    if (!/receiving end|establish connection/i.test(error.message || '')) throw error;
    const restored = await withTimeout(browser.runtime.sendMessage({ type: 'ENSURE_CONTENT', tabId }), 8000, 'The page is still loading. Retrying automatically.');
    if (restored?.code === 'SITE_ACCESS_REQUIRED') throw Error('Allow access to this site from the Firefox extension menu, then retry.');
    return send({ type: 'PING' });
  }
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
  return { scope, format, includeTitle: $('includeTitle').checked, includeLinks: $('includeLinks').checked, includeActivity: $('includeActivity').checked, includeTimestamps: $('includeTimestamps').checked, appendDate: $('appendDate').checked, compactPagination: $('compactPagination').checked,
    includeUserImages: $('includeUserImages').checked, includeAssistantImages: $('includeAssistantImages').checked,
    notifyOnCompletion: $('notifyOnCompletion').checked };
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
  $('archiveChats').hidden = info?.provider !== 'ChatGPT';
  $('archiveChats').disabled = state === 'connecting' || busy || info?.activeExport;
  const running = info?.activeExport === true;
  const deciding = info?.exportStatus?.state === 'decision';
  $('stopExport').hidden = !running || deciding;
  $('stopExport').disabled = info?.exportStatus?.cancellable === false;
  $('stopChoices').hidden = !deciding;
  $('saveCollected').disabled = !info?.exportStatus?.canSaveCollected;
  text('saveCollected', info?.exportStatus?.phase === 'saving' ? '[ Save remaining ]' : '[ Save collected ]');
  const ready = state === 'ready';
  const selected = scope === 'selected';
  $('compactPaginationOption').hidden = !['html', 'pdf'].includes(format);
  $('imageOptions').hidden = !['html', 'pdf'].includes(format);
  document.body.dataset.state = ready && !running ? 'ready' : state;
  // The ZIP chooser remains available on an empty ChatGPT chat too.
  const emptyChat = ['waiting', 'disconnected'].includes(state) && info?.provider === 'ChatGPT' && info.count === 0;
  $('controls').disabled = (!ready && !emptyChat) || busy || running;
  $('includeTimestamps').disabled = info?.provider !== 'ChatGPT';
  $('includeActivity').disabled = info?.provider !== 'ChatGPT';
  text('timestampsHint', info?.provider === 'Gemini' ? 'Message timestamps are currently supported for ChatGPT only.' : 'Local date and time for each message, when available.');
  document.querySelectorAll('[name="scope"]').forEach(input => { input.checked = input.value === scope; });
  document.querySelectorAll('[name="format"]').forEach(input => { input.checked = input.value === format; });
  $('selectionTools').hidden = !selected;
  $('scopeHint').dataset.selected = String(selected);
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
  if (ready) text('status', `${info.provider || 'Conversation'} / ${running ? 'exporting' : 'ready'}`);
  const job = info?.exportStatus;
  $('allowImageAccess').hidden = !(['error', 'decision'].includes(job?.state) || job?.partial) || job?.mediaDiagnostic?.download?.code !== 'IMAGE_PERMISSION_REQUIRED';
  const diagnostic = ['error', 'decision'].includes(job?.state) || job?.partial ? job.sourceDiagnostic || job.mediaDiagnostic : null;
  const diagnosticText = diagnostic ? JSON.stringify(diagnostic, null, 2) : '';
  $('exportDiagnostic').hidden = !diagnostic;
  if ($('diagnosticText').textContent !== diagnosticText) {
    text('diagnosticText', diagnosticText); text('copyDiagnostic', '[ Copy diagnostic ]');
    $('exportDiagnostic').open = false;
  }
  $('activity').hidden = !job;
  if (job) {
    $('activity').dataset.state = job.state;
    text('activityTitle', job.state === 'error' ? 'Export stopped' : job.label);
    text('elapsed', elapsed(job));
    text('activityDetail', job.state === 'decision' ? job.stopDetail : job.state === 'error' ? job.label : `${job.processed || 0} messages collected${job.state === 'running' ? ' · working in the conversation tab' : job.format === 'pdf' ? ' · save from the print page' : ' · check Firefox’s save dialog or Downloads'}${job.state === 'done' && job.timestampNotice ? ` · ${job.timestampNotice}` : ''}`);
  }
}
$('allowImageAccess').addEventListener('click', async () => {
  $('allowImageAccess').disabled = true;
  try { await browser.tabs.create({ url: browser.runtime.getURL('popup/image-access.html') }); }
  catch (_) { error('Could not open image settings. Check Dialogue Export permissions in Firefox.'); }
  finally { $('allowImageAccess').disabled = false; }
});
$('copyDiagnostic').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('diagnosticText').textContent); text('copyDiagnostic', '[ Copied ]'); }
  catch (_) {
    const range = document.createRange(); range.selectNodeContents($('diagnosticText'));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    text('copyDiagnostic', '[ Selected — press Ctrl+C ]');
  }
});
function acceptInfo(next) {
  info = next;
  if (next.theme === 'light' || next.theme === 'dark') document.body.dataset.theme = next.theme;
  if (next.picking) scope = 'selected';
}
async function connect() {
  clearTimeout(pollTimer);
  const attempt = ++sequence;
  state = 'connecting'; busy = false; info = null;
  siteOrigin = null; $('siteAccess').hidden = true;
  error(); text('status', 'Connecting to your conversation…'); render();
  let supported = false;
  try {
    const [tabs, saved] = await Promise.all([
      withTimeout(inPanel ? browser.runtime.sendMessage({ type: 'PANEL_CONTEXT' }).then(result => {
        if (!result?.ok) throw new Error('Open the export menu from the conversation tab.');
        notificationPermission = result.notifications === true;
        return [{ id: result.tabId }];
      }) : browser.tabs.query({ active: true, currentWindow: true }), 3000, 'Firefox did not return the active tab.'),
      initialized ? Promise.resolve(null) : withTimeout(browser.storage.local.get(['scope', 'format', 'includeTitle', 'includeLinks', 'includeTimestamps', 'includeActivity', 'appendDate', 'compactPagination', 'includeUserImages', 'includeAssistantImages', 'notifyOnCompletion']), 2500, 'Preferences unavailable').catch(() => ({}))
    ]);
    if (attempt !== sequence) return;
    const tab = tabs[0];
    tabId = tab?.id;
    if (saved) {
      scope = saved.scope === 'selected' ? 'selected' : 'all';
      format = Object.hasOwn(formats, saved.format) ? saved.format : 'md';
      $('includeTitle').checked = saved.includeTitle !== false;
      $('includeLinks').checked = saved.includeLinks !== false;
      $('includeTimestamps').checked = saved.includeTimestamps === true;
      $('appendDate').checked = saved.appendDate === true;
      $('compactPagination').checked = saved.compactPagination === true;
      $('includeActivity').checked = saved.includeActivity === true;
      $('includeUserImages').checked = saved.includeUserImages !== false;
      $('includeAssistantImages').checked = saved.includeAssistantImages !== false;
      if (!inPanel) notificationPermission = !!(await browser.permissions?.contains({ permissions: ['notifications'] }).catch(() => false));
      $('notifyOnCompletion').checked = saved.notifyOnCompletion === true && notificationPermission;
      initialized = true;
    }
    if (tab?.url && !/^https:\/\/(chatgpt\.com|gemini\.google\.com)(\/|$)/i.test(tab.url)) {
      throw new Error('Open a conversation on ChatGPT or Gemini, then open Dialogue Export.');
    }
    supported = Number.isInteger(tabId);
    if (!inPanel && tab?.url && browser.permissions?.contains) {
      const origin = new URL(tab.url).origin + '/*';
      const granted = await withTimeout(browser.permissions.contains({ origins: [origin] }), 2000, 'Site access unavailable').catch(() => null);
      if (attempt !== sequence) return;
      if (granted === false) {
        siteOrigin = origin;
        text('siteAccessStatus', `Automatic access to ${new URL(tab.url).hostname} is off. The page icon may appear only after a toolbar click.`);
        $('enableSiteAccess').hidden = false; $('siteAccess').hidden = false;
      }
    }
    let next;
    for (let retry = 0; retry < 2; retry++) {
      try { next = await ping(); if (!next?.ok) throw new Error('No response'); break; }
      catch (e) { if (retry === 1) throw e; await new Promise(resolve => setTimeout(resolve, 350)); }
    }
    if (attempt !== sequence) return;
    acceptInfo(next);
    if (!$('filename').value) $('filename').value = safeName(next.title);
    state = next.count || next.activeExport ? 'ready' : 'waiting';
    if (state === 'waiting') text('status', 'Waiting for conversation messages…');
    render(); schedulePoll();
  } catch (e) {
    if (attempt !== sequence) return;
    state = 'disconnected';
    text('status', 'Conversation unavailable');
    const message = /receiving end|establish connection|No response/i.test(e.message) ? 'Waiting for the conversation connection. Retrying automatically.' : e.message;
    error(message, true); render();
    if (supported) schedulePoll(2000);
  }
}
function schedulePoll(delay = 1000) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(refresh, delay);
}
async function refresh() {
  if (state === 'disconnected') { await connect(); return; }
  if (busy || !['ready', 'waiting'].includes(state)) { if (['ready', 'waiting'].includes(state)) schedulePoll(); return; }
  const current = sequence;
  try {
    const next = await ping();
    if (current !== sequence) return;
    if (busy) { schedulePoll(); return; }
    if (!next?.ok) throw new Error('Refresh the conversation page, then reconnect.');
    acceptInfo(next);
    state = next.count || next.activeExport ? 'ready' : 'waiting';
    if (state === 'waiting') text('status', 'Waiting for conversation messages…');
    error();
    render(); schedulePoll();
  } catch (e) {
    if (current !== sequence) return;
    state = 'disconnected'; text('status', 'Connection lost');
    error('The conversation is temporarily unavailable. Retrying automatically.', true); render(); schedulePoll(2000);
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
['includeTitle', 'includeLinks', 'includeTimestamps', 'includeActivity', 'appendDate', 'compactPagination', 'includeUserImages', 'includeAssistantImages'].forEach(id => $(id).addEventListener('change', () => { savePreferences(); render(); }));
$('notifyOnCompletion').addEventListener('change', async () => {
  error();
  if ($('notifyOnCompletion').checked) {
    if (inPanel) {
      if (!notificationPermission) {
        $('notifyOnCompletion').checked = false;
        try { await browser.runtime.sendMessage({ type: 'PANEL_NOTIFICATION_SETTINGS' }); }
        catch (_) { error('Open the Firefox toolbar menu to enable notifications.'); }
      }
      savePreferences(); render(); return;
    }
    busy = true; render();
    try {
      // Request directly in this user gesture, before awaiting any other work.
      $('notifyOnCompletion').checked = await browser.permissions.request({ permissions: ['notifications'] });
      if (!$('notifyOnCompletion').checked) error('Notifications remain off. Export status is still shown in the conversation tab.');
    } catch (_) {
      $('notifyOnCompletion').checked = false;
      error('Firefox could not enable notifications. Export status is still shown in the conversation tab.');
    } finally { busy = false; }
  }
  savePreferences(); render();
});
$('filename').addEventListener('input', render);
$('stopExport').addEventListener('click', async () => {
  $('stopExport').disabled = true;
  try { await send({ type: 'STOP_EXPORT' }); }
  catch (e) { error(e.message); }
});
for (const [id, action] of [['saveCollected', 'save'], ['discardCollected', 'discard']]) $(id).addEventListener('click', async () => {
  $('saveCollected').disabled = true; $('discardCollected').disabled = true;
  try {
    const result = await send({ type: 'RESOLVE_STOP', action });
    if (!result?.ok) throw Error('This stop choice is no longer available. Reopen the export menu.');
  } catch (e) { error(e.message); }
  finally { $('discardCollected').disabled = false; }
});
$('retry').addEventListener('click', connect);
$('selectionMode').addEventListener('click', async () => {
  if (busy || state !== 'ready' || info?.activeExport) return;
  busy = true; error(); render();
  try {
    const result = await send({ type: 'SET_PICKING', enabled: true });
    if (!result?.ok) throw new Error(result?.error || 'Could not start message selection.');
    info.picking = true; scope = 'selected'; savePreferences(); closeMenu();
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
    const result = await send({ type: 'BEGIN_EXPORT', job: { format, filename: filename(), options: { selectedOnly: scope === 'selected', includeTitle: $('includeTitle').checked, includeLinks: $('includeLinks').checked, includeActivity: $('includeActivity').checked && info.provider === 'ChatGPT', includeTimestamps: $('includeTimestamps').checked && info.provider === 'ChatGPT', compactPagination: ['html', 'pdf'].includes(format) && $('compactPagination').checked,
      includeUserImages: !['html', 'pdf'].includes(format) || $('includeUserImages').checked, includeAssistantImages: !['html', 'pdf'].includes(format) || $('includeAssistantImages').checked,
      notifyOnCompletion: $('notifyOnCompletion').checked } } });
    if (!result?.ok) throw new Error(result?.error || 'The export could not start.');
    info.activeExport = true;
    info.exportStatus = result.exportStatus || { state: 'running', label: 'Preparing export', startedAt: Date.now(), processed: 0, format };
    if (inPanel) closeMenu();
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
$('archiveChats').addEventListener('click', async () => {
  try {
    const result = await browser.runtime.sendMessage({ type: 'ARCHIVE_OPEN', tabId });
    if (!result?.ok) throw Error(result?.error || 'Could not open the chat archive.');
    closeMenu();
  } catch (e) { error(e.message); }
});
window.addEventListener('pagehide', () => { ++sequence; clearTimeout(pollTimer); });
if (inPanel && typeof ResizeObserver !== 'undefined') {
  let previousHeight = 0;
  const resize = new ResizeObserver(() => {
    // Measure natural settings height independently of this iframe's current viewport.
    const chrome = [...document.querySelectorAll('body>header, body>footer, .export-actions')]
      .reduce((sum, node) => { const style = getComputedStyle(node); return sum + node.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom); }, 20);
    const height = Math.min(440, Math.ceil(chrome + $('settingsContents').getBoundingClientRect().height));
    if (height === previousHeight) return;
    previousHeight = height;
    browser.runtime.sendMessage({ type: 'PANEL_SIZE', height }).catch(() => {});
  });
  ['settingsContents','errorBox','archiveChats'].forEach(id => resize.observe($(id)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
}
if (inPanel) browser.storage.onChanged?.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.notifyOnCompletion) return;
  const result = await browser.runtime.sendMessage({ type: 'PANEL_CONTEXT' }).catch(() => null);
  notificationPermission = result?.notifications === true;
  $('notifyOnCompletion').checked = changes.notifyOnCompletion.newValue === true && notificationPermission;
});
connect();
