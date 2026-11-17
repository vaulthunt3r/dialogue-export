const temporaryUrls = new Map();
const printJobs = new Map();
const maxContentCharacters = 16 * 1024 * 1024;
const maxRetainedCharacters = 32 * 1024 * 1024;
let retainedCharacters = 0;
let preparingFile = false;
const partDownloads = new Map();
const ownerOf = sender => `${sender.tab?.id ?? 'extension'}:${sender.frameId || 0}`;
const dataSize = data => data.messages.reduce((sum, message) => sum + ['id', 'text', 'markdown', 'html'].reduce((n, key) => n + (message[key]?.length || 0), 0), 0);

async function notifyExport(request, failed = false) {
  if (request.notify !== true) return;
  try {
    if (!await browser.permissions.contains({ permissions: ['notifications'] })) return;
    const parts = Number.isSafeInteger(request.parts) && request.parts > 1 ? request.parts : 1;
    const message = failed ? 'Export stopped. Open Dialogue Export for details.'
      : request.format === 'pdf' ? `PDF layout ready${parts > 1 ? `: ${parts} parts` : ''}. Save from the print page.`
      : request.format === 'html' && parts > 1 ? `${parts} HTML parts saved to Downloads.`
      : 'File sent to Firefox. Check the save dialog or Downloads.';
    await browser.notifications.create('dialogue-export-result', { type: 'basic', iconUrl: browser.runtime.getURL('icons/icon-96.png'), title: 'Dialogue Export', message });
  } catch (_) { /* Permission revocation or OS notification failure cannot fail an export. */ }
}

function checkSize(size) {
  if (size > maxContentCharacters) throw new Error('This export exceeds the content memory limit. Export fewer selected messages. No partial file was saved.');
}

function reserveContent(content) {
  checkSize(content.length);
  if (retainedCharacters + content.length > maxRetainedCharacters) {
    throw new Error('Previous exports are still being handed to Firefox. Finish them before exporting again.');
  }
  const size = content.length;
  retainedCharacters += size;
  let released = false;
  return () => { if (!released) { released = true; retainedCharacters -= size; } };
}

async function download(content, mime, filename, saveAs = true) {
  const release = reserveContent(content);
  let url, timer, downloadId;
  const dispose = () => {
    if (url) URL.revokeObjectURL(url);
    clearTimeout(timer); temporaryUrls.delete(downloadId); release();
  };
  try {
    url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    downloadId = await browser.downloads.download({ url, filename, saveAs, conflictAction: 'uniquify' });
    temporaryUrls.set(downloadId, dispose);
    timer = setTimeout(dispose, 10 * 60 * 1000);
    // A small download can finish before download() resolves and before its
    // listener is registered in our map. Reconcile that race once.
    if (browser.downloads.search) {
      const [item] = await browser.downloads.search({ id: downloadId });
      if (item && ['complete', 'interrupted'].includes(item.state)) dispose();
    }
    return downloadId;
  } catch (error) { dispose(); throw error; }
}

async function waitForDownload(id, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); browser.downloads.onChanged.removeListener(changed); signal.removeEventListener('abort', abort); };
    const finish = error => { cleanup(); error ? reject(error) : resolve(); };
    const abort = () => { browser.downloads.cancel(id).catch(() => {}); finish(new Error('Multipart export stopped.')); };
    const changed = delta => {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') finish();
      else if (delta.state?.current === 'interrupted' || delta.error) finish(new Error('Firefox interrupted a part download.'));
    };
    browser.downloads.onChanged.addListener(changed);
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { browser.downloads.cancel(id).catch(() => {}); finish(new Error('The part download did not finish in time.')); }, 10 * 60 * 1000);
    if (signal.aborted) { abort(); return; }
    browser.downloads.search({ id }).then(([item]) => {
      if (item?.state === 'complete') finish();
      else if (!item || item.state === 'interrupted') finish(new Error('Firefox did not complete the part download.'));
    }, () => finish(new Error('Could not verify the part download.')));
  });
}

globalThis.ChatArchiveParts?.cleanup().catch(() => {});
browser.tabs.onRemoved?.addListener(async tabId => {
  if (!globalThis.ChatArchiveParts) return;
  try {
    for (const entry of await ChatArchiveParts.allJobs()) {
      if (entry.printTabId === tabId || (entry.printTabId == null && entry.owner.startsWith(`${tabId}:`))) {
        partDownloads.get(entry.id)?.abort();
        await ChatArchiveParts.remove(entry.id);
      }
    }
  } catch (_) {}
});

async function openPrint(entry) {
  const release = reserveContent(entry.content);
  const id = crypto.randomUUID();
  const timer = setTimeout(() => { printJobs.delete(id); release(); }, 60 * 1000);
  const dispose = () => { clearTimeout(timer); printJobs.delete(id); release(); };
  printJobs.set(id, { entry, dispose });
  try {
    return await browser.tabs.create({ url: browser.runtime.getURL(`print/print.html?id=${encodeURIComponent(id)}`) });
  } catch (error) { dispose(); throw error; }
}

browser.downloads.onChanged.addListener(delta => {
  if (delta.id == null || (!['complete', 'interrupted'].includes(delta.state?.current) && !delta.error)) return;
  temporaryUrls.get(delta.id)?.();
});

browser.runtime.onMessage.addListener(async (request, sender = {}) => {
  if (request.type?.startsWith('ARCHIVE_')) return ChatArchiveBulk.handle(request, sender, {
    acquire() { if (preparingFile) return false; preparingFile = true; return true; },
    release() { preparingFile = false; }, waitForDownload
  });
  if (['PANEL_CONTEXT', 'PANEL_SIZE', 'PANEL_SEND', 'PANEL_NOTIFICATION_SETTINGS'].includes(request.type)) {
    // Embedded controls belong to their containing tab, not the active tab.
    if (sender.url !== browser.runtime.getURL('popup/popup.html?panel=1') || !Number.isInteger(sender.tab?.id)) return { ok: false };
    if (request.type === 'PANEL_CONTEXT') return { ok: true, tabId: sender.tab.id, notifications: await browser.permissions.contains({ permissions: ['notifications'] }) };
    if (request.type === 'PANEL_NOTIFICATION_SETTINGS') {
      await browser.tabs.create({ url: browser.runtime.getURL('popup/notifications.html') });
      return { ok: true };
    }
    if (request.type === 'PANEL_SEND') {
      if (!['PING', 'SET_PICKING', 'CLEAR_SELECTION', 'BEGIN_EXPORT', 'STOP_EXPORT', 'PANEL_COLLAPSE'].includes(request.message?.type)) return { ok: false };
      return browser.tabs.sendMessage(sender.tab.id, request.message, { frameId: 0 });
    }
    if (!Number.isFinite(request.height)) return { ok: false };
    return browser.tabs.sendMessage(sender.tab.id, { type: 'PANEL_SIZE', height: Math.max(80, Math.min(1600, request.height)) }, { frameId: 0 });
  }
  if (request.type?.startsWith('EXPORT_PARTS_') || request.type === 'GET_PRINT_PART') {
    const owner = ownerOf(sender);
    try {
      if (request.type === 'EXPORT_PARTS_START') return { ok: true, id: await ChatArchiveParts.start(request.job, owner) };
      if (request.type === 'EXPORT_PARTS_STAGE') {
        checkSize(dataSize(request.data));
        return { ok: true, index: await ChatArchiveParts.stage(request.id, owner, request.data) };
      }
      if (request.type === 'EXPORT_PARTS_SEAL') return { ok: true, count: await ChatArchiveParts.seal(request.id, owner, request.summary) };
      if (request.type === 'EXPORT_PARTS_ABORT') {
        try { await ChatArchiveParts.job(request.id, owner); } catch (error) {
          if (error.message.includes('another tab')) throw error;
          return { ok: true };
        }
        partDownloads.get(request.id)?.abort();
        await ChatArchiveParts.remove(request.id);
        return { ok: true };
      }
      if (request.type === 'EXPORT_PARTS_SAVE') {
        if (preparingFile) throw new Error('Another export is being prepared. Finish it before exporting again.');
        preparingFile = true;
        const controller = new AbortController(); partDownloads.set(request.id, controller);
        try {
          const entry = await ChatArchiveParts.job(request.id, owner);
          if (entry.job.format !== 'html' || entry.saved + 1 !== request.index) throw new Error('Invalid export part sequence.');
          const part = await ChatArchiveParts.part(request.id, request.index, owner);
          const content = ChatArchiveRenderers.html(part.data, part.job.options);
          checkSize(content.length);
          if (controller.signal.aborted) throw new Error('Multipart export stopped.');
          const downloadId = await download(content, 'text/html', part.job.filename, false);
          await waitForDownload(downloadId, controller.signal);
          await ChatArchiveParts.saved(request.id, owner, request.index);
          if (request.index === entry.count) await ChatArchiveParts.remove(request.id);
          return { ok: true };
        } finally { partDownloads.delete(request.id); preparingFile = false; }
      }
      if (request.type === 'EXPORT_PARTS_PRINT') {
        const entry = await ChatArchiveParts.job(request.id, owner);
        if (entry.job.format !== 'pdf' || entry.state !== 'ready') throw new Error('The PDF parts are not ready.');
        const tab = await browser.tabs.create({ url: browser.runtime.getURL(`print/print.html?parts=${encodeURIComponent(request.id)}`) });
        await ChatArchiveParts.printing(request.id, owner, tab.id);
        return { ok: true };
      }
      if (request.type === 'GET_PRINT_PART') {
        if (!sender.url?.startsWith(browser.runtime.getURL('print/print.html'))) throw new Error('Print parts are available only in the extension print page.');
        const part = await ChatArchiveParts.part(request.id, request.index);
        const content = ChatArchiveRenderers.html(part.data, part.job.options);
        checkSize(content.length);
        const entry = await ChatArchiveParts.job(request.id);
        await ChatArchiveParts.printing(request.id, entry.owner, sender.tab.id);
        return { ok: true, content, filename: part.job.filename, compactPagination: part.job.options.compactPagination === true, strictImages: true, part: part.data.exportPart };
      }
      throw new Error('Unknown multipart export request.');
    } catch (error) { return { ok: false, error: error?.message || String(error) }; }
  }
  if (request.type === 'EXPORT_PROGRESS') {
    const value = Math.max(0, Math.min(100, Number(request.percent) || 0));
    await browser.action.setBadgeBackgroundColor({ color: '#111111' });
    const stage = ['LOAD', 'READ', 'SAVE'].includes(request.stage) ? request.stage : value < 100 ? String(value) : '✓';
    await browser.action.setBadgeText({ text: stage });
    return { ok: true };
  }

  if (request.type === 'EXPORT_FAILED') {
    await browser.action.setBadgeBackgroundColor({ color: '#111111' });
    await browser.action.setBadgeText({ text: '!' });
    await notifyExport(request, true);
    return { ok: true };
  }

  if (request.type === 'EXPORT_COMPLETE') {
    await browser.action.setBadgeBackgroundColor({ color: '#111111' });
    await browser.action.setBadgeText({ text: '✓' });
    await notifyExport(request);
    return { ok: true };
  }

  if (request.type === 'EXPORT_DISMISSED') {
    await browser.action.setBadgeText({ text: '' });
    return { ok: true };
  }

  if (request.type === 'EXPORT_READY') {
    if (preparingFile) return { ok: false, error: 'Another export is being prepared. Finish it before exporting again.' };
    preparingFile = true;
    try {
      const { job, data } = request;
      const size = data.messages.reduce((sum, message) => sum + ['id', 'text', 'markdown', 'html'].reduce((n, key) => n + (message[key]?.length || 0), 0) +
        (message.activities || []).reduce((n, activity) => n + ['title', 'text', 'markdown', 'html'].reduce((s, key) => s + (activity[key]?.length || 0), 0), 0), 0);
      checkSize(size);
      const renderFormat = job.format === 'pdf' ? 'html' : job.format;
      const content = ChatArchiveRenderers[renderFormat](data, job.options, job.format === 'pdf');
      checkSize(content.length);
      if (job.format === 'pdf') {
        await openPrint({ content, filename: job.filename, compactPagination: job.options.compactPagination === true, strictImages: data.collectionMethod === 'chatgpt-api' });
      } else {
        const mime = { txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json' }[job.format];
        await download(content, mime, job.filename);
      }
      await browser.action.setBadgeBackgroundColor({ color: '#111111' });
      await browser.action.setBadgeText({ text: '✓' });
      return { ok: true };
    } catch (error) {
      await browser.action.setBadgeBackgroundColor({ color: '#111111' });
      await browser.action.setBadgeText({ text: '!' });
      return { ok: false, error: error?.message || String(error) };
    } finally { preparingFile = false; }
  }

  if (request.type === 'DOWNLOAD_FILE') {
    const downloadId = await download(request.content, request.mime, request.filename);
    return { ok: true, downloadId };
  }

  if (request.type === 'OPEN_PRINT_PAGE') {
    const tab = await openPrint({ content: request.content });
    return { ok: true, tabId: tab.id };
  }

  if (request.type === 'GET_PRINT_PAGE') {
    const job = printJobs.get(request.id);
    if (!job) return { ok: false };
    job.dispose();
    return { ok: true, ...job.entry };
  }
});
