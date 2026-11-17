/* Archive orchestration: one reader and one bounded ZIP part at a time. */
(function (root) {
  const contexts = new Map(), encoder = new TextEncoder();
  const PART_BYTES = 32 * 1024 * 1024, RESERVE_BYTES = 2 * 1024 * 1024, MAX_CHATS = 10000;
  const codes = {
    HTTP_401: 'ChatGPT sign-in expired. Reload the source tab and sign in again.', HTTP_403: 'ChatGPT refused this request. Check the source tab.',
    HTTP_404: 'This conversation is no longer available.', HTTP_429: 'ChatGPT request limit reached. Try again later.',
    HTTP_503: 'ChatGPT is temporarily unavailable.', READ_FAILED: 'Could not read a bounded ChatGPT response. It may be unavailable or too large.',
    NETWORK_ERROR: 'The request to ChatGPT could not be completed. Check the connection and retry.',
    REQUEST_TIMEOUT: 'ChatGPT did not return the conversation within 30 seconds.',
    INVALID_RESPONSE: 'ChatGPT returned unreadable conversation data.',
    OPERATION_FAILED: 'The archive operation failed unexpectedly. Prepared chats will be saved if downloading is available.',
    RENDER_FAILED: 'The conversation could not be converted to the selected format.',
    RESPONSE_LIMIT: 'The conversation response exceeds the archive reader limit.', LIST_LIMIT: 'This version supports up to 10,000 listed chats.',
    LIST_CHANGED: 'The conversation list changed or was incomplete. Reload the list before exporting.',
    UNSUPPORTED_CHAT: 'This conversation cannot be exported directly. Try exporting it separately from its page.',
    CHAT_ID_MISSING: 'The response did not identify the requested conversation.',
    CHAT_ID_MISMATCH: 'The response identified a different conversation. Nothing from it was saved.',
    BRANCH_UNAVAILABLE: 'The saved response branch is unavailable.',
    BRANCH_INCOMPLETE: 'The saved response branch is incomplete or inconsistent.',
    MESSAGE_TYPE: 'A message uses a content type the direct reader does not support yet.',
    ATTACHMENT_TYPE: 'A message contains an attachment type the direct reader does not support yet.',
    REFERENCE_FORMAT: 'A message uses an unsupported reference structure.',
    RICH_REFERENCE: 'A rich-content marker could not be matched to a supported reference.',
    RESPONSE_UNFINISHED: 'A message in the saved branch is not marked as successfully finished.',
    MESSAGE_IDS: 'Message identifiers are missing or repeated in the saved branch.',
    RENDERER_UNAVAILABLE: 'The HTML renderer is unavailable. Reload the source tab.',
    CONTENT_LIMIT: 'The rendered conversation exceeds the archive content limit.',
    NO_MESSAGES: 'The saved branch contains no supported visible messages.',
    SESSION_ENDED: 'The source session ended. Keep the ChatGPT tab open.', BUSY: 'Another export is running in the source tab.',
    STOPPED: 'Stopped. Completed ZIP downloads are kept.', ZIP_LIMIT: 'This conversation exceeds the ZIP entry limit.',
    DOWNLOAD_FAILED: 'Firefox did not confirm the download. Check Downloads before retrying.', SOURCE_CLOSED: 'The source ChatGPT tab was closed.'
  };
  const safeCode = code => typeof code === 'string' && (Object.hasOwn(codes, code) || /^HTTP_[1-5]\d\d$/.test(code)) ? code : 'OPERATION_FAILED';
  const failure = rawCode => {
    const code = safeCode(rawCode);
    return Object.assign(new Error(codes[code] || `ChatGPT returned HTTP ${code.slice(5)}. Try this chat again later.`), { code });
  };
  const suggestion = code => ['RESPONSE_UNFINISHED','RICH_REFERENCE','MESSAGE_TYPE','ATTACHMENT_TYPE','REFERENCE_FORMAT','UNSUPPORTED_CHAT'].includes(code)
    ? 'Open this chat and try a separate export from its page.'
    : code === 'HTTP_404' ? 'Check whether this chat can still be opened in ChatGPT.'
    : 'Retry this chat after resolving the reported problem.';
  function failRow(row, error) {
    const problem = failure(error.code || 'RENDER_FAILED');
    Object.assign(row, { status: 'failed', code: problem.code, reason: problem.message, suggestion: suggestion(problem.code) });
  }
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(failure('STOPPED')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  }
  function check(ctx) { if (ctx.controller.signal.aborted) throw failure(ctx.abortCode || 'STOPPED'); }
  async function rpc(ctx, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      check(ctx);
      if (ctx.sourceClosed) throw failure('SOURCE_CLOSED');
      let result;
      try { result = await browser.tabs.sendMessage(ctx.source, { ...message, session: ctx.session }, { frameId: 0 }); }
      catch (_) { check(ctx); throw failure(ctx.sourceClosed ? 'SOURCE_CLOSED' : 'SESSION_ENDED'); }
      check(ctx);
      if (result?.ok) return result;
      const code = result?.code || 'READ_FAILED';
      if (['HTTP_429', 'HTTP_503'].includes(code) && attempt < 2) {
        const seconds = Math.min(60, Math.max(5 * 2 ** attempt, Number(result.retryAfter) || 0));
        ctx.label = `ChatGPT is busy. Retrying in ${seconds}s…`;
        await delay(seconds * 1000, ctx.controller.signal); continue;
      }
      throw failure(code);
    }
  }
  async function session(ctx, run) {
    ctx.session = crypto.randomUUID();
    const signal = ctx.controller.signal;
    const cancel = () => browser.tabs.sendMessage(ctx.source, { type: 'HISTORY_END', session: ctx.session }, { frameId: 0 }).catch(() => {});
    signal.addEventListener('abort', cancel, { once: true });
    try { await rpc(ctx, { type: 'HISTORY_START' }); return await run(); }
    finally { await cancel(); signal.removeEventListener('abort', cancel); ctx.session = null; }
  }
  function begin(ctx, state, dependencies, work) {
    if (ctx.running || !dependencies.acquire()) throw failure('BUSY');
    ctx.running = true; ctx.state = state; ctx.error = ''; ctx.errorCode = ''; ctx.abortCode = ''; ctx.controller = new AbortController();
    ctx.stage = 'load'; ctx.startedAt = Date.now(); ctx.finishedAt = null; ctx.processed = 0; ctx.report = null;
    if (state === 'listing') { ctx.items = []; ctx.listReady = false; }
    ctx.task = session(ctx, work).catch(error => {
      const problem = failure(error.code); ctx.state = problem.code === 'STOPPED' ? 'stopped' : 'error';
      if (ctx.errorCode && problem.code === 'DOWNLOAD_FAILED') {
        ctx.report.reportError = {code:problem.code,reason:problem.message}; ctx.error += ' The JSON report could not be saved; use Save report again.';
      } else {ctx.error = problem.message; ctx.errorCode = problem.code;}
    })
      .finally(() => { ctx.running = false; ctx.finishedAt = Date.now(); ctx.label = ''; if (ctx.report) ctx.report.finishedAt = new Date().toISOString(); dependencies.release(); });
  }
  async function discover(ctx, archived) {
    ctx.items = []; ctx.listReady = false; ctx.report = null; ctx.includeArchived = archived;
    const ids = new Set();
    for (const category of archived ? [false, true] : [false]) {
      let offset = 0, total;
      do {
        ctx.label = `Loading ${category ? 'archived' : 'active'} list · ${ctx.items.length} found`;
        const result = await rpc(ctx, { type: 'HISTORY_LIST', offset, archived: category });
        if (result.total > MAX_CHATS || ctx.items.length + result.items.length > MAX_CHATS) throw failure('LIST_LIMIT');
        if (total != null && result.total !== total) throw failure('LIST_CHANGED');
        total = result.total;
        if (!result.items.length && offset < total || offset + result.items.length > total) throw failure('LIST_CHANGED');
        for (const item of result.items) {
          if (ids.has(item.id)) throw failure('LIST_CHANGED');
          ids.add(item.id); ctx.items.push(item);
        }
        offset += result.items.length;
        if (offset < total) await delay(250, ctx.controller.signal);
      } while (offset < total);
    }
    ctx.listReady = true; ctx.state = 'listed';
  }
  async function save(ctx, blob, filename, dependencies) {
    check(ctx);
    const url = URL.createObjectURL(blob);
    try {
      const id = await browser.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
      await dependencies.waitForDownload(id, ctx.controller.signal);
    } catch (_) { throw failure(ctx.controller.signal.aborted ? 'STOPPED' : 'DOWNLOAD_FAILED'); }
    finally { URL.revokeObjectURL(url); }
  }
  function entryName(item, index, format) {
    const title = Array.from(item.title.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '').replace(/\s+/g, '-')).slice(0, 45).join('').replace(/[. -]+$/g, '') || 'Untitled';
    return `chats/${String(index + 1).padStart(5, '0')}-${item.id.slice(0, 8)}-${title}.${format}`;
  }
  function report(ctx) {
    if (!ctx.report) return null;
    const result = { ...ctx.report, state: ctx.state, error: ctx.error || null, errorCode: ctx.errorCode || null, finishedAt: ctx.report.finishedAt || null };
    result.saved = result.chats.filter(row => row.status === 'saved').length;
    result.failed = result.chats.filter(row => row.status === 'failed').length;
    result.notSaved = result.chats.length - result.saved - result.failed;
    result.ready = result.chats.filter(row => row.status === 'prepared').length;
    result.notAttempted = result.chats.filter(row => row.status === 'not_attempted').length;
    return result;
  }
  async function exportChats(ctx, ids, format, dependencies) {
    const selection = new Set(ids), chosen = ctx.items.filter(item => selection.has(item.id));
    ctx.report = { version: 1, startedAt: new Date().toISOString(), format, imagesIncluded: false, branch: 'server-current',
      scope: 'Selected entries returned by ChatGPT history lists; project coverage is not verified.', includeArchived: ctx.includeArchived,
      selected: chosen.length, parts: [], chats: chosen.map((item, i) => ({ ...item, file: entryName(item, i, format), status: 'not_attempted' })) };
    ctx.prefix = `ChatGPT-archive-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;
    let writer = new ChatArchiveZip.Writer(PART_BYTES), rows = [], sealed = false;
    const flush = async () => {
      if (!rows.length) return;
      // A sealed/download-attempted part must not be retried implicitly: its
      // download may already exist even when Firefox cannot confirm it.
      sealed = true;
      const filename = `${ctx.prefix}-part-${String(ctx.report.parts.length + 1).padStart(3, '0')}.zip`;
      const index = '<!doctype html><meta charset="utf-8"><title>Chat archive</title><h1>Chat archive</h1><p>Text only. Images and alternative branches are not included. See manifest.json and the final report for scope.</p><ul>' +
        rows.map(row => `<li><a href="${esc(row.file.split('/').map(encodeURIComponent).join('/'))}">${esc(row.title)}</a>${row.archived ? ' (archived)' : ''}</li>`).join('') + '</ul>';
      writer.add('index.html', index);
      writer.add('manifest.json', JSON.stringify({ version: 1, format, imagesIncluded: false, branch: 'server-current', archive: filename,
        chats: rows.map(({ id, title, archived, file, messages }) => ({ id, title, archived, file, messages })) }, null, 2));
      ctx.stage = 'save'; ctx.label = `Saving ZIP part ${ctx.report.parts.length + 1}…`;
      rows.forEach(row => { row.status = 'download_unconfirmed'; row.part = filename; });
      try { await save(ctx, writer.blob(), filename, dependencies); }
      catch (error) {
        const problem = failure(error.code);
        rows.forEach(row => {row.code=problem.code;row.reason=problem.message;});
        throw error;
      }
      rows.forEach(row => { row.status = 'saved'; }); ctx.report.parts.push(filename);
      writer = new ChatArchiveZip.Writer(PART_BYTES); rows = []; sealed = false;
    };
    const markUnsaved = () => {
      for (const row of ctx.report.chats) if (row.status === 'prepared') {
        const problem = failure(ctx.abortCode || ctx.errorCode || 'DOWNLOAD_FAILED');
        Object.assign(row, {status:'not_saved', code:problem.code, reason:problem.message});
      }
    };
    try {
      try {
      for (let i = 0; i < chosen.length; i++) {
        check(ctx); ctx.stage = 'read'; ctx.processed = i; ctx.label = `Reading chat ${i + 1} / ${chosen.length}`;
        const row = ctx.report.chats[i];
        let bytes;
        try {
          const result = await rpc(ctx, { type: 'HISTORY_CHAT', id: row.id, format });
          const data = result.data;
          row.messages = data.messages.length;
          const note = 'Archive text export: images and alternative response branches are not included.';
          let content = ChatArchiveRenderers[format](data, { includeTitle: true, includeLinks: true, includeTimestamps: true });
          if (format === 'html') content = content.replace('<body>', `<body><p>${note}</p>`);
          else if (format === 'json') content = JSON.stringify({ ...JSON.parse(content), archiveNotice: note }, null, 2);
          else content = note + '\n\n' + content;
          if (content.length > 16 * 1024 * 1024) throw failure('ZIP_LIMIT');
          bytes = encoder.encode(content);
          if (bytes.length + 1024 > PART_BYTES - RESERVE_BYTES) throw failure('ZIP_LIMIT');
        } catch (error) {
          bytes = null;
          if (ctx.controller.signal.aborted && ctx.abortCode !== 'SOURCE_CLOSED') throw failure('STOPPED');
          failRow(row, error); ctx.processed = i + 1;
          if (['HTTP_401', 'HTTP_403', 'HTTP_429', 'SESSION_ENDED', 'SOURCE_CLOSED', 'READ_FAILED', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'INVALID_RESPONSE'].includes(error.code) || /^HTTP_5\d\d$/.test(error.code || '')) throw error;
        }
        if (bytes) {
          row.status = 'prepared';
          if (writer.size + bytes.length + 1024 > PART_BYTES - RESERVE_BYTES || rows.length >= 250) await flush();
          check(ctx); writer.add(row.file, bytes); rows.push(row);
        }
        ctx.processed = i + 1;
        if (i + 1 < chosen.length) await delay(350, ctx.controller.signal);
      }
      await flush();
      } catch (error) {
        if (ctx.controller.signal.aborted && ctx.abortCode !== 'SOURCE_CLOSED') throw failure('STOPPED');
        const problem = failure(ctx.controller.signal.aborted && ctx.abortCode === 'SOURCE_CLOSED' ? 'SOURCE_CLOSED' : error.code);
        ctx.errorCode = problem.code; ctx.error = problem.message;
        ctx.report.stopError = {code:problem.code,reason:problem.message};
        // Closing the source stops further reads, but completed files need no
        // source tab. User Stop or closing the archive UI still cancels saving.
        if (ctx.controller.signal.aborted) ctx.controller = new AbortController();
        if (!sealed) {
          try { await flush(); }
          catch (saveError) {
            if (ctx.controller.signal.aborted) throw failure('STOPPED');
            const saveProblem = failure(saveError.code);
            ctx.report.saveError = { code:saveProblem.code, reason:saveProblem.message };
            ctx.error += ` Saving prepared chats also failed: ${saveProblem.message}`;
          }
        }
      }
      markUnsaved();
      ctx.state = ctx.errorCode ? 'error' : ctx.report.chats.some(row => row.status !== 'saved') ? 'partial' : 'done';
      ctx.stage = 'save'; ctx.label = 'Saving archive report…';
      const summary = { ...report(ctx), finishedAt: new Date().toISOString() };
      await save(ctx, new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }), `${ctx.prefix}-report.json`, dependencies);
    } finally {
      markUnsaved();
      writer = null; rows = [];
    }
  }
  root.ChatArchiveBulk = {
    async handle(request, sender, dependencies) {
      try {
        if (request.type === 'ARCHIVE_OPEN') {
          const panel = sender.url === browser.runtime.getURL('popup/popup.html?panel=1');
          const page = sender.frameId === 0 && sender.url?.startsWith('https://chatgpt.com/');
          if (!panel && !page && sender.url !== browser.runtime.getURL('popup/popup.html')) return { ok: false };
          const source = panel || page ? sender.tab?.id : request.tabId;
          if (!Number.isInteger(source)) return { ok: false };
          const tab = await browser.tabs.get(source);
          if (!tab.url?.startsWith('https://chatgpt.com/')) return { ok: false, error: 'Open a ChatGPT tab first.' };
          const id = crypto.randomUUID();
          const ctx = { id, source, ui: null, state: 'idle', running: false, items: [], listReady: false, processed: 0, report: null };
          contexts.set(id, ctx);
          try { const ui = await browser.tabs.create({ url: browser.runtime.getURL(`archive/archive.html?id=${id}`) }); ctx.ui = ui.id; }
          catch (error) { contexts.delete(id); throw error; }
          return { ok: true };
        }
        const ctx = contexts.get(request.id);
        if (!ctx || sender.tab?.id !== ctx.ui || sender.frameId !== 0 || sender.url !== browser.runtime.getURL(`archive/archive.html?id=${ctx.id}`)) return { ok: false, error: 'Archive session unavailable. Reopen it from the ChatGPT export menu.' };
        if (request.type === 'ARCHIVE_STATE') return { ok: true, state: ctx.state, stage: ctx.stage || 'load', startedAt: ctx.startedAt ?? null, finishedAt: ctx.finishedAt ?? null, running: ctx.running, label: ctx.label || '', error: ctx.error || '', errorCode:ctx.errorCode || '', count: ctx.items.length,
          listReady: ctx.listReady, processed: ctx.processed, selected: ctx.report?.selected || 0, saved: ctx.report?.chats.filter(row => row.status === 'saved').length || 0,
          ready:ctx.report?.chats.filter(row => row.status === 'prepared').length || 0, notAttempted:ctx.report?.chats.filter(row => row.status === 'not_attempted').length || 0,
          failed: ctx.report?.chats.filter(row => row.status === 'failed').length || 0, parts: ctx.report?.parts.length || 0, hasReport: !!ctx.report,
          failures:(ctx.report?.chats.filter(row => row.status === 'failed') || []).slice(-20).map(({id,title,code,reason,suggestion})=>({id,title,code,reason,suggestion})) };
        if (request.type === 'ARCHIVE_ITEMS') return { ok: true, items: ctx.listReady ? ctx.items : [] };
        if (request.type === 'ARCHIVE_STOP') { ctx.abortCode = 'STOPPED'; ctx.controller?.abort(); return { ok: true }; }
        if (request.type === 'ARCHIVE_LIST') { begin(ctx, 'listing', dependencies, () => discover(ctx, request.archived === true)); return { ok: true }; }
        if (request.type === 'ARCHIVE_RUN') {
          if (!ctx.listReady || !Array.isArray(request.ids) || !request.ids.length || request.ids.length > MAX_CHATS || !['md', 'txt', 'html', 'json'].includes(request.format)) return { ok: false, error: 'Load the list and select chats first.' };
          const available = new Set(ctx.items.map(item => item.id));
          if (new Set(request.ids).size !== request.ids.length || request.ids.some(id => !available.has(id))) return { ok: false, error: 'Invalid chat selection.' };
          begin(ctx, 'exporting', dependencies, () => exportChats(ctx, request.ids, request.format, dependencies)); return { ok: true };
        }
        if (request.type === 'ARCHIVE_REPORT' && !ctx.running && ctx.report) {
          if (!dependencies.acquire()) throw failure('BUSY');
          ctx.controller = new AbortController();
          try { await save(ctx, new Blob([JSON.stringify(report(ctx), null, 2)], { type: 'application/json' }), `${ctx.prefix}-report.json`, dependencies); }
          finally { dependencies.release(); }
          return { ok: true };
        }
        return { ok: false };
      } catch (error) { return { ok: false, error: error.code ? error.message : 'Could not start the archive operation.' }; }
    }
  };
  browser.tabs.onRemoved.addListener(tabId => {
    for (const [id, ctx] of contexts) {
      if (ctx.source === tabId) { ctx.sourceClosed = true; if (ctx.running && ctx.stage !== 'save') {ctx.abortCode = 'SOURCE_CLOSED'; ctx.controller?.abort();} }
      if (ctx.ui === tabId) { ctx.abortCode = 'STOPPED'; ctx.controller?.abort(); }
      if (ctx.ui === tabId) contexts.delete(id);
    }
  });
})(globalThis);
