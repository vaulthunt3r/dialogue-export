const $ = selector => document.querySelector(selector);
let tabId;
let picking = false;
let messageCount = 0;
let selectedCount = 0;
let scope = 'all';
let provider = '';

function slug(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '-').slice(0, 100) || 'dialogue-export';
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(promise).then(
      result => { clearTimeout(timer); resolve(result); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

async function send(message, timeoutMs = 2500) {
  if (!tabId) throw new Error('The active tab was not found.');
  return withTimeout(
    browser.tabs.sendMessage(tabId, message),
    timeoutMs,
    'The conversation page did not respond. Reload it and try again.'
  );
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pingConversation() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const info = await send({ type: 'PING' });
      if (info?.ok) return info;
    } catch (error) {
      lastError = error;
    }
    await pause(250);
  }
  throw lastError || new Error('The conversation page did not respond. Reload it and try again.');
}

function fail(error) {
  const message = error?.message || String(error);
  $('#status').textContent = 'Could not connect to this conversation';
  $('#status').classList.remove('ready');
  $('#error').textContent = message;
}

function renderState() {
  document.querySelectorAll('[name="scope"]').forEach(input => { input.checked = input.value === scope; });

  const selectedMode = scope === 'selected';
  $('#selectionTools').hidden = !selectedMode;
  $('#status').textContent = selectedMode
    ? selectedCount ? `${selectedCount} selected — choose a format` : 'Choose messages to continue'
    : `${provider || 'Conversation'} ready — choose a format`;
  $('#selectionMode').textContent = picking
    ? 'Finish selection'
    : selectedCount ? 'Change selection' : 'Choose messages';
  $('#clearSelection').disabled = selectedCount === 0;
  $('#selectionHint').textContent = selectedCount
    ? `${selectedCount} message${selectedCount === 1 ? '' : 's'} ready to export.`
    : 'Choose at least one message to enable export.';

  document.querySelectorAll('[data-format]').forEach(button => {
    button.disabled = selectedMode && selectedCount === 0;
  });
}

async function setScope(nextScope) {
  scope = nextScope === 'selected' ? 'selected' : 'all';
  if (scope === 'all' && picking) {
    await send({ type: 'SET_PICKING', enabled: false });
    picking = false;
  }
  await browser.storage.local.set({ scope });
  renderState();
}

async function init() {
  try {
    const savedPromise = withTimeout(
      browser.storage.local.get(['includeTitle', 'includeLinks', 'scope']),
      2500,
      'Settings took too long to load.'
    ).catch(() => ({}));
    const [tab] = await withTimeout(
      browser.tabs.query({ active: true, currentWindow: true }),
      2500,
      'Firefox did not return the active tab.'
    );
    tabId = tab?.id;
    const info = await pingConversation();
    if (!info.count) throw new Error('No messages were found on this page.');
    messageCount = info.count;
    selectedCount = info.selected;
    provider = info.provider || '';
    document.body.dataset.theme = info.theme === 'light' ? 'light' : 'dark';
    $('#filename').value = slug(info.title);
    picking = Boolean(info.picking);
    const saved = await savedPromise;
    scope = picking || saved.scope === 'selected' ? 'selected' : 'all';
    if (typeof saved.includeTitle === 'boolean') $('#includeTitle').checked = saved.includeTitle;
    if (typeof saved.includeLinks === 'boolean') $('#includeLinks').checked = saved.includeLinks;
    $('#status').classList.add('ready');
    renderState();
  } catch (error) {
    const message = error?.message || String(error);
    fail(new Error(/receiving end|could not establish connection|no matching message handler/i.test(message)
      ? 'Reload the ChatGPT or Gemini conversation page, then open Dialogue Export again.'
      : message));
    document.querySelectorAll('button').forEach(button => button.disabled = true);
  }
}

function options() {
  return {
    selectedOnly: scope === 'selected',
    includeTitle: $('#includeTitle').checked,
    includeLinks: $('#includeLinks').checked
  };
}

async function download(format) {
  try {
    $('#error').textContent = '';
    const opts = options();
    await browser.storage.local.set({ includeTitle: opts.includeTitle, includeLinks: opts.includeLinks });
    const result = await send({ type: 'BEGIN_EXPORT', job: { format, options: opts, filename: `${slug($('#filename').value)}.${format}` } });
    if (!result?.ok) throw new Error('Could not start the export.');
    window.close();
  } catch (error) { fail(error); }
}

document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => download(button.dataset.format)));
document.querySelectorAll('[name="scope"]').forEach(input => input.addEventListener('change', async () => {
  try {
    $('#error').textContent = '';
    await setScope(input.value);
  } catch (error) { fail(error); }
}));
$('#selectionMode').addEventListener('click', async () => {
  try {
    $('#error').textContent = '';
    if (picking) {
      await send({ type: 'SET_PICKING', enabled: false });
      picking = false;
      const info = await send({ type: 'PING' });
      messageCount = info.count;
      selectedCount = info.selected;
      renderState();
      return;
    }

    await setScope('selected');
    await send({ type: 'SET_PICKING', enabled: true });
    picking = true;
    renderState();
    window.close();
  } catch (error) { fail(error); }
});
$('#clearSelection').addEventListener('click', async () => {
  try {
    $('#error').textContent = '';
    await send({ type: 'CLEAR_SELECTION' });
    selectedCount = 0;
    renderState();
  } catch (error) { fail(error); }
});
init();
