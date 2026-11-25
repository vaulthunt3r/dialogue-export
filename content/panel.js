/* Compact controls use only measured free space; they never resize the chat. */
(function () {
  if (globalThis.ChatArchivePanel) return;
  let dock, launchers, launcher, badge, frame, hint, timer, opened = false, frameHeight = 300;
  const observers = [];
  function rect(node) {
    if (node.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
    const value = node.getBoundingClientRect();
    if (!(value.width > 0 && value.height > 0 && value.bottom > 80 && value.top < innerHeight)) return null;
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.visibility !== 'collapse' ? value : null;
  }
  function rightBoundary() {
    // UI geometry must not run export validation (IDs can be absent during loading).
    const selector = '[data-message-author-role], [data-user-message-bubble], [data-chatgpt-selection-message-id], [data-chatgpt-search-message-ids], article[data-testid^="conversation-turn-"], user-query, model-response, .conversation-container';
    const scope = document.querySelector('main, [role="main"]') || document;
    const nodes = [...scope.querySelectorAll(selector)].filter(node => !node.parentElement?.closest(selector));
    let right = 0, measured = false;
    // Image replies often have a full-width wrapper but no markdown body.
    // Measure their rendered media as well as text, not that empty wrapper.
    const bodySelector = '.markdown, [data-markdown-text-style], .whitespace-pre-wrap, .query-text, message-content, img, video, canvas, svg, p, pre, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6';
    for (const node of nodes) {
      if (!rect(node)) continue;
      const bodies = node.matches(bodySelector) ? [node] : [...node.querySelectorAll(bodySelector)];
      for (const body of bodies.length ? bodies : [node]) {
        const bounds = rect(body);
        if (bounds) { right = Math.max(right, bounds.right); measured = true; }
      }
    }
    for (const input of document.querySelectorAll('#prompt-textarea, main textarea, main [contenteditable="true"][role="textbox"]')) {
      // Some sites stretch the form across the page but center a rounded composer inside it.
      const form = input.closest('form');
      let composer = form || input, ancestor = input.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
        if (form && !form.contains(ancestor)) break;
        if (parseFloat(getComputedStyle(ancestor).borderRadius) >= 8 && ancestor.querySelector('button')) { composer = ancestor; break; }
        if (ancestor === form) break;
      }
      const bounds = rect(composer);
      if (bounds) { right = Math.max(right, bounds.right); measured = true; }
    }
    return measured ? right : innerWidth;
  }
  function collapse(focus = true) {
    opened = false;
    frame?.remove(); frame = null;
    layout();
    if (focus) launcher?.focus({ preventScroll: true });
  }
  function layout() {
    if (!dock?.isConnected) return;
    if (document.hidden) return;
    const free = innerWidth - rightBoundary() - 28;
    const fits = free >= 184 && innerHeight >= 380;
    const width = Math.min(220, Math.floor(free));
    const top = fits ? Math.min(180, Math.round(innerHeight * .2)) : 104;
    if (!fits && opened) { opened = false; frame?.remove(); frame = null; }
    dock.dataset.room = String(fits);
    dock.dataset.unavailable = String(free < 48);
    dock.style.setProperty('width', `${fits ? width : 48}px`, 'important');
    dock.style.setProperty('top', `${top}px`, 'important');
    dock.style.setProperty('max-height', `${Math.max(80, innerHeight - top - 16)}px`, 'important');
    launcher.hidden = opened;
    launchers.hidden = opened;
    launcher.setAttribute('aria-expanded', String(opened));
    launcher.title = fits ? 'Open Dialogue Export' : 'Not enough free space. Open Dialogue Export from the Firefox toolbar.';
    if (frame) {
      // Leave room for a result/selection block; expanded options scroll within the frame.
      const extras = [...dock.children].filter(node => node !== frame && node !== launchers && node !== hint)
        .reduce((height, node) => height + node.getBoundingClientRect().height + 8, 0);
      const available = innerHeight - top - 22 - extras;
      if (available < 200) {
        opened = false; frame.remove(); frame = null;
        launcher.hidden = false; launchers.hidden = false; launcher.setAttribute('aria-expanded', 'false'); hint.hidden = false;
      } else frame.style.height = `${Math.min(frameHeight + 2, available)}px`;
    }
  }
  function mount() {
    if (dock?.isConnected || !document.body || !browser.runtime.getURL) return;
    clearInterval(timer); observers.forEach(observer => observer.disconnect()); observers.length = 0;
    frame?.remove(); frame = null; opened = false;
    document.querySelectorAll('.chat-archive-dock').forEach(node => node.remove());
    dock = document.createElement('aside'); dock.className = 'chat-archive-dock';
    dock.setAttribute('aria-label', 'Dialogue Export');
    launchers = document.createElement('div'); launchers.className = 'chat-archive-launchers';
    launcher = document.createElement('button'); launcher.type = 'button'; launcher.className = 'chat-archive-launcher';
    launcher.setAttribute('aria-label', 'Open Dialogue Export');
    const icon = document.createElement('img'); icon.src = browser.runtime.getURL('icons/dialogue.svg');
    icon.alt = ''; icon.width = 20; icon.height = 20;
    badge = document.createElement('span'); badge.className = 'chat-archive-launcher-badge'; badge.setAttribute('aria-hidden', 'true');
    launcher.append(icon, badge);
    hint = document.createElement('p'); hint.className = 'chat-archive-dock-hint'; hint.hidden = true;
    hint.textContent = 'Use the dialogue icon in the Firefox toolbar.'; hint.setAttribute('role', 'status');
    launcher.addEventListener('click', () => {
      layout();
      if (dock.dataset.room !== 'true') { hint.textContent = 'Use the dialogue icon in the Firefox toolbar.'; hint.hidden = !hint.hidden; return; }
      hint.hidden = true; opened = true;
      frame = document.createElement('iframe'); frame.className = 'chat-archive-menu'; frame.title = 'Dialogue Export settings';
      frame.src = browser.runtime.getURL('popup/popup.html?panel=1');
      dock.insertBefore(frame, hint); layout();
    });
    launchers.append(launcher);
    dock.append(launchers, hint); document.body.append(dock);
    layout();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(layout); observer.observe(document.documentElement); observers.push(observer);
    }
    // Also catches host-app sidebar changes and SPA layouts without observing every text mutation.
    timer = setInterval(() => { if (!dock?.isConnected) mount(); else layout(); window.ChatArchivePanel.theme(window.ChatArchivePanel.pageTheme?.() || 'light'); }, 1200);
  }
  window.ChatArchivePanel = {
    mount, collapse, layout,
    size(height) { if (Number.isFinite(height)) { frameHeight = Math.max(80, Math.min(height, 1600)); layout(); } },
    attach(node) { mount(); if (dock) { dock.append(node); layout(); } else document.body.append(node); },
    theme(theme) { if (dock && dock.dataset.theme !== theme) dock.dataset.theme = theme; },
    status(state) {
      if (!launcher) return;
      badge.textContent = state === 'decision' ? '?' : state === 'running' ? '…' : state === 'error' ? '!' : state === 'done' ? '+' : '';
      const label = state === 'decision' ? 'Choose whether to save or discard the stopped export' : state === 'running' ? 'Export in progress' : state === 'error' ? 'Export stopped with an error' : state === 'done' ? 'Export completed' : '';
      launcher.setAttribute('aria-label', `Open Dialogue Export${label ? ' — ' + label : ''}`);
    }
  };
  let scheduled = 0;
  function scheduleLayout() { if (!scheduled) scheduled = setTimeout(() => { scheduled = 0; layout(); }, 100); }
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', scheduleLayout, { passive: true, capture: true });
  document.addEventListener('visibilitychange', layout);
  window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(scheduled); scheduled = 0; observers.forEach(observer => observer.disconnect()); observers.length = 0; opened = false; frame = null; dock?.remove(); });
  window.addEventListener('pageshow', event => { if (event.persisted) mount(); });
})();
