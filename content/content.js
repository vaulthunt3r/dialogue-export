(function () {
  let picking = false;
  let observer;
  const messageCache = new Map();
  let activeExport = false;
  let exportStatus = null;
  let uiTimer;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pageTheme() {
    const roots = [document.documentElement, document.body].filter(Boolean);
    for (const root of roots) {
      const declared = `${root.dataset.theme || ''} ${root.className || ''}`.toLowerCase();
      if (/\b(dark|night)\b/.test(declared)) return 'dark';
      if (/\b(light|day)\b/.test(declared)) return 'light';
    }
    for (const root of [...roots].reverse()) {
      const style = getComputedStyle(root);
      if (style.colorScheme === 'dark' || style.colorScheme === 'light') return style.colorScheme;
      const channels = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
      // A transparent body is not a black background.
      if (channels?.length >= 3 && (channels.length < 4 || channels[3] > 0.5)) {
        return (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000 < 128 ? 'dark' : 'light';
      }
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function remember(options = {}) {
    window.ChatArchiveExtractor.snapshot(options).forEach(item => {
      const previous = messageCache.get(item.id);
      // Virtualised nodes can temporarily lose their metadata. Retain a known
      // time only for the same exact message, never a different regenerated reply.
      if (options.includeTimestamps && !item.createdAt && previous?.createdAt && item.messageId &&
          item.messageId === previous.messageId && item.role === previous.role) item.createdAt = previous.createdAt;
      messageCache.set(item.id, previous?.selected && !item.selected ? { ...item, selected: true } : item);
    });
  }

  function scrollCandidates() {
    const first = window.ChatArchiveExtractor.nodes()[0];
    const candidates = [];
    if (!first) return document.scrollingElement ? [document.scrollingElement] : [];
    let node = first.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 100) candidates.push(node);
      if (node === document.body) break;
      node = node.parentElement;
    }
    if (document.scrollingElement) candidates.push(document.scrollingElement);
    return [...new Set(candidates)];
  }

  function scrollHost() { return scrollCandidates()[0] || document.scrollingElement; }

  function cacheExpected() {
    return Math.max(1, ...[...messageCache.values()].map(item => item.order + 1));
  }

  function visibleStartSignature() {
    return window.ChatArchiveExtractor.nodes().slice(0, 3).map(node => {
      const turnId = node.closest?.('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid') || '';
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      return `${turnId}:${text}`;
    }).join('|');
  }

  async function triggerEarlierBatch(host, options) {
    const previousSignature = visibleStartSignature();
    const noChangeDeadline = Date.now() + 6500;
    const finalDeadline = Date.now() + 14000;
    let changed = false;
    let stableSamples = 0;
    let previousState = '';

    if (host.scrollTop <= 4) {
      const maximum = Math.max(0, host.scrollHeight - host.clientHeight);
      host.scrollTop = Math.min(maximum, Math.max(280, Math.floor(host.clientHeight * 0.4)));
      await pause(220);
    }
    host.scrollTop = 0;

    while (Date.now() < finalDeadline) {
      await pause(250);
      remember(options);
      const signature = visibleStartSignature();
      if (signature && signature !== previousSignature) changed = true;

      const state = [
        signature,
        window.ChatArchiveExtractor.nodes().length,
        Math.round(host.scrollTop),
        host.scrollHeight
      ].join(':');
      stableSamples = changed && state === previousState ? stableSamples + 1 : 0;
      previousState = state;

      // Wait until ChatGPT finishes replacing the visible turn window and
      // applying its automatic scroll-position correction.
      if (changed && stableSamples >= 5) return true;
      if (!changed && Date.now() >= noChangeDeadline) return false;
    }
    return changed;
  }

  async function loadConversationStart(host, options, onProgress) {
    let unchangedCycles = 0;

    for (let pass = 0; pass < 300; pass++) {
      const previousCount = messageCache.size;
      const changed = await triggerEarlierBatch(host, options);
      const added = messageCache.size - previousCount;
      unchangedCycles = added > 0 ? 0 : unchangedCycles + 1;

      onProgress(
        Math.min(18, 3 + Math.floor(pass / 2)),
        added > 0 ? `Loaded ${added} earlier messages` : changed ? 'Checking loaded message window' : 'Checking conversation start',
        messageCache.size,
        cacheExpected()
      );

      if (unchangedCycles >= 2) break;
    }

    if (unchangedCycles < 2) {
      throw new Error('Could not reach the beginning of this conversation. Please try the export again.');
    }

    host.scrollTop = 0;
    await pause(250);
    remember(options);
  }

  async function collectComplete(options = {}, onProgress = () => {}) {
    if (options.selectedOnly) {
      const selected = window.ChatArchiveExtractor.collect(options);
      onProgress(75, 'Collecting selected messages', selected.messages.length, selected.messages.length);
      return selected;
    }

    const host = scrollHost();
    if (!host) return window.ChatArchiveExtractor.collect(options);
    const originalTop = host.scrollTop;
    messageCache.clear();
    remember(options);
    let expected = cacheExpected();
    onProgress(2, 'Moving to the start', messageCache.size, expected);

    try {
      await loadConversationStart(host, options, onProgress);
    } catch (error) {
      host.scrollTop = originalTop;
      throw error;
    }
    expected = Math.max(expected, cacheExpected());
    onProgress(20, 'Collecting messages', messageCache.size, expected);

    let unchanged = 0;
    let lastTop = -1;
    let reachedEnd = false;
    for (let step = 0; step < 1200; step++) {
      const amount = Math.max(350, Math.floor(host.clientHeight * 0.72));
      host.scrollTop = Math.min(host.scrollTop + amount, host.scrollHeight);
      await pause(180);
      remember(options);
      expected = Math.max(expected, cacheExpected());
      const maximum = Math.max(1, host.scrollHeight - host.clientHeight);
      onProgress(Math.min(96, 20 + Math.round((host.scrollTop / maximum) * 76)), 'Collecting conversation', messageCache.size, expected);
      const atEnd = host.scrollTop + host.clientHeight >= host.scrollHeight - 8;
      unchanged = host.scrollTop === lastTop ? unchanged + 1 : 0;
      lastTop = host.scrollTop;
      if (atEnd && unchanged >= 2) {
        reachedEnd = true;
        break;
      }
    }

    if (!reachedEnd) {
      host.scrollTop = originalTop;
      throw new Error('Could not reach the end of this conversation. Please try the export again.');
    }

    const metadata = window.ChatArchiveExtractor.metadata();
    const messages = [...messageCache.values()].sort((a, b) => a.order - b.order);
    host.scrollTop = originalTop;
    return { ...metadata, messages };
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function syncAppearance() {
    const theme = pageTheme();
    document.querySelectorAll('.chat-archive-picker, .chat-archive-selection-bar, .chat-archive-progress').forEach(node => {
      if (node.dataset.theme !== theme) node.dataset.theme = theme;
    });
    const elapsed = document.querySelector('.chat-archive-elapsed');
    if (elapsed && exportStatus) {
      const seconds = Math.max(0, Math.floor(((exportStatus.finishedAt ?? Date.now()) - exportStatus.startedAt) / 1000));
      setText(elapsed, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    }
    if (!picking && !activeExport && !document.querySelector('.chat-archive-progress')) {
      clearInterval(uiTimer); uiTimer = null;
    }
  }
  function watchAppearance() {
    syncAppearance();
    if (!uiTimer) uiTimer = setInterval(syncAppearance, 1000);
  }

  function progressView(percent, label, state = 'running', processed = 0) {
    let view = document.querySelector('.chat-archive-progress');
    if (!view) {
      view = document.createElement('div');
      view.className = 'chat-archive-progress';
      view.setAttribute('role', 'region');
      view.setAttribute('aria-label', 'Dialogue Export progress');
      const row = document.createElement('div');
      row.className = 'chat-archive-progress-row';
      const title = document.createElement('span');
      title.className = 'chat-archive-progress-title';
      title.setAttribute('role', 'status');
      const elapsed = document.createElement('span');
      elapsed.className = 'chat-archive-elapsed';
      const dismiss = document.createElement('button');
      dismiss.type = 'button'; dismiss.className = 'chat-archive-dismiss';
      dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss export status');
      dismiss.addEventListener('click', () => { view.remove(); syncAppearance(); });
      row.append(title, elapsed, dismiss);
      const detail = document.createElement('div'); detail.className = 'chat-archive-progress-detail';
      const timeline = document.createElement('div');
      timeline.className = 'chat-archive-timeline';
      timeline.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index++) timeline.append(document.createElement('i'));
      view.append(row, detail, timeline);
      document.body.append(view);
    }
    view.dataset.state = state;
    setText(view.querySelector('.chat-archive-progress-title'), label);
    setText(view.querySelector('.chat-archive-progress-detail'), state === 'error' ? 'Open Dialogue Export to try again.' : `${processed} messages collected${state === 'running' ? ' · keep this tab open' : exportStatus?.format === 'pdf' ? ' · save from the print page' : ' · check the save dialog or Downloads'}${state === 'done' && exportStatus?.timestampNotice ? ` · ${exportStatus.timestampNotice}` : ''}`);
    view.querySelector('.chat-archive-dismiss').hidden = state === 'running';
    // These segments represent loading, collecting, and preparing the file.
    // The site does not tell us the total message count or time remaining.
    const stage = percent < 20 ? 0 : percent < 98 ? 1 : 2;
    [...view.querySelector('.chat-archive-timeline').children].forEach((segment, index) => {
      segment.className = state === 'done' || index < stage ? 'done' : state === 'running' && index === stage ? 'current' : '';
    });
    watchAppearance();
    return view;
  }

  async function runExport(job) {
    activeExport = true;
    setPicking(false);
    exportStatus = { state: 'running', label: 'Preparing export', format: job.format, processed: 0, startedAt: Date.now() };
    try {
      const update = (percent, label, processed = 0) => {
        Object.assign(exportStatus, { label, processed });
        progressView(percent, label, 'running', processed);
        browser.runtime.sendMessage({ type: 'EXPORT_PROGRESS', percent, stage: percent < 20 ? 'LOAD' : percent < 98 ? 'READ' : 'SAVE' }).catch(() => {});
      };
      update(1, 'Preparing export');
      const data = await collectComplete(job.options, update);
      if (!data.messages.length) throw new Error(job.options.selectedOnly ? 'No messages selected.' : 'No messages found.');
      if (job.options.includeTimestamps) {
        data.messageTimestamps = ChatArchiveTimestamps.summarize(data.messages);
        exportStatus.timestampNotice = ChatArchiveTimestamps.notice(data.messageTimestamps);
      }
      update(98, 'Preparing file', data.messages.length);
      const result = await browser.runtime.sendMessage({ type: 'EXPORT_READY', job, data });
      if (!result?.ok) throw new Error(result?.error || 'Firefox could not receive the file.');
      Object.assign(exportStatus, { state: 'done', label: job.format === 'pdf' ? 'Print page opened' : 'File sent to Firefox', finishedAt: Date.now() });
      const view = progressView(100, exportStatus.label, 'done', data.messages.length);
      const completedJob = exportStatus;
      setTimeout(() => { if (exportStatus === completedJob && !activeExport) { view.remove(); syncAppearance(); } }, 15000);
    } catch (error) {
      Object.assign(exportStatus, { state: 'error', label: error?.message || String(error), finishedAt: Date.now() });
      progressView(100, exportStatus.label, 'error', exportStatus.processed);
      browser.runtime.sendMessage({ type: 'EXPORT_FAILED' }).catch(() => {});
    } finally {
      activeExport = false;
    }
  }

  function selectionCount() {
    return window.ChatArchiveExtractor.nodes().filter(node => node.dataset.chatArchiveSelected === 'true').length;
  }
  function updatePicker(node, button) {
    const selected = node.dataset.chatArchiveSelected === 'true';
    button.dataset.selected = String(selected);
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', selected ? 'Exclude this message' : 'Include this message');
    setText(button, selected ? '✓' : '+');
    node.classList.toggle('chat-archive-picked', picking && selected);
  }
  function decorate() {
    window.ChatArchiveExtractor.nodes().forEach((node, index) => {
      node.dataset.chatArchiveId ||= `message-${index + 1}`;
      node.classList.toggle('chat-archive-pickable', picking);
      let button = node.querySelector(':scope > .chat-archive-picker');
      if (!picking) { button?.remove(); node.classList.remove('chat-archive-picked'); return; }
      if (!button) {
        button = document.createElement('button');
        button.className = 'chat-archive-picker'; button.type = 'button';
        button.title = 'Include or exclude this message';
        button.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          node.dataset.chatArchiveSelected = String(node.dataset.chatArchiveSelected !== 'true');
          updatePicker(node, button); selectionBar();
        });
        node.prepend(button);
      }
      updatePicker(node, button);
    });
  }

  function selectionBar() {
    let bar = document.querySelector('.chat-archive-selection-bar');
    if (!picking) { bar?.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'chat-archive-selection-bar';
      bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Message selection');
      const label = document.createElement('span'); label.setAttribute('role', 'status');
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'chat-archive-clear';
      clear.textContent = 'Clear'; clear.addEventListener('click', clearSelection);
      const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Done';
      done.title = 'Finish choosing messages (Escape)'; done.addEventListener('click', () => setPicking(false));
      bar.append(label, clear, done); document.body.append(bar);
    }
    const count = selectionCount();
    setText(bar.querySelector('span'), `${count} selected`);
    bar.querySelector('.chat-archive-clear').disabled = !count;
  }

  function setPicking(enabled) {
    picking = Boolean(enabled);
    observer?.disconnect();
    decorate(); selectionBar();
    if (picking) {
      observer ||= new MutationObserver(() => {
        // Do not observe our own button/count updates.
        observer.disconnect();
        if (picking) { decorate(); selectionBar(); syncAppearance(); observer.observe(document.body, { childList: true, subtree: true }); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      watchAppearance();
    }
  }

  function clearSelection() {
    window.ChatArchiveExtractor.nodes().forEach(node => {
      delete node.dataset.chatArchiveSelected;
      node.classList.remove('chat-archive-picked');
      const button = node.querySelector(':scope > .chat-archive-picker');
      if (button) updatePicker(node, button);
    });
    selectionBar();
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && picking) { event.preventDefault(); event.stopPropagation(); setPicking(false); }
  });

  window.addEventListener('pagehide', () => {
    observer?.disconnect();
    clearInterval(uiTimer); uiTimer = null;
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      if (picking) setPicking(true);
      if (activeExport || document.querySelector('.chat-archive-progress')) watchAppearance();
    }
  });

  browser.runtime.onMessage.addListener(request => {
    if (request.type === 'PING') {
      const nodes = window.ChatArchiveExtractor.nodes();
      const metadata = window.ChatArchiveExtractor.metadata();
      return Promise.resolve({ ok: true, title: metadata.title, count: nodes.length, selected: selectionCount(), picking,
        provider: metadata.provider, theme: pageTheme(), activeExport, exportStatus: exportStatus ? { ...exportStatus } : null });
    }
    if (request.type === 'SET_PICKING' || request.type === 'CLEAR_SELECTION') {
      if (activeExport) return Promise.resolve({ ok: false, error: 'Wait for the current export to finish.' });
      if (request.type === 'SET_PICKING') setPicking(request.enabled); else clearSelection();
      return Promise.resolve({ ok: true });
    }
    if (request.type === 'COLLECT') return collectComplete(request.options);
    if (request.type === 'BEGIN_EXPORT') {
      if (activeExport) return Promise.resolve({ ok: false, error: 'An export is already running.' });
      const job = request.job;
      if (!job || !['txt', 'md', 'html', 'json', 'pdf'].includes(job.format) || typeof job.filename !== 'string' || !job.options) {
        return Promise.resolve({ ok: false, error: 'The export settings are invalid.' });
      }
      runExport(job);
      return Promise.resolve({ ok: true, exportStatus: { ...exportStatus } });
    }
  });
})();
