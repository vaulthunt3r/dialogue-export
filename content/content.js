(function () {
  let picking = false;
  let observer;
  const messageCache = new Map();
  let activeExport = false;

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function remember(options = {}) {
    window.ChatArchiveExtractor.snapshot(options).forEach(item => {
      const previous = messageCache.get(item.id);
      messageCache.set(item.id, previous?.selected && !item.selected ? { ...item, selected: true } : item);
    });
  }

  function scrollHost() {
    const first = window.ChatArchiveExtractor.nodes()[0];
    if (!first) return document.scrollingElement;
    let node = first.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 100) return node;
      node = node.parentElement;
    }
    return document.scrollingElement;
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
    let expected = Math.max(1, ...[...messageCache.values()].map(item => item.order + 1));
    onProgress(4, 'Moving to the start', messageCache.size, expected);

    host.scrollTop = 0;
    await pause(450);
    remember(options);
    onProgress(8, 'Collecting messages', messageCache.size, expected);

    let unchanged = 0;
    let lastTop = -1;
    for (let step = 0; step < 300; step++) {
      const amount = Math.max(350, Math.floor(host.clientHeight * 0.72));
      host.scrollTop = Math.min(host.scrollTop + amount, host.scrollHeight);
      await pause(180);
      remember(options);
      expected = Math.max(expected, ...[...messageCache.values()].map(item => item.order + 1));
      const maximum = Math.max(1, host.scrollHeight - host.clientHeight);
      onProgress(Math.min(96, 8 + Math.round((host.scrollTop / maximum) * 88)), 'Collecting conversation', messageCache.size, expected);
      const atEnd = host.scrollTop + host.clientHeight >= host.scrollHeight - 8;
      unchanged = host.scrollTop === lastTop ? unchanged + 1 : 0;
      lastTop = host.scrollTop;
      if (atEnd && unchanged >= 2) break;
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
      view.innerHTML = '<div class="chat-archive-progress-row"><span></span><strong></strong></div><div class="chat-archive-timeline"></div>';
      document.body.append(view);
    }
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
      progressView(100, job.format === 'pdf' ? 'Print page opened' : 'File sent to Downloads', 'done', data.messages.length, data.messages.length);
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
      if (button) return;
      button = document.createElement('button');
      button.className = 'chat-archive-picker';
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
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'chat-archive-selection-bar';
    bar.innerHTML = '<span>Message selection is active</span><button type="button">Done</button>';
    bar.querySelector('button').addEventListener('click', () => setPicking(false));
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
      const all = window.ChatArchiveExtractor.collect();
      return Promise.resolve({ ok: true, title: all.title, count: all.messages.length, selected: all.messages.filter(x => x.selected).length, picking });
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
