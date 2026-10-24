// Paste into the affected chat's Firefox Web Console. This reads DOM metadata
// only: no scrolling, requests, image decoding, text, URLs, IDs or cookies.
// If a failed image is already mounted, a report is copied immediately.
// Otherwise it records for up to 60 seconds. Stop/copy manually with:
// copy(window.dialogueExportImageReport.stop())
(() => {
  const clipboard = typeof copy === 'function' ? copy : null;
  const samples = [];
  const started = Date.now();
  let timer, expiry, stopped = false, previous = '', sawRunning = false;
  const markers = ['data-user-message-bubble', 'data-message-author-role', 'data-chatgpt-selection-message-id', 'data-chatgpt-search-message-ids', 'data-web-image-tile', 'data-turn-key', 'hidden', 'inert'];
  const knownClasses = new Set(['icon-2xs', 'icon-xs', 'icon-sm', 'icon-md', 'avatar', 'favicon', 'rounded-full', 'object-contain', 'object-cover', 'group/activity-header', 'group/generated-image-gallery-controls']);
  const knownTags = new Set(['img', 'div', 'span', 'a', 'button', 'p', 'figure', 'picture', 'section', 'article', 'main', 'body', 'nav', 'form']);
  function savedFailure(view) {
    // The extension captures this at the throw site, before restoring scroll.
    // Re-allowlist values since page DOM is not a trusted diagnostic source.
    try {
      const text = view?.querySelector('.chat-archive-image-diagnostic pre')?.textContent;
      if (!text || text.length > 8000) return null;
      const raw = JSON.parse(text);
      if (raw.version !== 1 || !['load', 'decode', 'timeout'].includes(raw.phase)) return null;
      const dimensions = value => Array.isArray(value) && value.length === 2 && value.every(n => Number.isFinite(n) && n >= 0) ? value : null;
      return { version: 1, phase: raw.phase,
        sourceKind: ['empty', 'http', 'https', 'data', 'blob', 'other', 'invalid'].includes(raw.sourceKind) ? raw.sourceKind : 'other',
        faviconPath: raw.faviconPath === true, complete: typeof raw.complete === 'boolean' ? raw.complete : null,
        naturalSize: dimensions(raw.naturalSize), renderedSize: dimensions(raw.renderedSize),
        hasSrcset: raw.hasSrcset === true, hasAlt: raw.hasAlt === true, emptyAlt: raw.emptyAlt === true,
        ancestors: (Array.isArray(raw.ancestors) ? raw.ancestors : []).slice(0, 10).map(el => ({
          tag: knownTags.has(el?.tag) ? el.tag : 'other', imageTile: el?.imageTile === true,
          activityHeader: el?.activityHeader === true, presentation: el?.presentation === true, iconClass: el?.iconClass === true
        })) };
    } catch (_) { return null; }
  }
  function shape(el) {
    const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
    const role = el.getAttribute('role');
    return {
      tag: knownTags.has(el.localName) ? el.localName : 'other',
      markers: markers.filter(name => el.hasAttribute(name)),
      classes: [...el.classList].filter(name => knownClasses.has(name)), otherClassCount: [...el.classList].filter(name => !knownClasses.has(name)).length,
      role: ['img', 'presentation', 'none', 'button', 'link'].includes(role) ? role : null,
      hidden: el.hidden || el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden',
      size: [Math.round(bounds.width), Math.round(bounds.height)], children: el.children.length
    };
  }
  function inspect(img, index) {
    const ancestors = [];
    for (let el = img; el && ancestors.length < 10; el = el.parentElement) ancestors.push(shape(el));
    let sourceKind = 'empty', faviconPath = false;
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (src) {
      try {
        const url = new URL(src, location.href);
        sourceKind = ['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) ? url.protocol.slice(0, -1) : 'other';
        faviconPath = /favicon/i.test(url.pathname);
      } catch (_) { sourceKind = 'invalid'; }
    }
    return { index, complete: img.complete, naturalSize: [img.naturalWidth, img.naturalHeight], sourceKind, faviconPath,
      hasSrcset: img.hasAttribute('srcset'), hasAlt: img.hasAttribute('alt'), emptyAlt: img.getAttribute('alt') === '',
      loading: ['lazy', 'eager'].includes(img.getAttribute('loading')) ? img.getAttribute('loading') : 'default',
      inMessage: !!img.closest('[data-user-message-bubble], [data-chatgpt-selection-message-id], [data-message-author-role], article[data-testid^="conversation-turn-"], [data-chatgpt-search-message-ids]'),
      ancestors };
  }
  function report() { return JSON.stringify({ diagnosticVersion: 1, durationMs: Date.now() - started, samples }, null, 2); }
  function stop() { stopped = true; clearInterval(timer); clearTimeout(expiry); return report(); }
  function finish() { const result = stop(); if (clipboard) clipboard(result); }
  function sample() {
    if (stopped) return;
    const view = document.querySelector('.chat-archive-progress');
    const extensionFailure = savedFailure(view);
    const state = ['running', 'done', 'error'].includes(view?.dataset.state) ? view.dataset.state : 'idle';
    if (state === 'running') sawRunning = true;
    const candidates = [];
    let inspected = 0, failed = 0, pending = 0;
    for (const img of document.images) {
      if (++inspected > 500) break;
      if (!img.closest('main, [role="main"]')) continue;
      const broken = img.complete && (!img.naturalWidth || !img.naturalHeight) && !!(img.currentSrc || img.getAttribute('src') || img.getAttribute('srcset'));
      if (broken) failed++;
      else if (!img.complete) pending++;
      if (broken && candidates.length < 16) candidates.push(inspect(img, inspected - 1));
    }
    const data = { state, imageCount: document.images.length, inspectionTruncated: document.images.length > 500, failed, pending, candidatesTruncated: failed > candidates.length, candidates, extensionFailure };
    const signature = JSON.stringify(data);
    if (signature !== previous) {
      samples.push({ ms: Date.now() - started, ...data }); previous = signature;
      if (samples.length > 6) samples.shift();
    }
    if ((state === 'error' && (failed > 0 || extensionFailure)) || (sawRunning && ['done', 'error'].includes(state))) finish();
  }
  window.dialogueExportImageReport = { stop };
  sample();
  if (!stopped) { timer = setInterval(sample, 200); expiry = setTimeout(finish, 60000); }
  return stopped ? 'Structural image report copied. No text, URLs, IDs, cookies or pixels included.'
    : 'Recording image metadata for up to 60 seconds. Stop and copy: copy(window.dialogueExportImageReport.stop())';
})();
