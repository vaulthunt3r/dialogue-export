const temporaryUrls = new Map();
const printJobs = new Map();

browser.downloads.onChanged.addListener(delta => {
  if (!delta.id || (!delta.state && !delta.error)) return;
  const url = temporaryUrls.get(delta.id);
  if (!url) return;
  URL.revokeObjectURL(url);
  temporaryUrls.delete(delta.id);
});

browser.runtime.onMessage.addListener(async request => {
  if (request.type === 'EXPORT_PROGRESS') {
    const value = Math.max(0, Math.min(100, Number(request.percent) || 0));
    await browser.action.setBadgeBackgroundColor({ color: '#149447' });
    await browser.action.setBadgeText({ text: value < 100 ? String(value) : '✓' });
    return { ok: true };
  }

  if (request.type === 'EXPORT_FAILED') {
    await browser.action.setBadgeBackgroundColor({ color: '#b3261e' });
    await browser.action.setBadgeText({ text: '!' });
    setTimeout(() => browser.action.setBadgeText({ text: '' }), 6000);
    return { ok: true };
  }

  if (request.type === 'EXPORT_READY') {
    try {
      const { job, data } = request;
      const renderFormat = job.format === 'pdf' ? 'html' : job.format;
      const content = ChatArchiveRenderers[renderFormat](data, job.options, job.format === 'pdf');
      if (job.format === 'pdf') {
        const id = crypto.randomUUID();
        printJobs.set(id, content);
        setTimeout(() => printJobs.delete(id), 15 * 60 * 1000);
        await browser.tabs.create({ url: browser.runtime.getURL(`print/print.html?id=${encodeURIComponent(id)}`) });
      } else {
        const mime = { txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json' }[job.format];
        const blob = new Blob([content], { type: `${mime};charset=utf-8` });
        const url = URL.createObjectURL(blob);
        const downloadId = await browser.downloads.download({ url, filename: job.filename, saveAs: true, conflictAction: 'uniquify' });
        temporaryUrls.set(downloadId, url);
      }
      await browser.action.setBadgeBackgroundColor({ color: '#26864a' });
      await browser.action.setBadgeText({ text: '✓' });
      setTimeout(() => browser.action.setBadgeText({ text: '' }), 5000);
      return { ok: true };
    } catch (error) {
      await browser.action.setBadgeBackgroundColor({ color: '#b3261e' });
      await browser.action.setBadgeText({ text: '!' });
      return { ok: false, error: error?.message || String(error) };
    }
  }

  if (request.type === 'DOWNLOAD_FILE') {
    const blob = new Blob([request.content], { type: `${request.mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    try {
      const downloadId = await browser.downloads.download({
        url,
        filename: request.filename,
        saveAs: true,
        conflictAction: 'uniquify'
      });
      temporaryUrls.set(downloadId, url);
      setTimeout(() => {
        if (temporaryUrls.get(downloadId) === url) {
          URL.revokeObjectURL(url);
          temporaryUrls.delete(downloadId);
        }
      }, 10 * 60 * 1000);
      return { ok: true, downloadId };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  if (request.type === 'OPEN_PRINT_PAGE') {
    const id = crypto.randomUUID();
    printJobs.set(id, request.content);
    setTimeout(() => printJobs.delete(id), 15 * 60 * 1000);
    const tab = await browser.tabs.create({ url: browser.runtime.getURL(`print/print.html?id=${encodeURIComponent(id)}`) });
    return { ok: true, tabId: tab.id };
  }

  if (request.type === 'GET_PRINT_PAGE') {
    const content = printJobs.get(request.id);
    return content ? { ok: true, content } : { ok: false };
  }
});
