// Run in the affected chat's Firefox Web Console BEFORE starting an export.
// Read-only DOM sampling: no scrolling, network, message text, URLs or real IDs.
// Afterwards: copy(window.dialogueExportCollectionReport.stop())
(() => {
  const aliases = new Map(), elements = new WeakMap();
  const samples = [];
  let elementCount = 0, timer, stopped = false, sawRunning = false, previous = '', dropped = 0;
  const started = Date.now();
  const alias = key => {
    if (!aliases.has(key)) {
      if (aliases.size >= 20000) return null;
      aliases.set(key, aliases.size + 1);
    }
    return aliases.get(key);
  };
  const elementId = el => { if (!elements.has(el)) elements.set(el, ++elementCount); return elements.get(el); };
  function visible(el) {
    for (; el; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (el.hidden || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true' || s.display === 'none' || ['hidden', 'collapse'].includes(s.visibility) || s.contentVisibility === 'hidden') return false;
    }
    return true;
  }
  function identity(el) {
    const role = el.hasAttribute('data-user-message-bubble') ? 'user' : el.getAttribute('data-message-author-role') === 'user' ? 'user' : 'assistant';
    for (const name of ['data-chatgpt-selection-message-id', 'data-chatgpt-search-message-ids', 'data-chatgpt-search-unit-key', 'data-message-id', 'data-turn-key']) {
      const value = el.closest(`[${name}]`)?.getAttribute(name);
      if (value) return alias(`${role}:${name}:${value}`);
    }
    return alias(`element:${elementId(el)}`);
  }
  function sample() {
    if (stopped) return;
    const selector = '[data-user-message-bubble], [data-chatgpt-selection-message-id], [data-message-author-role]';
    const nodes = [...document.querySelectorAll(selector)].filter(el => !el.parentElement?.closest(selector) && el.closest('main, [role="main"]') && visible(el));
    for (const tile of document.querySelectorAll('[data-web-image-tile]')) {
      const unit = tile.closest('[data-chatgpt-search-message-ids]');
      if (unit && tile.closest('[data-turn-key], article[data-testid^="conversation-turn-"]') && visible(tile) && !nodes.some(el => el.contains(unit) || unit.contains(el))) nodes.push(unit);
    }
    nodes.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const scrollers = new Set();
    for (const node of [nodes[0], nodes.at(-1)]) {
      for (let el = node?.parentElement; el; el = el.parentElement) {
        if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 && /^(auto|scroll|hidden|overlay)$/.test(getComputedStyle(el).overflowY)) scrollers.add(el);
      }
    }
    if (document.scrollingElement) scrollers.add(document.scrollingElement);
    const view = document.querySelector('.chat-archive-progress');
    const state = ['running', 'done', 'error'].includes(view?.dataset.state) ? view.dataset.state : 'idle';
    const title = view?.querySelector('.chat-archive-progress-title')?.textContent || '';
    const phase = /Waiting for images/.test(title) ? 'images' : /start|earlier|window/i.test(title) ? 'start' : /Collecting/.test(title) ? 'collect' : /Preparing file/.test(title) ? 'file' : 'other';
    const processed = Number(view?.querySelector('.chat-archive-progress-detail')?.textContent.match(/^(\d+) messages collected/)?.[1] || 0);
    const images = [...new Set(nodes.flatMap(el => [...el.querySelectorAll('img')]))].filter(visible);
    const boundedNodes = nodes.length > 64 ? [...nodes.slice(0, 32), ...nodes.slice(-32)] : nodes;
    const data = { state, phase, processed, mounted: nodes.length, ids: boundedNodes.map(identity), idsTruncated: nodes.length > 64,
      busyCount: [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-loading="true"]')].filter(visible).length,
      images: { total: images.length, loaded: images.filter(img => img.complete && img.naturalWidth > 0).length },
      scrollers: [...scrollers].map(el => ({ id: elementId(el), document: el === document.scrollingElement, top: Math.round(el.scrollTop), height: el.scrollHeight, viewport: el.clientHeight })) };
    const signature = JSON.stringify(data);
    if (signature !== previous) {
      samples.push({ ms: Date.now() - started, ...data }); previous = signature;
      if (samples.length > 2000) { samples.splice(100, 1); dropped++; }
    }
    if (state === 'running') sawRunning = true;
    if (sawRunning && (state === 'done' || state === 'error')) { stopped = true; clearInterval(timer); }
    if (Date.now() - started > 3600000) { stopped = true; clearInterval(timer); }
  }
  window.dialogueExportCollectionReport = {
    stop() {
      sample(); stopped = true; clearInterval(timer);
      return JSON.stringify({ diagnosticVersion: 2, durationMs: Date.now() - started, distinctAliases: aliases.size, aliasLimitReached: aliases.size >= 20000, droppedSamples: dropped, samples }, null, 2);
    }
  };
  sample();
  timer = setInterval(sample, 500);
  return 'Recording collection counts and scroll positions. Start export, then run: copy(window.dialogueExportCollectionReport.stop())';
})();
