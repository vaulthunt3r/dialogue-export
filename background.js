const temporaryUrls = new Map();
const printJobs = new Map();
const maxContentCharacters = 16 * 1024 * 1024;
const maxRetainedCharacters = 32 * 1024 * 1024;
let retainedCharacters = 0;
let preparingFile = false;

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

async function download(content, mime, filename) {
  const release = reserveContent(content);
  let url, timer, downloadId;
  const dispose = () => {
    if (url) URL.revokeObjectURL(url);
    clearTimeout(timer); temporaryUrls.delete(downloadId); release();
  };
  try {
    url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
    downloadId = await browser.downloads.download({ url, filename, saveAs: true, conflictAction: 'uniquify' });
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

browser.runtime.onMessage.addListener(async request => {
  if (request.type === 'EXPORT_PROGRESS') {
    const value = Math.max(0, Math.min(100, Number(request.percent) || 0));
    await browser.action.setBadgeBackgroundColor({ color: '#149447' });
    const stage = ['LOAD', 'READ', 'SAVE'].includes(request.stage) ? request.stage : value < 100 ? String(value) : '✓';
    await browser.action.setBadgeText({ text: stage });
    return { ok: true };
  }

  if (request.type === 'EXPORT_FAILED') {
    await browser.action.setBadgeBackgroundColor({ color: '#b3261e' });
    await browser.action.setBadgeText({ text: '!' });
    setTimeout(() => browser.action.setBadgeText({ text: '' }), 6000);
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
        await openPrint({ content, filename: job.filename, compactPagination: job.options.compactPagination === true });
      } else {
        const mime = { txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json' }[job.format];
        await download(content, mime, job.filename);
      }
      await browser.action.setBadgeBackgroundColor({ color: '#26864a' });
      await browser.action.setBadgeText({ text: '✓' });
      setTimeout(() => browser.action.setBadgeText({ text: '' }), 5000);
      return { ok: true };
    } catch (error) {
      await browser.action.setBadgeBackgroundColor({ color: '#b3261e' });
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
