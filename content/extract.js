(function () {
  if (globalThis.ChatArchiveExtractor) return;
  const isGemini = location.hostname === 'gemini.google.com';
  const modernSelector = '[data-user-message-bubble], [data-chatgpt-selection-message-id]';
  const activityHeader = '[class~="group/activity-header"]';
  const turnSelector = '[data-turn-key], article[data-testid^="conversation-turn-"]';
  let imageMessages = new WeakSet();
  const maxPayloadCharacters = 16 * 1024 * 1024;
  const payloadSize = item => ['id', 'sourceMessageId', 'text', 'markdown', 'html'].reduce((sum, key) => sum + (item[key]?.length || 0), 0) +
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

  function sourceIdentityOf(node) {
    const attributes = ['data-message-id', 'data-chatgpt-selection-message-id', 'data-dil-source-message-id', 'data-dil-message-id'];
    const direct = [node, ...node.querySelectorAll(attributes.map(name => `[${name}]`).join(','))];
    const ids = new Set(direct.flatMap(element => attributes.map(name => element.getAttribute(name)?.trim()).filter(Boolean)));
    if (ids.size) return ids.size === 1 ? { id: [...ids][0] } : { id: null, ambiguous: true };
    const turn = node.closest(turnSelector);
    for (let parent = node, depth = 0; parent && depth < 8; parent = parent.parentElement, depth++) {
      const value = parent.getAttribute('data-chatgpt-search-message-ids')?.trim();
      if (value) {
        if (!value.startsWith('[')) return { id: value };
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === 'string' && parsed[0].trim()
            ? { id: parsed[0].trim() } : { id: null, ambiguous: true };
        } catch (_) { return { id: null, ambiguous: true }; }
      }
      if (parent === turn || parent.matches('main, [role="main"]')) break;
    }
    return { id: null };
  }

  const sourceIdOf = node => sourceIdentityOf(node).id;

  function textWithLinks(source, markdown = false) {
    const clone = source.cloneNode(true);
    if (markdown) {
      function fencedCode(pre) {
        const code = pre.querySelector('code') || pre;
        const candidates = [code, pre].flatMap(element => [
          element.getAttribute('data-language'), element.getAttribute('data-lang'),
          ...[...element.classList].map(name => name.match(/^(?:language|lang)-(.+)$/)?.[1])
        ]);
        const language = (candidates.find(value => value && /^[\w+#.-]{1,40}$/.test(value)) || '').toLowerCase();
        const value = code.textContent || '';
        let fenceLength = 3;
        for (const match of value.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
        const fence = '`'.repeat(fenceLength);
        return `\n\n${fence}${language}\n${value}${value.endsWith('\n') ? '' : '\n'}${fence}\n\n`;
      }
      if (clone.matches('pre')) return fencedCode(clone).trim();
      // Convert code first so link/image formatting cannot rewrite its contents.
      clone.querySelectorAll('pre').forEach(pre => {
        const block = fencedCode(pre);
        pre.closest('.chat-archive-code')?.querySelector('.chat-archive-code-label')?.remove();
        pre.replaceWith(document.createTextNode(block));
      });
    }
    clone.querySelectorAll('img').forEach(image => {
      if (image.hasAttribute('data-export-icon')) { image.remove(); return; }
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

  function preserveCardLayouts(sourceElements, cloneElements) {
    // Copy a small, inert presentation subset for rendered components. Never
    // carry page stylesheets, positioning, clipping or external CSS resources.
    const properties = ('color background-color font-family font-size font-weight font-style line-height letter-spacing text-align ' +
      'text-decoration-line text-decoration-style text-decoration-color border-radius ' +
      'padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left ' +
      'row-gap column-gap flex-direction flex-wrap align-items align-self justify-content').split(' ')
      .concat(['top', 'right', 'bottom', 'left'].flatMap(side => ['width', 'style', 'color'].map(kind => `border-${side}-${kind}`)));
    const safe = value => value && !/[<>]|url\s*\(|var\s*\(|attr\s*\(|expression\s*\(|javascript:/i.test(value);
    const copies = new Map(sourceElements.map((element, index) => [element, cloneElements[index]]));
    const components = new Set();
    for (const element of sourceElements) {
      if ((!components.has(element.parentElement) && !/^(card|box|row)$/.test(element.getAttribute('data-d-component') || '')) || element.closest('pre, code')) continue;
      components.add(element);
    }
    for (const element of components) {
      const target = copies.get(element);
      if (!target) continue;
      const computed = getComputedStyle(element);
      target.removeAttribute('style');
      if (computed.display === 'none' || ['hidden', 'collapse'].includes(computed.visibility)) {
        target.setAttribute('data-export-hidden', ''); target.style.display = 'none'; continue;
      }
      for (const property of [...properties, 'flex-grow', 'flex-shrink', 'flex-basis']) {
        const value = computed.getPropertyValue(property);
        if (safe(value)) target.style.setProperty(property, value);
      }
      if (['flex', 'inline-flex', 'block', 'inline', 'inline-block'].includes(computed.display)) target.style.display = computed.display;
      target.classList.add('chat-archive-component');
      target.style.boxSizing = 'border-box';
      target.style.minWidth = '0';
      target.style.maxWidth = '100%';
      // Keep authored percentages responsive. Computed pixels would distort a
      // chart when its export is narrower than the original conversation.
      const width = element.style.width.trim();
      if (/^(?:\d+(?:\.\d+)?|\.\d+)%$/.test(width) && parseFloat(width) <= 100) target.style.width = width;
      else if (width || element.hasAttribute('data-d-has-width')) {
        const pixels = parseFloat(computed.width);
        if (/px$/.test(computed.width) && pixels >= 0 && pixels <= 1600) target.style.width = computed.width;
      }
      // Explicit, empty colored boxes are chart tracks/fills. Keep their height
      // without constraining text containers or copying overflow/position rules.
      if (!element.textContent.trim() && !element.querySelector('img,svg,canvas,video,iframe') &&
          (element.style.height || element.hasAttribute('data-d-has-height'))) {
        const pixels = parseFloat(computed.height);
        if (/px$/.test(computed.height) && pixels > 0 && pixels <= 600) target.style.height = computed.height;
      }
      // DIL separators paint only their 1px content box; their padding is
      // whitespace. Copying the background alone turns that padding into a bar.
      if (element.getAttribute('data-d-component') === 'divider' && !element.children.length && !element.textContent.trim()) {
        const pixels = parseFloat(computed.height);
        if (/px$/.test(computed.height) && pixels > 0 && pixels <= 16) {
          target.style.height = computed.height;
          target.style.boxSizing = computed.boxSizing === 'content-box' ? 'content-box' : 'border-box';
          if (['content-box', 'padding-box', 'border-box'].includes(computed.backgroundClip)) target.style.backgroundClip = computed.backgroundClip;
        }
      }
      if (!components.has(element.parentElement)) {
        for (let parent = element; parent; parent = parent.parentElement) {
          const background = getComputedStyle(parent).backgroundColor;
          if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)' && safe(background)) {
            target.style.backgroundColor = background; break;
          }
        }
      }
    }
    for (const row of sourceElements) {
      if (row.children.length !== 2 || row.closest('pre, code, [class~="group/generated-image-gallery-controls"]')) continue;
      const style = getComputedStyle(row);
      if (!['flex', 'inline-flex', 'grid', 'inline-grid'].includes(style.display) ||
          (style.display.includes('flex') && style.flexDirection && style.flexDirection !== 'row')) continue;
      const children = [...row.children];
      const imageIndex = children.findIndex(child => !child.textContent.trim() && (child.matches('img') || child.querySelector('img')));
      if (imageIndex < 0 || !children[1 - imageIndex].textContent.trim()) continue;
      const img = children[imageIndex].matches('img') ? children[imageIndex] : children[imageIndex].querySelector('img');
      const imageStyle = getComputedStyle(img);
      const width = img.getBoundingClientRect().width || parseFloat(imageStyle.width) || Number(img.getAttribute('width'));
      if (!(width > 48 && width <= 240)) continue;
      const copy = copies.get(row);
      if (!copy) continue;
      const group = row.parentElement, groupStyle = group && getComputedStyle(group);
      const groupElements = groupStyle?.display === 'flex' && groupStyle.flexDirection === 'column'
        ? [group, ...[...group.children].filter(child => child.tagName === 'HR')] : [];
      for (const element of [...groupElements, row, ...row.querySelectorAll('*')]) {
        const target = copies.get(element);
        if (!target) continue;
        const computed = getComputedStyle(element);
        target.removeAttribute('style');
        // Media capture still pairs originals and clones by position. Defer
        // removals until that pairing is complete, including hidden SVG icons.
        if (computed.display === 'none' || ['hidden', 'collapse'].includes(computed.visibility)) {
          target.setAttribute('data-export-hidden', ''); target.style.display = 'none'; continue;
        }
        for (const property of properties) {
          const value = computed.getPropertyValue(property);
          if (safe(value)) target.style.setProperty(property, value);
        }
        if (['flex', 'inline-flex', 'block', 'inline', 'inline-block'].includes(computed.display)) target.style.display = computed.display;
      }
      copy.classList.add('chat-archive-card');
      if (imageIndex === 1) copy.classList.add('chat-archive-card-image-right');
      copy.style.removeProperty('display');
      if (!style.columnGap || style.columnGap === 'normal') copy.style.columnGap = '12px';
      copy.style.setProperty('--export-card-width', `${width}px`);
      if (safe(imageStyle.borderRadius)) copy.style.setProperty('--export-card-radius', imageStyle.borderRadius);
      const height = img.getBoundingClientRect().height || parseFloat(imageStyle.height) || Number(img.getAttribute('height'));
      if (height > 0) copy.style.setProperty('--export-card-ratio', `${width} / ${height}`);
      if (['contain', 'cover', 'fill', 'none', 'scale-down'].includes(imageStyle.objectFit)) copy.style.setProperty('--export-card-fit', imageStyle.objectFit);
      // Preserve contrast even when the live page uses a dark theme.
      for (let parent = row; parent; parent = parent.parentElement) {
        const background = getComputedStyle(parent).backgroundColor;
        if (background && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)' && safe(background)) {
          copy.style.backgroundColor = background; break;
        }
      }
    }
  }

  function cleanClone(node, includeLinks, includeMedia = true, mediaOwner, preserveLayout = false) {
    const source = contentRoot(node);
    if (source.textContent.length > maxPayloadCharacters) throw new Error('This export exceeds the text memory limit. Export fewer selected messages. No partial file was saved.');
    const clone = source.cloneNode(true);
    const sourceElements = [...source.querySelectorAll('*')];
    const cloneElements = [...clone.querySelectorAll('*')];
    if (preserveLayout) preserveCardLayouts([source, ...sourceElements], [clone, ...cloneElements]);
    window.ChatArchiveMedia?.preserve(source, clone, { owner: mediaOwner, excludedRoots: mediaExclusions(source), includeImages: includeMedia });
    clone.querySelectorAll('[data-export-hidden]').forEach(element => element.remove());
    // ChatGPT table edge overlays have inline measured dimensions, but their
    // absolute positioning lives in a site stylesheet. Without that stylesheet
    // an empty overlay becomes a full table-height blank block in the export.
    // Match only known direct table decorations: empty chart boxes are content.
    clone.querySelectorAll('[data-d-component="table"]').forEach(frame => {
      if (!frame.querySelector(':scope > [data-d-table-viewport] > table')) return;
      [...frame.children].forEach(element => {
        if ([...element.classList].some(name => name.startsWith('Edges-')) && !element.textContent.trim() &&
            !element.querySelector('table,img,picture,svg,canvas,video,audio,iframe,object,embed')) element.remove();
      });
    });

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

    clone.querySelectorAll('.chat-archive-card button, .chat-archive-component button').forEach(button => {
      if (!button.textContent.trim()) return;
      const label = document.createElement('span');
      label.className = button.className;
      label.style.cssText = button.style.cssText;
      label.append(...button.childNodes); button.replaceWith(label);
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
    if (!includeMedia) {
      clone.querySelectorAll('img:not([data-export-icon]), picture, svg, canvas, figure[data-export-media]').forEach(element => element.remove());
      clone.querySelectorAll('.chat-archive-card').forEach(card => {
        [...card.children].filter(child => !child.textContent.trim()).forEach(child => child.remove());
        card.style.gridTemplateColumns = 'minmax(0, 1fr)';
      });
    }
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
    sourceIdOf,
    sourceIdentityOf,
    roleOf,
    contentRoot,
    mediaExclusions,
    payloadSize,
    maxPayloadCharacters,
    metadata() { return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString() }; },
    snapshot({ includeLinks = true, includeTimestamps = false, includeActivity = false, selectedOnly = false, outputFormat = null, includeUserImages = true, includeAssistantImages = true, includeSourceIds = false, sourceMessageIds = null } = {}) {
      const nodes = messageNodes();
      const activities = !isGemini && includeActivity ? activitiesByMessage(nodes, includeLinks) : new Map();
      const identifiers = new Set();
      let characters = 0;
      return nodes.map((node, index) => {
        // In a hybrid export only these exact messages come from the page.
        // API-only neighbours need no page key and must not enter media capture.
        if (sourceMessageIds && !sourceMessageIds.includes(sourceIdOf(node))) return null;
        const id = idOf(node, index);
        if (identifiers.has(id)) throw new Error('A message identifier is shared by multiple messages. This interface is ambiguous; export was stopped to avoid losing content.');
        identifiers.add(id);
        if (selectedOnly && node.dataset.chatArchiveSelected !== 'true') return null;
        const messageRole = roleOf(node, index);
        const keepImages = !['html', 'pdf'].includes(outputFormat) || (messageRole === 'user' ? includeUserImages : includeAssistantImages);
        const clone = cleanClone(node, includeLinks, keepImages, id, ['html', 'pdf'].includes(outputFormat));
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
        if (includeSourceIds) item.sourceMessageId = sourceIdOf(node);
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
    collect(options = {}) {
      const messages = this.snapshot(options);
      return { title: title(), provider: provider(), url: location.href, exportedAt: new Date().toISOString(), messages };
    }
  };
})();
