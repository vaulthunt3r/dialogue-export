(function () {
  const isGemini = location.hostname === 'gemini.google.com';

  function messageNodes() {
    if (isGemini) {
      const customElements = [...document.querySelectorAll('user-query, model-response')];
      if (customElements.length) return customElements;

      const containers = [...document.querySelectorAll('.conversation-container')];
      const messages = containers.flatMap(container => [
        container.querySelector('user-query, .query-text'),
        container.querySelector('model-response, .response-container, message-content')
      ].filter(Boolean));
      if (messages.length) return messages;
    }

    const primary = [...document.querySelectorAll('[data-message-author-role]')];
    if (primary.length) return primary;
    return [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')];
  }

  function roleOf(node, index) {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'user-query' || node.matches?.('.query-text')) return 'user';
    if (tag === 'model-response' || node.matches?.('.response-container, message-content')) return 'assistant';

    const explicit = node.getAttribute('data-message-author-role') ||
      node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (explicit === 'user' || explicit === 'assistant') return explicit;
    const label = (node.getAttribute('aria-label') || node.textContent.slice(0, 40)).toLowerCase();
    if (label.includes('you said') || label.includes('вы сказали')) return 'user';
    if (label.includes('chatgpt said') || label.includes('chatgpt сказал')) return 'assistant';
    return index % 2 === 0 ? 'user' : 'assistant';
  }

  function contentRoot(node) {
    if (isGemini) {
      if (node.tagName?.toLowerCase() === 'user-query') {
        return node.querySelector('.query-text, [data-test-id="user-query"]') || node;
      }
      if (node.tagName?.toLowerCase() === 'model-response') {
        return node.querySelector('message-content .markdown, .markdown-main-panel, message-content, .response-container') || node;
      }
    }
    return node;
  }

  function idOf(node, index) {
    if (isGemini) {
      const container = node.closest('.conversation-container');
      const containerId = container?.id || container?.getAttribute('data-turn-id') || `turn-${Math.floor(index / 2) + 1}`;
      return `gemini-${containerId}-${roleOf(node, index)}`;
    }
    const turn = node.closest('[data-testid^="conversation-turn-"]') || node.querySelector('[data-testid^="conversation-turn-"]');
    return turn?.getAttribute('data-testid') || node.dataset.chatArchiveId || `message-${index + 1}`;
  }

  function textWithLinks(source, markdown = false) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll('a[href]').forEach(link => {
      const label = (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim();
      const href = link.href || link.getAttribute('href') || '';
      if (!href) return;
      const replacement = !label || label === href
        ? href
        : markdown ? `[${label}](${href})` : `${label} (${href})`;
      link.replaceWith(document.createTextNode(replacement));
    });
    return (clone.innerText || clone.textContent || '').trim();
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

    clone.querySelectorAll('button, svg, nav, script, style, link, meta, object, embed, .chat-archive-picker').forEach(el => el.remove());
    clone.querySelectorAll('*').forEach(element => {
      [...element.attributes].forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && value.startsWith('javascript:'))) {
          element.removeAttribute(attribute.name);
        }
      });
    });
    clone.querySelectorAll('[contenteditable="true"]').forEach(el => el.removeAttribute('contenteditable'));
    clone.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (code) pre.replaceChildren(code.cloneNode(true));
    });
    if (isGemini) {
      const labels = new Set([
        'ваш запрос',
        'ответ gemini',
        'your prompt',
        'gemini response'
      ]);
      const normalized = value => value.replace(/\s+/g, ' ').trim().toLowerCase();
      [...clone.querySelectorAll('*')].reverse().forEach(element => {
        if (labels.has(normalized(element.textContent || ''))) element.remove();
      });
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      const redundantText = [];
      while (walker.nextNode()) {
        if (labels.has(normalized(walker.currentNode.textContent || ''))) redundantText.push(walker.currentNode);
      }
      redundantText.forEach(textNode => textNode.remove());
    }
    if (!includeLinks) clone.querySelectorAll('a').forEach(a => a.replaceWith(document.createTextNode(a.textContent)));
    return clone;
  }

  function title() {
    const provider = isGemini ? 'Gemini' : 'ChatGPT';
    const suffix = isGemini ? '(?:Google\\s+)?Gemini' : '(?:OpenAI\\s+)?ChatGPT';
    const raw = document.title.replace(new RegExp(`\\s*[|–—-]\\s*${suffix}\\s*$`, 'i'), '').trim();
    return raw && raw !== provider ? raw : `${provider} conversation`;
  }

  function provider() { return isGemini ? 'Gemini' : 'ChatGPT'; }

  window.ChatArchiveExtractor = {
    nodes: messageNodes,
    metadata() { return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString() }; },
    snapshot({ includeLinks = true, includeTimestamps = false } = {}) {
      return messageNodes().map((node, index) => {
        const clone = cleanClone(node, includeLinks);
        const plainText = (clone.innerText || clone.textContent || '').trim();
        const item = {
          id: idOf(node, index),
          order: Number((idOf(node, index).match(/(\d+)$/) || [])[1] ?? index),
          role: roleOf(node, index),
          selected: node.dataset.chatArchiveSelected === 'true',
          text: includeLinks ? textWithLinks(clone) : plainText,
          markdown: includeLinks ? textWithLinks(clone, true) : plainText,
          html: clone.innerHTML.trim()
        };
        if (includeTimestamps) {
          item.messageId = window.ChatArchiveMessageTimestamps.messageId(node);
          item.createdAt = window.ChatArchiveMessageTimestamps.read(node, item.role);
        }
        return item;
      }).filter(item => item.text);
    },
    collect({ selectedOnly = false, includeLinks = true, includeTimestamps = false } = {}) {
      const messages = this.snapshot({ includeLinks, includeTimestamps }).filter(item => !selectedOnly || item.selected);
      return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString(), messages };
    }
  };
})();
