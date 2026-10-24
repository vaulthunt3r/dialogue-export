(function () {
  const isGemini = location.hostname === 'gemini.google.com';
  const modernSelector = '[data-user-message-bubble], [data-chatgpt-selection-message-id]';
  const activityHeader = '[class~="group/activity-header"]';
  const turnSelector = '[data-turn-key], article[data-testid^="conversation-turn-"]';
  let imageMessages = new WeakSet();
  const maxPayloadCharacters = 16 * 1024 * 1024;
  const payloadSize = item => ['id', 'text', 'markdown', 'html'].reduce((sum, key) => sum + (item[key]?.length || 0), 0) +
    (item.activities || []).reduce((sum, activity) => sum + ['title', 'text', 'markdown', 'html'].reduce((n, key) => n + (activity[key]?.length || 0), 0), 0);

  function activityRoots(scope = document, cleaned = false) {
    const roots = [...scope.querySelectorAll(activityHeader)]
      .filter(header => cleaned || header.querySelector('button[aria-expanded][aria-labelledby]'))
      .map(header => header.parentElement);
    return roots.filter(root => !roots.some(other => other !== root && other.contains(root)));
  }

  // These sections are removed from the ordinary answer and serialized as text
  // by readActivity(). Their icons/media must not block or inflate image capture.
  const mediaExclusions = node => isGemini ? [] : activityRoots(node, true);

  function readActivity(root, includeLinks) {
    const header = root.querySelector(activityHeader);
    const button = header.querySelector('button[aria-expanded][aria-labelledby]');
    const label = document.getElementById(button.getAttribute('aria-labelledby'));
    const title = (label && header.contains(label) ? label.textContent : header.textContent).trim();
    const expanded = button.getAttribute('aria-expanded') === 'true';
    const body = document.createElement('div');
    if (expanded) {
      for (const child of root.children) {
        if (child === header || !activeMessage(child)) continue;
        // Hidden descendants are not available activity content. Drop controls,
        // transient layout styles and decorative favicons from the saved section.
        const originals = [...child.querySelectorAll('*')];
        // Remove invisible content before cloning again to keep source DOM untouched.
        const safe = child.cloneNode(true);
        [...safe.querySelectorAll('*')].forEach((el, i) => {
          if (!activeMessage(originals[i])) el.remove();
        });
        const cleaned = cleanClone(safe, includeLinks, false);
        cleaned.querySelectorAll('img,svg,button').forEach(el => el.remove());
        [cleaned, ...cleaned.querySelectorAll('*')].forEach(el => {
          el.removeAttribute('style'); el.removeAttribute('class'); el.removeAttribute('id');
        });
        body.append(cleaned);
      }
    }
    const textBody = body.cloneNode(true);
    textBody.querySelectorAll('p,li,pre,h1,h2,h3,h4').forEach(el => el.append(document.createTextNode('\n\n')));
    return { title: title || 'Working / Thinking', expanded, text: textWithLinks(textBody), markdown: textWithLinks(textBody, true), html: body.innerHTML };
  }

  function activitiesByMessage(nodes, includeLinks) {
    const result = new Map();
    for (const root of activityRoots()) {
      if (!activeMessage(root)) continue;
      const containing = nodes.filter(node => node.contains(root));
      const turn = root.closest(turnSelector);
      const candidates = containing.length ? containing : turn
        ? nodes.filter((node, index) => roleOf(node, index) === 'assistant' && node.closest(turnSelector) === turn)
        : [];
      // Never attach by proximity: retained routes and virtualized windows make
      // "the next answer" unsafe. Require one explicitly bounded assistant turn.
      if (candidates.length !== 1 || roleOf(candidates[0], nodes.indexOf(candidates[0])) !== 'assistant') {
        throw new Error('A Working / Thinking section could not be safely linked to one assistant message. Turn off Include Working / Thinking sections to export ordinary messages.');
      }
      const node = candidates[0];
      if (!result.has(node)) result.set(node, []);
      result.get(node).push(readActivity(root, includeLinks));
    }
    return result;
  }

  function activeMessage(node) {
    // Kept-alive routes and search previews can contain real message markup.
    // Do not use viewport intersection: offscreen messages still belong in an export.
    for (let element = node; element; element = element.parentElement) {
      if (element.hidden || element.hasAttribute('inert') || element.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden') return false;
    }
    if (document.querySelector('main, [role="main"]') && !node.closest('main, [role="main"]')) return false;
    const conversationId = location.pathname.match(/\/c\/([^/]+)/)?.[1];
    if (conversationId) {
      const owner = node.closest('[data-chatgpt-selection-conversation-id]') ||
        node.querySelector('[data-chatgpt-selection-conversation-id]') ||
        node.closest('[data-turn-key], article[data-testid^="conversation-turn-"]')?.querySelector('[data-chatgpt-selection-conversation-id]');
      const id = owner?.getAttribute('data-chatgpt-selection-conversation-id');
      // User bubbles may not carry an owner ID. Skipping just a foreign assistant
      // could leave its question in the export, so an ambiguous visible page fails closed.
      if (id && id !== conversationId) throw new Error('Messages from another conversation are still visible in the page. Reload the intended chat before exporting.');
    }
    return true;
  }

  function messageNodes() {
    imageMessages = new WeakSet();
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

    const selector = `[data-message-author-role], ${modernSelector}`;
    // Keep DOM order and avoid counting nested old/new markers twice.
    const primary = [...document.querySelectorAll(selector)]
      .filter(node => !node.parentElement?.closest(selector) && activeMessage(node));
    const nodes = primary.length ? primary : [...document.querySelectorAll('article[data-testid^="conversation-turn-"]')].filter(activeMessage);
    // Generated image replies use a keyed image unit instead of the ordinary
    // assistant selection marker. A turn can also contain the user's prompt:
    // export only the image's own unit, never the entire enclosing turn.
    const seen = new Set();
    for (const tile of document.querySelectorAll('[data-web-image-tile]')) {
      if (nodes.some(node => node.contains(tile)) || !activeMessage(tile)) continue;
      const turn = tile.closest(turnSelector);
      if (!turn || tile.closest('nav, form, [data-chatgpt-composer]')) continue;
      const unit = tile.closest('[data-chatgpt-search-message-ids]');
      if (unit && (seen.has(unit) || nodes.some(node => unit.contains(node)))) continue;
      const key = unit?.getAttribute('data-chatgpt-search-message-ids')?.trim();
      if (!unit || !turn.contains(unit) || !key) {
        throw new Error('A generated image was detected, but its message identifier is unavailable. Please report this interface variant.');
      }
      if (nodes.some(node => node.closest('[data-chatgpt-search-message-ids]')?.getAttribute('data-chatgpt-search-message-ids')?.trim() === key)) {
        throw new Error('An image message identifier is shared by multiple messages. Export was stopped to avoid merging content.');
      }
      seen.add(unit);
      imageMessages.add(unit);
      nodes.push(unit);
    }
    return nodes.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
  }

  function roleOf(node, index) {
    const tag = node.tagName?.toLowerCase();
    if (tag === 'user-query' || node.matches?.('.query-text')) return 'user';
    if (tag === 'model-response' || node.matches?.('.response-container, message-content')) return 'assistant';

    const explicit = node.getAttribute('data-message-author-role') ||
      node.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
    if (explicit === 'user' || explicit === 'assistant') return explicit;
    if (node.matches('[data-user-message-bubble]')) return 'user';
    if (node.matches('[data-chatgpt-selection-message-id]')) return 'assistant';
    if (imageMessages.has(node)) return 'assistant';
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
    if (imageMessages.has(node)) return `chatgpt-assistant-data-chatgpt-search-message-ids:${node.getAttribute('data-chatgpt-search-message-ids').trim()}`;
    if (node.matches(modernSelector) && !node.hasAttribute('data-message-author-role')) {
      const role = roleOf(node, index);
      const messageId = node.getAttribute('data-chatgpt-selection-message-id')?.trim();
      if (messageId) return `chatgpt-${role}-message:${messageId}`;
      // These values are opaque keys, not numbers or assumed JSON arrays.
      for (const attribute of ['data-chatgpt-search-message-ids', 'data-chatgpt-search-unit-key', 'data-turn-key', 'data-message-id', 'data-content-search-unit-key']) {
        const value = node.closest(`[${attribute}]`)?.getAttribute(attribute)?.trim();
        if (value) return `chatgpt-${role}-${attribute}:${value}`;
      }
      const legacyTurn = node.closest('article[data-testid^="conversation-turn-"]');
      if (legacyTurn) return `chatgpt-${role}-${legacyTurn.getAttribute('data-testid')}`;
      // A viewport index would overwrite other messages as ChatGPT virtualizes.
      throw new Error('ChatGPT messages were detected, but stable message identifiers are unavailable. Please report this interface variant.');
    }
    const turn = node.closest('[data-testid^="conversation-turn-"]') || node.querySelector('[data-testid^="conversation-turn-"]');
    return turn?.getAttribute('data-testid') || node.dataset.chatArchiveId || `message-${index + 1}`;
  }

  function textWithLinks(source, markdown = false) {
    const clone = source.cloneNode(true);
    clone.querySelectorAll('img').forEach(image => {
      const label = (image.getAttribute('alt') || 'Image').replace(/[\[\]\\\r\n]/g, ' ');
      const src = image.getAttribute('src') || '';
      const value = markdown && src ? `![${label}](<${src.replace(/</g, '%3C').replace(/>/g, '%3E')}>)`
        : `[Image: ${label}]${/^https?:/i.test(src) ? ` (${src})` : ''}`;
      image.replaceWith(document.createTextNode(`\n${value}\n`));
    });
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

  function cleanClone(node, includeLinks, includeMedia = true, mediaOwner) {
    const source = contentRoot(node);
    if (source.textContent.length > maxPayloadCharacters) throw new Error('This export exceeds the text memory limit. Export fewer selected messages. No partial file was saved.');
    const clone = source.cloneNode(true);
    const sourceElements = [...source.querySelectorAll('*')];
    const cloneElements = [...clone.querySelectorAll('*')];
    if (includeMedia) window.ChatArchiveMedia?.preserve(source, clone, { owner: mediaOwner, excludedRoots: mediaExclusions(source) });

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

    // Modern ChatGPT code is a CodeMirror editor, not a pre/code pair.
    // Copy its rendered lines into portable markup without editor layout or controls.
    clone.querySelectorAll('.cm-content[data-language], [data-code-block] .cm-content').forEach(editor => {
      if (editor.closest('[aria-hidden="true"], [hidden]')) { editor.remove(); return; }
      const lines = [...editor.children].filter(line => line.classList.contains('cm-line'));
      if (!lines.length) return;
      const language = (editor.getAttribute('data-language') || 'Code').replace(/[^\w+#.-]/g, '').slice(0, 40) || 'Code';
      const block = document.createElement('div');
      block.className = 'chat-archive-code';
      const label = document.createElement('div');
      label.className = 'chat-archive-code-label'; label.textContent = language;
      const pre = document.createElement('pre'), code = document.createElement('code');
      code.setAttribute('data-language', language);
      function copyToken(source, target) {
        if (source.nodeType === Node.TEXT_NODE) { target.append(document.createTextNode(source.textContent)); return; }
        if (source.nodeType !== Node.ELEMENT_NODE || source.tagName === 'BR') return;
        const classes = source.getAttribute('class') || '';
        const token = /(?:^|\s)Comment-/.test(classes) ? 'comment' : classes.match(/text-codex-syntax-(keyword|string|literal|variable)/)?.[1];
        const span = document.createElement('span');
        if (token) span.className = `export-code-${token}`;
        [...source.childNodes].forEach(child => copyToken(child, span));
        target.append(span);
      }
      lines.forEach((line, index) => {
        if (index) code.append(document.createTextNode('\n'));
        [...line.childNodes].forEach(child => copyToken(child, code));
      });
      pre.append(code); block.append(label, pre);
      const wrapper = editor.closest('[data-code-block]');
      const target = wrapper && wrapper.querySelectorAll('.cm-content').length === 1 && !wrapper.querySelector('img,svg,canvas,figure') ? wrapper : editor;
      if (editor.querySelector('.cm-gap') || wrapper?.querySelector('.cm-gap')) {
        const notice = document.createElement('p'); notice.textContent = 'Some code lines were not loaded in the editor. Check the original conversation.'; block.append(notice);
      }
      target.replaceWith(block);
    });

    clone.querySelectorAll('button, svg, canvas, nav, script, style, link, meta, object, embed, .chat-archive-picker').forEach(el => el.remove());
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
    if (!includeLinks) clone.querySelectorAll('a').forEach(a => a.replaceWith(...a.childNodes));
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
    idOf,
    contentRoot,
    mediaExclusions,
    payloadSize,
    maxPayloadCharacters,
    metadata() { return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString() }; },
    snapshot({ includeLinks = true, includeTimestamps = false, includeActivity = false, selectedOnly = false, outputFormat = null } = {}) {
      const nodes = messageNodes();
      const activities = !isGemini && includeActivity ? activitiesByMessage(nodes, includeLinks) : new Map();
      const identifiers = new Set();
      let characters = 0;
      return nodes.map((node, index) => {
        const id = idOf(node, index);
        if (identifiers.has(id)) throw new Error('A message identifier is shared by multiple messages. This interface is ambiguous; export was stopped to avoid losing content.');
        identifiers.add(id);
        if (selectedOnly && node.dataset.chatArchiveSelected !== 'true') return null;
        const clone = cleanClone(node, includeLinks, true, id);
        // Activity is serialized separately and never counted twice in the answer.
        if (!isGemini) activityRoots(clone, true).forEach(root => root.remove());
        const item = {
          id,
          order: index,
          role: roleOf(node, index),
          selected: node.dataset.chatArchiveSelected === 'true',
          text: textWithLinks(clone)
        };
        if (!outputFormat || ['md', 'json'].includes(outputFormat)) item.markdown = textWithLinks(clone, true);
        if (!outputFormat || ['html', 'pdf', 'json'].includes(outputFormat)) item.html = clone.innerHTML.trim();
        if (includeTimestamps) {
          item.messageId = window.ChatArchiveMessageTimestamps.messageId(node);
          item.createdAt = window.ChatArchiveMessageTimestamps.read(node, item.role);
        }
        if (activities.has(node)) item.activities = activities.get(node);
        characters += payloadSize(item);
        if (characters > maxPayloadCharacters) throw new Error('This export exceeds the content memory limit. Export fewer selected messages. No partial file was saved.');
        return item;
      }).filter(item => item?.text);
    },
    collect({ selectedOnly = false, includeLinks = true, includeTimestamps = false, includeActivity = false, outputFormat = null } = {}) {
      const messages = this.snapshot({ includeLinks, includeTimestamps, includeActivity, selectedOnly, outputFormat });
      return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString(), messages };
    }
  };
})();
