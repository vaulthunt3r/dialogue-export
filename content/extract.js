(function () {
  const ROLE_SELECTORS = [
    '[data-message-author-role]',
    'article[data-testid^="conversation-turn-"]'
  ];

  function messageNodes() {
    const primary = [...document.querySelectorAll('[data-message-author-role]')];
    if (primary.length) return primary;
    return [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
  }

  function roleOf(node, index) {
    const explicit = node.getAttribute('data-message-author-role') ||
      node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (explicit === 'user' || explicit === 'assistant') return explicit;
    const label = (node.getAttribute('aria-label') || node.textContent.slice(0, 40)).toLowerCase();
    if (label.includes('you said') || label.includes('вы сказали')) return 'user';
    if (label.includes('chatgpt said') || label.includes('chatgpt сказал')) return 'assistant';
    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function contentRoot(node) {
    return node;
  }

  function idOf(node, index) {
    const turn = node.closest('[data-testid^="conversation-turn-"]') || node.querySelector('[data-testid^="conversation-turn-"]');
    return turn?.getAttribute('data-testid') || node.dataset.chatArchiveId || `message-${index + 1}`;
  }

  function cleanClone(node, includeLinks) {
    const source = contentRoot(node);
    const clone = source.cloneNode(true);
    const sourceElements = [...source.querySelectorAll('*')];
    const cloneElements = [...clone.querySelectorAll('*')];

    const sourceTextareas = [...source.querySelectorAll('textarea')];
    [...clone.querySelectorAll('textarea')].forEach((textarea, index) => {
      const value = sourceTextareas[index]?.value || textarea.value || textarea.textContent;
      const block = document.createElement('pre');
      block.className = 'chat-archive-text-block';
      block.textContent = value;
      textarea.replaceWith(block);
    });

    const sourceFrames = [...source.querySelectorAll('iframe')];
    [...clone.querySelectorAll('iframe')].forEach((frame, index) => {
      let frameBody;
      try { frameBody = sourceFrames[index]?.contentDocument?.body; } catch (_) { frameBody = null; }
      if (!frameBody?.innerText?.trim()) { frame.remove(); return; }
      const block = document.createElement('section');
      block.className = 'chat-archive-embedded-block';
      block.append(...[...frameBody.childNodes].map(node => node.cloneNode(true)));
      frame.replaceWith(block);
    });

    sourceElements.forEach((element, index) => {
      const shadow = element.shadowRoot;
      if (!shadow?.textContent?.trim() || !cloneElements[index]) return;
      const block = document.createElement('section');
      block.className = 'chat-archive-embedded-block';
      block.append(...[...shadow.childNodes].map(node => node.cloneNode(true)));
      cloneElements[index].append(block);
    });

    clone.querySelectorAll('button, svg, nav, .chat-archive-picker').forEach(el => el.remove());
    clone.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) pre.replaceChildren(code.cloneNode(true));
    });
    if (!includeLinks) clone.querySelectorAll('a').forEach(a => a.replaceWith(document.createTextNode(a.textContent)));
    return clone;
  }

  function title() {
    const raw = document.title.replace(/\s*[|–-]\s*ChatGPT\s*$/i, '').trim();
    return raw && raw !== 'ChatGPT' ? raw : 'ChatGPT conversation';
  }

  window.ChatArchiveExtractor = {
    nodes: messageNodes,
    metadata() { return { title: title(), url: location.href, exportedAt: new Date().toISOString() }; },
    snapshot({ includeLinks = true } = {}) {
      return messageNodes().map((node, index) => {
        const clone = cleanClone(node, includeLinks);
        return {
          id: idOf(node, index),
          order: Number((idOf(node, index).match(/(\d+)$/) || [])[1] ?? index),
          role: roleOf(node, index),
          selected: node.dataset.chatArchiveSelected === 'true',
          text: (clone.innerText || clone.textContent || '').trim(),
          html: clone.innerHTML.trim()
        };
      }).filter(item => item.text);
    },
    collect({ selectedOnly = false, includeLinks = true } = {}) {
      const messages = this.snapshot({ includeLinks }).filter(item => !selectedOnly || item.selected);
      return { title: title(), url: location.href, exportedAt: new Date().toISOString(), messages };
    }
  };
})();
