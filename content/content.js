(function () {
  if (globalThis.ChatArchiveContentReady) return;
  let picking = false;
  let observer;
  const messageCache = new Map();
  const messageOrder = [];
  let cachedCharacters = 0;
  let forwardAnchor = null;
  let activeExport = false;
  let exportStatus = null;
  let activePartJobId = null;
  let uiTimer;
  let dismissTimer;
  let collectingUrl = null;
  let cancelRequested = false;
  let stopChoice = null;
  let pageInterrupted = false;
  function assertConversation() {
    if (pageInterrupted || collectingUrl !== null && location.href !== collectingUrl) {
      throw new Error('The conversation changed during export. Open the intended chat and export again.');
    }
    if (cancelRequested) { const error = new Error('Export stopped.'); error.exportStopped = true; throw error; }
  }
  function requestStop() {
    if (!activeExport || exportStatus?.cancellable === false) return;
    cancelRequested = true;
    exportStatus.label = exportStatus.phase === 'saving' ? 'Stopping after the current file finishes…' : 'Stopping…';
    progressView(75, exportStatus.label, 'running', exportStatus.processed);
  }
  function resolveStop(action) {
    if (!stopChoice || !['save', 'discard'].includes(action) || action === 'save' && !exportStatus?.canSaveCollected) return false;
    const resolve = stopChoice; stopChoice = null; resolve(action); return true;
  }
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

  async function prepareImages(options) {
    const started = Date.now();
    if (options.waitForImages) {
      await window.ChatArchiveMedia?.waitForImages(() => {
        assertConversation();
        const extractor = window.ChatArchiveExtractor;
        return extractor.nodes().map((node, index) => ({ node, index, role: extractor.roleOf(node, index) }))
          .filter(({ node }) => !options.sourceMessageIds || options.sourceMessageIds.includes(extractor.sourceIdOf(node)))
          .filter(({ node }) => !options.selectedOnly || node.dataset.chatArchiveSelected === 'true')
          .filter(({ role }) => (role === 'user' ? options.includeUserImages : options.includeAssistantImages) !== false)
          .map(({ node, index }) => {
            const root = extractor.contentRoot(node);
            return { node: root, owner: extractor.idOf(node, index), excludedRoots: extractor.mediaExclusions(root) };
          });
      }, { onProgress: options.onImageProgress });
    }
    assertConversation();
    return Date.now() - started;
  }

  async function remember(options = {}, earlier = false) {
    const imageWait = await prepareImages(options);
    assertConversation();
    const batch = window.ChatArchiveExtractor.snapshot(options);
    // Merge visible windows by their shared messages. Disjoint windows loaded
    // while seeking the beginning precede the cache; forward windows follow it.
    if (earlier) forwardAnchor = null;
    let cursor = earlier || !forwardAnchor ? 0 : messageOrder.indexOf(forwardAnchor) + 1;
    batch.forEach((item, index) => {
      const known = messageOrder.indexOf(item.id);
      if (known >= 0) cursor = known + 1;
      else {
        const nextKnown = batch.slice(index + 1).find(next => messageCache.has(next.id));
        const position = nextKnown ? messageOrder.indexOf(nextKnown.id) : cursor;
        messageOrder.splice(position, 0, item.id);
        cursor = position + 1;
      }
      const previous = messageCache.get(item.id);
      const nextCharacters = cachedCharacters + window.ChatArchiveExtractor.payloadSize(item) -
        (previous ? window.ChatArchiveExtractor.payloadSize(previous) : 0);
      if (nextCharacters > window.ChatArchiveExtractor.maxPayloadCharacters) {
        throw new Error('This export exceeds the content memory limit. Export fewer selected messages. No partial file was saved.');
      }
      cachedCharacters = nextCharacters;
      // Virtualised nodes can temporarily lose their metadata. Retain a known
      // time only for the same exact message, never a different regenerated reply.
      if (options.includeTimestamps && !item.createdAt && previous?.createdAt && item.messageId &&
          item.messageId === previous.messageId && item.role === previous.role) item.createdAt = previous.createdAt;
      messageCache.set(item.id, previous?.selected && !item.selected ? { ...item, selected: true } : item);
    });
    if (!earlier && batch.length) forwardAnchor = batch.at(-1).id;
    return imageWait;
  }

  function scrollCandidates() {
    const messages = window.ChatArchiveExtractor.nodes();
    const first = messages[0];
    const candidates = [];
    if (!first) return document.scrollingElement ? [document.scrollingElement] : [];
    let node = first.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      // Hidden overflow permits programmatic scrolling; clip does not. Small
      // scroll ranges still matter when a virtualizer loads near its boundary.
      const withinMessage = node.closest('[data-turn-key], [data-message-author-role], article[data-testid^="conversation-turn-"], [data-chatgpt-search-message-ids]');
      if (!withinMessage && /^(auto|scroll|hidden|overlay)$/.test(style.overflowY) &&
          node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1 &&
          messages.every(message => node.contains(message))) candidates.push(node);
      node = node.parentElement;
    }
    if (document.scrollingElement) candidates.push(document.scrollingElement);
    return [...new Set(candidates)];
  }

  function scrollHost() {
    const candidates = scrollCandidates();
    let blocked = false;
    for (const node of candidates) {
      const range = Math.max(0, node.scrollHeight - node.clientHeight);
      if (range <= 1) continue;
      const controller = scrollController(node);
      if (controller.movable) return controller;
      controller.restore();
      blocked = true;
    }
    if (blocked) throw new Error('The conversation could not be scrolled. Please report this interface variant.');
    // A short, fully loaded conversation may legitimately have no scroll range.
    return document.scrollingElement ? scrollController(document.scrollingElement) : null;
  }

  function scrollController(node) {
    const originalTop = node.scrollTop;
    const styles = ['scroll-behavior', 'scroll-snap-type'].map(name =>
      [name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
    node.style.setProperty('scroll-behavior', 'auto', 'important');
    node.style.setProperty('scroll-snap-type', 'none', 'important');
    const originalRange = Math.max(0, node.scrollHeight - node.clientHeight);
    // One-pixel probes distinguish a real scroll host from a clipped wrapper,
    // and detect negative scroll coordinates even when initially at the bottom.
    let lower = originalTop, upper = originalTop;
    if (originalRange > 1) {
      node.scrollTop = originalTop - 1;
      lower = node.scrollTop;
      node.scrollTop = originalTop + 1;
      upper = node.scrollTop;
      node.scrollTop = originalTop;
    }
    const reversed = Math.min(originalTop, lower, upper) < 0 ||
      getComputedStyle(node).flexDirection === 'column-reverse';
    const maximum = () => Math.max(0, node.scrollHeight - node.clientHeight);
    return {
      movable: Math.abs(lower - originalTop) > 0.5 || Math.abs(upper - originalTop) > 0.5,
      get clientHeight() { return node.clientHeight; },
      get scrollHeight() { return node.scrollHeight; },
      get scrollTop() { return Math.max(0, Math.min(maximum(), node.scrollTop + (reversed ? maximum() : 0))); },
      set scrollTop(value) {
        if (!node.isConnected) throw new Error('The conversation scroll area changed during export. Please retry.');
        const max = maximum();
        node.scrollTop = Math.max(0, Math.min(max, value)) - (reversed ? max : 0);
      },
      restore() {
        try { if (node.isConnected) node.scrollTop = originalTop; }
        finally {
          for (const [name, value, priority] of styles) {
            if (value) node.style.setProperty(name, value, priority);
            else node.style.removeProperty(name);
          }
        }
      }
    };
  }

  function cacheExpected() {
    return Math.max(1, messageCache.size);
  }

  function visibleStartSignature() {
    return window.ChatArchiveExtractor.nodes().slice(0, 3).map(node => {
      const turnId = node.closest?.('[data-turn-key]')?.getAttribute('data-turn-key') ||
        node.closest?.('[data-testid^="conversation-turn-"]')?.getAttribute('data-testid') || '';
      const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      return `${turnId}:${text}`;
    }).join('|');
  }

  async function triggerEarlierBatch(host, options) {
    const previousSignature = visibleStartSignature();
    let noChangeDeadline = Date.now() + 6500;
    let finalDeadline = Date.now() + 14000;
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
      const imageWait = await remember(options, true);
      if (cachedPageResult(options)) return true;
      noChangeDeadline += imageWait;
      finalDeadline += imageWait;
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
      if (!changed && Date.now() >= noChangeDeadline) {
        if (host.scrollTop > 8) throw new Error('The conversation did not scroll to the beginning. Please retry or report this interface variant.');
        return false;
      }
    }
    return changed;
  }

  async function loadConversationStart(host, options, onProgress) {
    let unchangedCycles = 0;

    for (let pass = 0; ; pass++) {
      const previousCount = messageCache.size;
      const changed = await triggerEarlierBatch(host, options);
      if (cachedPageResult(options)) return;
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
    await remember(options, true);
  }

  async function collectComplete(options = {}, onProgress = () => {}) {
    if (collectingUrl !== null) throw new Error('An export is already running.');
    collectingUrl = location.href;
    messageCache.clear(); messageOrder.length = 0; cachedCharacters = 0; forwardAnchor = null;
    window.ChatArchiveMedia?.beginExport();
    try {
      let progress = [1, 'Preparing export', 0, 0];
      const update = (...args) => { progress = args; onProgress(...args); };
      const result = await collectCurrent({ ...options, onImageProgress: (ready, total) =>
        onProgress(progress[0], `Waiting for images: ${ready}/${total}`, progress[2], progress[3]) }, update);
      try { assertConversation(); }
      catch (error) { if (error.exportStopped) error.partialData = result; throw error; }
      return result;
    } finally {
      collectingUrl = null;
      messageCache.clear(); messageOrder.length = 0; cachedCharacters = 0; forwardAnchor = null;
      window.ChatArchiveMedia?.endExport();
    }
  }

  async function collectCurrent(options = {}, onProgress = () => {}) {
    if (window.ChatArchiveApi?.eligible(options)) {
      const result = await window.ChatArchiveApi.collect(options, assertConversation, onProgress, options.onPart,
        (expected, needed, report) => collectRenderedMessages(expected, needed, options, report));
      if (result.data) {
        if (exportStatus) exportStatus.collectionNotice = result.data.collectionMethod === 'chatgpt-api-rendered'
          ? 'Direct export · loaded card layout preserved · no scrolling'
          : `Direct ${options.outputFormat.toUpperCase()} export · no scrolling${result.data.componentMessages ? ' · cards rendered from saved data' : ''}${result.data.embeddedImages ? ` · ${result.data.embeddedImages} images embedded` : ''}${result.data.unavailableCitations ? ' · some source links unavailable' : ''}`;
        return result.data;
      }
      if (exportStatus) {
        exportStatus.collectionNotice = result.fallback;
        exportStatus.sourceDiagnostic = result.sourceDiagnostic || null;
      }
      if (result.pageMessages?.length) {
        options = { ...options, pageMessages: result.pageMessages, includeSourceIds: true };
        const extractor = window.ChatArchiveExtractor;
        const mounted = extractor.nodes().map((node, index) => ({ sourceMessageId: extractor.sourceIdOf(node), role: extractor.roleOf(node, index) }));
        if (matchesPageMessages(mounted, options.pageMessages)) {
          await prepareImages(options);
          const data = extractor.collect(options);
          if (matchesPageMessages(data.messages, options.pageMessages)) {
            onProgress(96, 'Rendered messages verified against the current conversation', data.messages.length, data.messages.length);
            if (exportStatus) exportStatus.collectionNotice = 'Rendered page · message IDs and order verified · no scrolling';
            return verifiedPageResult(data, options);
          }
        }
      }
      if (window.ChatArchiveApi.conversationId(location.href)) {
        throw new Error(`${result.fallback} Automatic page scrolling is disabled for saved ChatGPT conversations. No file was saved.`);
      }
      onProgress(2, `${result.fallback} Reading the page instead.`);
    }
    if (options.selectedOnly) {
      await prepareImages(options);
      const selected = window.ChatArchiveExtractor.collect(options);
      onProgress(75, 'Collecting selected messages', selected.messages.length, selected.messages.length);
      return selected;
    }

    const host = scrollHost();
    if (!host) { await prepareImages(options); return verifiedPageResult(window.ChatArchiveExtractor.collect(options), options); }
    try {
      return verifiedPageResult(await collectFromHost(host, options, onProgress), options);
    } finally { host.restore(); }
  }

  function matchesPageMessages(messages, expected) {
    return !!expected?.length && messages.length === expected.length && messages.every((message, index) =>
      message.sourceMessageId === expected[index].id && message.role === expected[index].role);
  }

  async function collectRenderedMessages(expected, needed, options, report = () => {}) {
    const extractor = window.ChatArchiveExtractor;
    const positions = new Map(expected.map((message, index) => [message.id, { ...message, index }]));
    const matches = phase => {
      let previous = -1, code = null, unidentified = 0, ambiguous = 0;
      const present = new Set();
      const nodes = extractor.nodes();
      for (const [index, node] of nodes.entries()) {
        const identity = extractor.sourceIdentityOf?.(node) || { id: extractor.sourceIdOf(node) };
        if (identity.ambiguous) { ambiguous++; code ||= 'RENDERED_ID_AMBIGUOUS'; continue; }
        // The API supplies ordinary text. An unrelated bubble without a source
        // ID cannot invalidate an exactly identified card, and is never copied.
        if (!identity.id) { unidentified++; continue; }
        const message = positions.get(identity.id);
        if (!message) { code ||= 'RENDERED_BRANCH_MISMATCH'; continue; }
        if (message.index <= previous) code ||= 'RENDERED_ORDER_MISMATCH';
        if (extractor.roleOf(node, index) !== message.role) code ||= 'RENDERED_ROLE_MISMATCH';
        previous = message.index; present.add(identity.id);
      }
      const missing = needed.filter(id => !present.has(id));
      if (missing.length) code ||= 'RENDERED_MESSAGE_NOT_LOADED';
      if (!code) return true;
      report({ version: 1, reason: 'rendered-message-match-failed', code, phase,
        expectedMessages: expected.length, mountedMessages: nodes.length, requiredRenderedMessages: needed.length,
        matchedRenderedMessages: needed.length - missing.length, unidentifiedPageMessages: unidentified, ambiguousPageMessages: ambiguous,
        missingMessagePositions: missing.slice(0, 12).map(id => positions.get(id).index + 1) });
      return false;
    };
    if (!matches('before-images')) return null;
    const selection = { ...options, sourceMessageIds: needed, includeSourceIds: true };
    await prepareImages(selection);
    assertConversation();
    if (!matches('after-images')) return null;
    const messages = extractor.snapshot(selection);
    if (!matchesPageMessages(messages, needed.map(id => positions.get(id)))) {
      report({ version: 1, reason: 'rendered-message-match-failed', code: 'RENDERED_CONTENT_MISMATCH', phase: 'snapshot',
        expectedMessages: expected.length, requiredRenderedMessages: needed.length, collectedRenderedMessages: messages.length });
      return null;
    }
    return new Map(messages.map(message => [message.sourceMessageId, { html: message.html }]));
  }

  function cachedPageResult(options) {
    const messages = messageOrder.map(id => messageCache.get(id));
    return matchesPageMessages(messages, options.pageMessages)
      ? { ...window.ChatArchiveExtractor.metadata(), messages: messages.map((message, order) => ({ ...message, order })) } : null;
  }

  function verifiedPageResult(data, options) {
    if (options.pageMessages) {
      if (!matchesPageMessages(data.messages, options.pageMessages)) {
        throw new Error('The rendered messages could not be matched to the complete current conversation. No file was saved. Reload the chat and retry.');
      }
      data.collectionMethod = 'chatgpt-page-verified';
    }
    data.messages.forEach(message => { delete message.sourceMessageId; });
    return data;
  }

  async function collectFromHost(host, options, onProgress) {
    messageCache.clear();
    messageOrder.length = 0;
    cachedCharacters = 0;
    forwardAnchor = null;
    await remember(options);
    const mounted = cachedPageResult(options);
    if (mounted) return mounted;
    let expected = cacheExpected();
    onProgress(2, 'Moving to the start', messageCache.size, expected);

    await loadConversationStart(host, options, onProgress);
    const complete = cachedPageResult(options);
    if (complete) return complete;
    await remember(options); // Anchor forward insertion before cached messages from the initial bottom window.
    expected = Math.max(expected, cacheExpected());
    onProgress(20, 'Collecting messages', messageCache.size, expected);

    let unchanged = 0;
    let lastEndState = '';
    let reachedEnd = false;
    let stalled = 0;
    let progressDeadline = Date.now() + 60000;
    for (;;) {
      const before = host.scrollTop;
      const beforeHeight = host.scrollHeight;
      const beforeCount = messageCache.size;
      const amount = Math.max(350, Math.floor(host.clientHeight * 0.72));
      host.scrollTop = Math.min(host.scrollTop + amount, host.scrollHeight);
      await pause(180);
      progressDeadline += await remember(options);
      const complete = cachedPageResult(options);
      if (complete) return complete;
      expected = Math.max(expected, cacheExpected());
      const maximum = Math.max(1, host.scrollHeight - host.clientHeight);
      onProgress(Math.min(96, 20 + Math.round((host.scrollTop / maximum) * 76)), 'Collecting conversation', messageCache.size, expected);
      const atEnd = host.scrollTop + host.clientHeight >= host.scrollHeight - 8;
      const endState = `${Math.round(host.scrollHeight)}:${messageCache.size}:${messageOrder.at(-1)}`;
      unchanged = atEnd && endState === lastEndState ? unchanged + 1 : 0;
      lastEndState = atEnd ? endState : '';
      if (atEnd && unchanged >= 8) {
        reachedEnd = true;
        break;
      }
      stalled = !atEnd && Math.abs(host.scrollTop - before) < 1 && host.scrollHeight === beforeHeight && messageCache.size === beforeCount ? stalled + 1 : 0;
      if (stalled >= 12) throw new Error('The conversation stopped scrolling before the end. Please retry or report this interface variant.');
      // Length alone is not a failure: large chats can need thousands of steps.
      // Renew the timeout only for new messages or forward movement in stable geometry.
      if (messageCache.size > beforeCount || (host.scrollHeight === beforeHeight && host.scrollTop > before + 1)) {
        progressDeadline = Date.now() + 60000;
      }
      if (Date.now() >= progressDeadline) break;
    }

    if (!reachedEnd) {
      throw new Error('Could not reach the end of this conversation. Please try the export again.');
    }

    const metadata = window.ChatArchiveExtractor.metadata();
    const messages = messageOrder.map((id, order) => ({ ...messageCache.get(id), order }));
    return { ...metadata, messages };
  }

  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function syncAppearance() {
    const theme = pageTheme();
    window.ChatArchivePanel?.theme(theme);
    document.querySelectorAll('.chat-archive-picker, .chat-archive-selection-bar, .chat-archive-progress').forEach(node => {
      if (node.dataset.theme !== theme) node.dataset.theme = theme;
    });
    const elapsed = document.querySelector('.chat-archive-elapsed');
    if (elapsed && exportStatus) {
      const seconds = Math.max(0, Math.floor(((exportStatus.finishedAt ?? Date.now()) - exportStatus.startedAt) / 1000));
      setText(elapsed, `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
      const bar = document.querySelector('.chat-archive-ascii');
      if (bar) setText(bar, exportStatus.state === 'done' ? '[##########]' : exportStatus.state === 'error' ? '[! stopped]' : `[${'.'.repeat(seconds % 10)}>${'.'.repeat(9 - seconds % 10)}]`);
    }
    if (!picking && !activeExport && !document.querySelector('.chat-archive-progress')) {
      clearInterval(uiTimer); uiTimer = null;
    }
  }
  function watchAppearance() {
    syncAppearance();
    if (!uiTimer) uiTimer = setInterval(syncAppearance, 1000);
  }

  function dismissProgress(view) {
    clearTimeout(dismissTimer); dismissTimer = null;
    if (!view?.isConnected) return;
    view.remove(); window.ChatArchivePanel?.status(null); window.ChatArchivePanel?.layout(); syncAppearance();
    browser.runtime.sendMessage({ type: 'EXPORT_DISMISSED' }).catch(() => {});
  }

  function scheduleProgressDismiss(view) {
    clearTimeout(dismissTimer); dismissTimer = null;
    if (!['done', 'error'].includes(exportStatus?.state) || !view) return;
    const completed = exportStatus;
    dismissTimer = setTimeout(() => {
      if (!activeExport && exportStatus === completed) dismissProgress(view);
    }, Math.max(0, 5000 - (Date.now() - completed.finishedAt)));
  }

  function progressView(percent, label, state = 'running', processed = 0) {
    clearTimeout(dismissTimer); dismissTimer = null;
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
      dismiss.addEventListener('click', () => {
        if (activeExport) { requestStop(); dismiss.disabled = true; }
        else dismissProgress(view);
      });
      row.append(title, elapsed, dismiss);
      const detail = document.createElement('div'); detail.className = 'chat-archive-progress-detail';
      const more = document.createElement('details'); more.className = 'chat-archive-progress-more';
      const summary = document.createElement('summary'); summary.textContent = '[+] Details';
      more.append(summary, detail);
      const timeline = document.createElement('div');
      timeline.className = 'chat-archive-timeline';
      timeline.setAttribute('aria-hidden', 'true');
      for (let index = 0; index < 3; index++) timeline.append(document.createElement('i'));
      const bar = document.createElement('div'); bar.className = 'chat-archive-ascii'; bar.setAttribute('aria-hidden', 'true');
      view.append(row, timeline, bar, more);
      if (window.ChatArchivePanel) window.ChatArchivePanel.attach(view); else document.body.append(view);
    }
    view.dataset.state = state;
    view.querySelector('.chat-archive-progress-more summary').textContent = `[+] ${processed} messages`;
    if (state === 'error' || state === 'decision') view.querySelector('.chat-archive-progress-more').open = true;
    window.ChatArchivePanel?.status(state);
    if (exportStatus) exportStatus.cancellable = state === 'running' && percent < 98 && !cancelRequested;
    setText(view.querySelector('.chat-archive-progress-title'), label);
    const detail = state === 'decision' ? exportStatus.stopDetail : state === 'error' ? 'Open Dialogue Export to try again.' : `${processed} messages collected${state === 'running' ? ' · keep this tab open' : exportStatus?.format === 'pdf' ? ' · save from the print page' : ' · check the save dialog or Downloads'}${state === 'done' && exportStatus?.timestampNotice ? ` · ${exportStatus.timestampNotice}` : ''}`;
    setText(view.querySelector('.chat-archive-progress-detail'), `${detail}${exportStatus?.collectionNotice ? ` · ${exportStatus.collectionNotice}` : ''}`);
    const dismiss = view.querySelector('.chat-archive-dismiss');
    dismiss.hidden = state === 'decision';
    dismiss.textContent = state === 'running' ? '[Stop]' : '[x]';
    dismiss.setAttribute('aria-label', state === 'running' ? 'Stop export' : 'Dismiss export status');
    // Handoff cannot be cancelled after the browser has received the file.
    dismiss.disabled = state === 'running' && (cancelRequested || percent >= 98);
    view.querySelector('.chat-archive-stop-choice')?.remove();
    if (state === 'decision') {
      const actions = document.createElement('div'); actions.className = 'chat-archive-stop-choice';
      for (const [action, label] of [['save', exportStatus.phase === 'saving' ? '[ Save remaining ]' : '[ Save collected ]'], ['discard', '[ Discard ]']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.action = action;
        button.disabled = action === 'save' && !exportStatus.canSaveCollected;
        button.addEventListener('click', () => { if (resolveStop(action)) actions.querySelectorAll('button').forEach(node => { node.disabled = true; }); });
        actions.append(button);
      }
      view.append(actions);
    }
    view.querySelector('.chat-archive-image-access')?.remove();
    if (['error', 'decision'].includes(state) && exportStatus?.mediaDiagnostic?.download?.code === 'IMAGE_PERMISSION_REQUIRED') {
      const allow = document.createElement('button'); allow.type = 'button'; allow.className = 'chat-archive-image-access';
      allow.textContent = '[ Allow image access ]';
      allow.addEventListener('click', async () => {
        allow.disabled = true;
        try {
          const result = await browser.runtime.sendMessage({ type: 'IMAGE_ACCESS_OPEN' });
          if (!result?.ok) throw new Error('Could not open image permissions.');
          allow.textContent = '[ Image settings opened ]';
        } catch (_) { allow.textContent = '[ Retry image settings ]'; }
        finally { allow.disabled = false; }
      });
      view.append(allow);
    }
    view.querySelector('.chat-archive-image-diagnostic')?.remove();
    if ((['error', 'decision'].includes(state) || exportStatus?.partial) && exportStatus?.mediaDiagnostic) {
      const details = document.createElement('details'); details.className = 'chat-archive-image-diagnostic';
      const summary = document.createElement('summary'); summary.textContent = 'Image diagnostic (no conversation text or URLs)';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(exportStatus.mediaDiagnostic, null, 2);
      pre.style.cssText = 'max-height:160px;overflow:auto;white-space:pre-wrap;font-size:11px;user-select:text';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '[ Copy diagnostic ]';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = '[ Copied ]'; }
        catch (_) {
          const range = document.createRange(); range.selectNodeContents(pre);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          copy.textContent = '[ Selected — press Ctrl+C ]';
        }
      });
      details.append(summary, copy, pre); view.append(details);
    }
    view.querySelector('.chat-archive-source-diagnostic')?.remove();
    if (state !== 'running' && exportStatus?.sourceDiagnostic) {
      const details = document.createElement('details'); details.className = 'chat-archive-source-diagnostic';
      const summary = document.createElement('summary'); summary.textContent = 'Direct export diagnostic (no conversation text or URLs)';
      const pre = document.createElement('pre'); pre.textContent = JSON.stringify(exportStatus.sourceDiagnostic, null, 2);
      pre.style.cssText = 'max-height:160px;overflow:auto;white-space:pre-wrap;font-size:11px;user-select:text';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '[ Copy diagnostic ]';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = '[ Copied ]'; }
        catch (_) {
          const range = document.createRange(); range.selectNodeContents(pre);
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
          copy.textContent = '[ Selected — press Ctrl+C ]';
        }
      });
      details.append(summary, copy, pre); view.append(details);
    }
    // These segments represent loading, collecting, and preparing the file.
    // The site does not tell us the total message count or time remaining.
    const stage = percent < 20 ? 0 : percent < 98 ? 1 : 2;
    [...view.querySelector('.chat-archive-timeline').children].forEach((segment, index) => {
      segment.className = state === 'done' || index < stage ? 'done' : state === 'running' && index === stage ? 'current' : '';
      segment.textContent = ['LOAD', /image/i.test(label) ? 'IMAGES' : 'READ', 'SAVE'][index];
    });
    window.ChatArchivePanel?.layout();
    watchAppearance();
    if (state === 'done' || state === 'error') scheduleProgressDismiss(view);
    return view;
  }

  async function runExport(job) {
    activeExport = true; pageInterrupted = false;
    cancelRequested = false;
    setPicking(false);
    exportStatus = { state: 'running', label: 'Preparing export', phase: 'collecting', format: job.format, processed: 0, startedAt: Date.now() };
    const startUrl = location.href;
    let partSession = null, savingParts = false, savedParts = 0, interrupted = false;
    const sendParts = async request => {
      const result = await browser.runtime.sendMessage(request);
      if (!result?.ok) throw new Error(result?.error || 'Firefox could not prepare the export parts.');
      return result;
    };
    const checkParts = (allowStopped = false) => {
      if (interrupted || pageInterrupted || location.href !== startUrl) throw new Error('The conversation changed during export. No further files were saved.');
      if (!allowStopped) assertConversation();
    };
    const monitor = setInterval(() => {
      if (interrupted || (!pageInterrupted && location.href === startUrl)) return;
      interrupted = true;
      if (stopChoice) { const resolve = stopChoice; stopChoice = null; resolve('discard'); }
      if (partSession) browser.runtime.sendMessage({ type: 'EXPORT_PARTS_ABORT', id: partSession }).catch(() => {});
    }, 100);
    const chooseStopped = async (data, cause = null) => {
      checkParts(true);
      const count = data?.multipart?.messages || data?.messages?.length || 0;
      Object.assign(exportStatus, { state: 'decision', label: cause?.imageEmbedFailed ? 'Image export interrupted — save what is ready?' : 'Export stopped — save what is ready?', processed: count,
        ...(cause?.mediaDiagnostic ? { mediaDiagnostic: cause.mediaDiagnostic } : {}),
        canSaveCollected: count > 0, finishedAt: Date.now(), cancellable: false,
        stopDetail: (cause?.imageEmbedFailed ? `${cause.message} ` : '') + (count ? `${count} complete messages ready${data.partialExport ? ` of ${data.partialExport.totalMessages}` : ''}.${data.embeddedImages ? ` ${data.embeddedImages} images included.` : ''} ${data.partialExport ? 'The unfinished message is excluded. ' : ''}${savedParts ? `${savedParts} file(s) already saved; those files remain if you discard. ` : ''}Choose Save or Discard.`
          : 'No complete messages are ready to save. Discard this export to start again.') });
      const decision = new Promise(resolve => { stopChoice = resolve; });
      progressView(75, exportStatus.label, 'decision', count);
      browser.runtime.sendMessage({ type: 'EXPORT_PROGRESS', percent: 75, stage: 'WAIT' }).catch(() => {});
      const action = await decision;
      checkParts(true);
      if (action !== 'save') {
        Object.assign(exportStatus, { state: 'error', label: savedParts ? `Export discarded. ${savedParts} saved file(s) remain in Downloads.` : 'Export discarded. No files were saved.', finishedAt: Date.now() });
        progressView(100, exportStatus.label, 'error', count);
        browser.runtime.sendMessage({ type: 'EXPORT_FAILED', notify: false }).catch(() => {});
        return false;
      }
      cancelRequested = false; delete exportStatus.finishedAt; delete exportStatus.canSaveCollected; delete exportStatus.stopDetail;
      exportStatus.state = 'running';
      return true;
    };
    try {
      const update = (percent, label, processed = 0) => {
        Object.assign(exportStatus, { label, processed });
        progressView(percent, label, 'running', processed);
        browser.runtime.sendMessage({ type: 'EXPORT_PROGRESS', percent, stage: percent < 20 ? 'LOAD' : percent < 98 ? 'READ' : 'SAVE' }).catch(() => {});
      };
      update(1, 'Preparing export');
      const onPart = async (data, { stopped = false } = {}) => {
        checkParts(stopped);
        if (!partSession) {
          partSession = (await sendParts({ type: 'EXPORT_PARTS_START', job })).id;
          activePartJobId = partSession;
        }
        checkParts(stopped);
        await sendParts({ type: 'EXPORT_PARTS_STAGE', id: partSession, data });
      };
      let data;
      try {
        data = await collectComplete({ ...job.options, outputFormat: job.format, waitForImages: job.format === 'html' || job.format === 'pdf',
          onPart: ['html', 'pdf'].includes(job.format) ? onPart : undefined }, update);
        checkParts();
      } catch (error) {
        if (!error.exportStopped && !error.imageEmbedFailed) throw error;
        data = error.partialData || data || null;
        if (!await chooseStopped(data, error)) return;
      }
      checkParts();
      if (data.url !== location.href) throw new Error('The conversation changed during export. Please retry.');
      if (!data.messages.length && !data.multipart) throw new Error(job.options.selectedOnly ? 'No messages selected.' : 'No messages found.');
      if (job.options.includeTimestamps && !data.multipart) {
        data.messageTimestamps = ChatArchiveTimestamps.summarize(data.messages);
        exportStatus.timestampNotice = ChatArchiveTimestamps.notice(data.messageTimestamps);
      }
      const count = data.multipart?.messages || data.messages.length;
      exportStatus.phase = 'saving';
      if (data.multipart) {
        checkParts();
        await sendParts({ type: 'EXPORT_PARTS_SEAL', id: partSession, summary: { ...data.multipart, ...(data.partialExport ? { partialExport: data.partialExport } : {}) } });
        if (cancelRequested && !await chooseStopped(data)) return;
        if (job.format === 'pdf') {
          update(98, `Opening PDF preview · ${data.multipart.parts} parts`, count);
          await sendParts({ type: 'EXPORT_PARTS_PRINT', id: partSession });
        } else {
          savingParts = true;
          for (let index = 1; index <= data.multipart.parts; index++) {
            if (cancelRequested && !await chooseStopped(data)) return;
            checkParts();
            update(97, `Saving part ${index} of ${data.multipart.parts} to Downloads`, count);
            await sendParts({ type: 'EXPORT_PARTS_SAVE', id: partSession, index });
            savedParts++;
          }
        }
        checkParts(true); // A Stop during the final completed download cannot undo it.
        cancelRequested = false;
        partSession = null; activePartJobId = null;
      } else {
        update(98, 'Preparing file', count);
        const result = await browser.runtime.sendMessage({ type: 'EXPORT_READY', job, data });
        if (!result?.ok) throw new Error(result?.error || 'Firefox could not receive the file.');
      }
      const label = (data.partialExport ? 'Partial export · ' : '') + (data.multipart ? job.format === 'pdf' ? `Print page opened · ${data.multipart.parts} parts` : `${savedParts} HTML parts saved to Downloads`
        : job.format === 'pdf' ? 'Print page opened' : 'File sent to Firefox');
      Object.assign(exportStatus, { state: 'done', label, finishedAt: Date.now(), partial: !!data.partialExport });
      progressView(100, exportStatus.label, 'done', count);
      browser.runtime.sendMessage({ type: 'EXPORT_COMPLETE', format: job.format, parts: data.multipart?.parts || 1,
        notify: job.options.notifyOnCompletion === true, ...(data.partialExport ? { partial: true } : {}) }).catch(() => {});
    } catch (error) {
      if (pageInterrupted) return;
      const prefix = savingParts ? `Export incomplete. ${savedParts} part(s) confirmed saved; numbered files may remain in Downloads. ` : '';
      Object.assign(exportStatus, { state: 'error', label: prefix + (error?.message || String(error)), mediaDiagnostic: error?.mediaDiagnostic || null, finishedAt: Date.now() });
      progressView(100, exportStatus.label, 'error', exportStatus.processed);
      browser.runtime.sendMessage({ type: 'EXPORT_FAILED', notify: job.options.notifyOnCompletion === true }).catch(() => {});
    } finally {
      stopChoice = null;
      clearInterval(monitor);
      if (partSession) await browser.runtime.sendMessage({ type: 'EXPORT_PARTS_ABORT', id: partSession }).catch(() => {});
      activePartJobId = null;
      activeExport = false;
      cancelRequested = false;
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
    setText(button, selected ? '[x]' : '[ ]');
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
      bar.append(label, clear, done);
      if (window.ChatArchivePanel) window.ChatArchivePanel.attach(bar); else document.body.append(bar);
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
    pageInterrupted = true;
    if (activeExport) {
      cancelRequested = true;
      Object.assign(exportStatus, { state: 'error', label: 'Export discarded because the source page was closed.', finishedAt: Date.now() });
      document.querySelector('.chat-archive-progress')?.remove(); window.ChatArchivePanel?.status(null);
    }
    if (stopChoice) { const resolve = stopChoice; stopChoice = null; resolve('discard'); }
    if (activePartJobId) browser.runtime.sendMessage({ type: 'EXPORT_PARTS_ABORT', id: activePartJobId }).catch(() => {});
    observer?.disconnect();
    clearInterval(uiTimer); uiTimer = null;
    clearTimeout(dismissTimer); dismissTimer = null;
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      if (picking) setPicking(true);
      if (activeExport || document.querySelector('.chat-archive-progress')) watchAppearance();
      scheduleProgressDismiss(document.querySelector('.chat-archive-progress'));
    }
  });

  browser.runtime.onMessage.addListener(request => {
    if (request.type?.startsWith('HISTORY_')) {
      if (request.type === 'HISTORY_START' && activeExport) return Promise.resolve({ ok: false, code: 'BUSY' });
      return window.ChatArchiveHistory?.handle(request) || Promise.resolve({ ok: false, code: 'SESSION_ENDED' });
    }
    if (request.type === 'PANEL_COLLAPSE') { window.ChatArchivePanel?.collapse(); return Promise.resolve({ ok: true }); }
    if (request.type === 'PANEL_SIZE') { window.ChatArchivePanel?.size(request.height); return Promise.resolve({ ok: true }); }
    if (request.type === 'STOP_EXPORT') {
      requestStop();
      return Promise.resolve({ ok: true });
    }
    if (request.type === 'RESOLVE_STOP') return Promise.resolve({ ok: resolveStop(request.action) });
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
      if (activeExport || window.ChatArchiveHistory?.active) return Promise.resolve({ ok: false, error: 'An export is already running. Check the archive tab too.' });
      const job = request.job;
      if (!job || !['txt', 'md', 'html', 'json', 'pdf'].includes(job.format) || typeof job.filename !== 'string' || !job.options) {
        return Promise.resolve({ ok: false, error: 'The export settings are invalid.' });
      }
      runExport(job);
      return Promise.resolve({ ok: true, exportStatus: { ...exportStatus } });
    }
  });
  globalThis.ChatArchiveContentReady = true;
  if (window.ChatArchivePanel) window.ChatArchivePanel.pageTheme = pageTheme;
  window.ChatArchivePanel?.mount();
  window.ChatArchivePanel?.theme(pageTheme());
})();
