(function () {
  let picking = false;
  let observer;
  const messageCache = new Map();
  let activeExport = false;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function pageTheme() {
    const root = document.documentElement;
    const declared = `${root.dataset.theme || ''} ${root.className || ''}`.toLowerCase();
    if (/\b(dark|night)\b/.test(declared)) return 'dark';
    if (/\b(light|day)\b/.test(declared)) return 'light';
    const scheme = getComputedStyle(root).colorScheme;
    if (scheme === 'dark') return 'dark';
    const background = getComputedStyle(document.body).backgroundColor;
    const channels = background.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (channels?.length === 3) {
      const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
      return luminance < 128 ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function remember(options = {}) {
    window.ChatArchiveExtractor.snapshot(options).forEach(item => {
      const previous = messageCache.get(item.id);
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

  function progressView(percent, label, state = 'running', processed = 0, total = 0) {
    let view = document.querySelector('.chat-archive-progress');
    if (!view) {
      view = document.createElement('div');
      view.className = 'chat-archive-progress';
      const row = document.createElement('div');
      row.className = 'chat-archive-progress-row';
      row.append(document.createElement('span'), document.createElement('strong'));
      const timeline = document.createElement('div');
      timeline.className = 'chat-archive-timeline';
      view.append(row, timeline);
      document.body.append(view);
    }
    view.dataset.theme = pageTheme();
    view.dataset.state = state;
    view.querySelector('span').textContent = label;
    view.querySelector('strong').textContent = state === 'error' ? 'Error' : processed ? `${processed}${total ? ` / ${total}` : ''}` : `${percent}%`;
    const segmentCount = total > 0 && total <= 32 ? total : 32;
    const completed = state === 'done' ? segmentCount : total > 0 ? Math.min(segmentCount, Math.floor((processed / total) * segmentCount)) : Math.floor((percent / 100) * segmentCount);
    const timeline = view.querySelector('.chat-archive-timeline');
    if (timeline.children.length !== segmentCount) timeline.replaceChildren(...Array.from({ length: segmentCount }, () => document.createElement('i')));
    [...timeline.children].forEach((segment, index) => {
      segment.className = index < completed ? 'done' : index === completed && state === 'running' ? 'current' : '';
    });
    return view;
  }

  async function runExport(job) {
    if (activeExport) throw new Error('An export is already running.');
    activeExport = true;
    const startedAt = Date.now();
    try {
      const update = (percent, label, processed = 0, total = 0) => {
        progressView(percent, label, 'running', processed, total);
        browser.runtime.sendMessage({ type: 'EXPORT_PROGRESS', percent }).catch(() => {});
      };
      update(1, 'Preparing export');
      const data = await collectComplete(job.options, update);
      if (!data.messages.length) throw new Error(job.options.selectedOnly ? 'No messages selected.' : 'No messages found.');
      update(98, 'Formatting file', data.messages.length, data.messages.length);
      const result = await browser.runtime.sendMessage({ type: 'EXPORT_READY', job, data });
      if (!result?.ok) throw new Error(result?.error || 'Firefox could not receive the file.');
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      progressView(100, `${job.format === 'pdf' ? 'Print page opened' : 'File sent to Downloads'} · ${elapsedSeconds}s`, 'done', data.messages.length, data.messages.length);
      setPicking(false);
      setTimeout(() => document.querySelector('.chat-archive-progress')?.remove(), 3500);
    } catch (error) {
      progressView(100, error?.message || String(error), 'error');
      browser.runtime.sendMessage({ type: 'EXPORT_FAILED' }).catch(() => {});
    } finally {
      activeExport = false;
    }
  }

  function decorate() {
    window.ChatArchiveExtractor.nodes().forEach((node, index) => {
      node.dataset.chatArchiveId ||= `message-${index + 1}`;
      node.classList.toggle('chat-archive-pickable', picking);
      let button = node.querySelector(':scope > .chat-archive-picker');
      if (!picking) { button?.remove(); return; }
      if (button) { button.dataset.theme = pageTheme(); return; }
      button = document.createElement('button');
      button.className = 'chat-archive-picker';
      button.dataset.theme = pageTheme();
      button.type = 'button';
      button.title = 'Include or exclude this message';
      const selected = node.dataset.chatArchiveSelected === 'true';
      button.dataset.selected = String(selected);
      button.textContent = selected ? '✓' : '+';
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const next = node.dataset.chatArchiveSelected !== 'true';
        node.dataset.chatArchiveSelected = String(next);
        node.classList.toggle('chat-archive-picked', next);
        button.dataset.selected = String(next);
        button.textContent = next ? '✓' : '+';
      });
      node.prepend(button);
    });
  }

  function selectionBar() {
    let bar = document.querySelector('.chat-archive-selection-bar');
    if (!picking) { bar?.remove(); return; }
    if (bar) { bar.dataset.theme = pageTheme(); return; }
    bar = document.createElement('div');
    bar.className = 'chat-archive-selection-bar';
    bar.dataset.theme = pageTheme();
    const label = document.createElement('span');
    label.textContent = 'Message selection is active';
    const done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => setPicking(false));
    bar.append(label, done);
    document.body.append(bar);
  }

  function setPicking(enabled) {
    picking = Boolean(enabled);
    decorate();
    selectionBar();
    if (picking && !observer) {
      observer = new MutationObserver(() => { decorate(); selectionBar(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (!picking) { observer?.disconnect(); observer = null; }
  }

  function clearSelection() {
    window.ChatArchiveExtractor.nodes().forEach(node => {
      delete node.dataset.chatArchiveSelected;
      node.classList.remove('chat-archive-picked');
      const button = node.querySelector(':scope > .chat-archive-picker');
      if (button) { button.dataset.selected = 'false'; button.textContent = '+'; }
    });
  }

  browser.runtime.onMessage.addListener(request => {
    if (request.type === 'PING') {
      const nodes = window.ChatArchiveExtractor.nodes();
      const metadata = window.ChatArchiveExtractor.metadata();
      return Promise.resolve({
        ok: true,
        title: metadata.title,
        count: nodes.length,
        selected: nodes.filter(node => node.dataset.chatArchiveSelected === 'true').length,
        picking,
        provider: metadata.provider,
        theme: pageTheme()
      });
    }
    if (request.type === 'SET_PICKING') {
      setPicking(request.enabled);
      return Promise.resolve({ ok: true });
    }
    if (request.type === 'CLEAR_SELECTION') { clearSelection(); return Promise.resolve({ ok: true }); }
    if (request.type === 'COLLECT') return collectComplete(request.options);
    if (request.type === 'BEGIN_EXPORT') {
      runExport(request.job);
      return Promise.resolve({ ok: true });
    }
  });
})();
