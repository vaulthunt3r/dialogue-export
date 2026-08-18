const $ = selector => document.querySelector(selector);
let tabId;
let picking = false;

function slug(value) {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '-').slice(0, 100) || 'dialog-chatgpt';
}

async function send(message) {
  if (!tabId) throw new Error('The active tab was not found.');
  return browser.tabs.sendMessage(tabId, message);
}

function fail(error) { $('#error').textContent = error?.message || String(error); }

async function init() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    const info = await send({ type: 'PING' });
    if (!info.count) throw new Error('No messages were found on this page.');
    $('#status').textContent = `${info.count} messages, ${info.selected} selected`;
    $('#status').classList.add('ready');
    $('#filename').value = slug(info.title);
    picking = Boolean(info.picking);
    $('#selectionMode').textContent = picking ? 'Finish selection' : 'Select messages';
    const saved = await browser.storage.local.get(['includeTitle', 'includeLinks']);
    if (typeof saved.includeTitle === 'boolean') $('#includeTitle').checked = saved.includeTitle;
    if (typeof saved.includeLinks === 'boolean') $('#includeLinks').checked = saved.includeLinks;
  } catch (error) {
    fail(new Error('Open a conversation on chatgpt.com and try again.'));
    document.querySelectorAll('button').forEach(button => button.disabled = true);
  }
}

function options() {
  return {
    selectedOnly: document.querySelector('[name="scope"]:checked').value === 'selected',
    includeTitle: $('#includeTitle').checked,
    includeLinks: $('#includeLinks').checked
  };
}

async function collect() {
  const opts = options();
  await browser.storage.local.set({ includeTitle: opts.includeTitle, includeLinks: opts.includeLinks });
  $('#status').textContent = opts.selectedOnly ? 'Collecting selected messages…' : 'Scanning the conversation…';
  const data = await send({ type: 'COLLECT', options: opts });
  $('#status').textContent = `Collected: ${data.messages.length} messages`;
  if (!data.messages.length) throw new Error(opts.selectedOnly ? 'Select at least one message first.' : 'No messages found.');
  return { data, opts };
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
$('#selectionMode').addEventListener('click', async () => {
  try {
    picking = !picking;
    await send({ type: 'SET_PICKING', enabled: picking });
    $('#selectionMode').textContent = picking ? 'Finish selection' : 'Select messages';
    if (picking) { document.querySelector('[name="scope"][value="selected"]').checked = true; window.close(); }
  } catch (error) { fail(error); }
});
$('#clearSelection').addEventListener('click', async () => { try { await send({ type: 'CLEAR_SELECTION' }); $('#status').textContent = $('#status').textContent.replace(/\d+ selected/, '0 selected'); } catch (error) { fail(error); } });
$('#pdf').addEventListener('click', async () => {
  try {
    const opts = options();
    await browser.storage.local.set({ includeTitle: opts.includeTitle, includeLinks: opts.includeLinks });
    const result = await send({ type: 'BEGIN_EXPORT', job: { format: 'pdf', options: opts, filename: `${slug($('#filename').value)}.pdf` } });
    if (!result?.ok) throw new Error('Could not start the PDF export.');
    window.close();
  } catch (error) { fail(error); }
});
init();
