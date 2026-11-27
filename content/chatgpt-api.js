(function () {
  if (globalThis.ChatArchiveApi) return;
  // A separate, on-demand reader for saved ChatGPT conversations. No page-world
  // injection, persistent token storage or intercepted requests.
  const maxResponseBytes = 32 * 1024 * 1024;
  const maxOutputCharacters = 16 * 1024 * 1024;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  class PageFallback extends Error {}
  const fallback = (message, sourceDiagnostic, renderedLayout = false) => {
    const error = new PageFallback(message);
    if (sourceDiagnostic) error.sourceDiagnostic = sourceDiagnostic;
    error.renderedLayout = renderedLayout;
    throw error;
  };

  // Fixed categories and dimensions only. Never include prompts, tool text,
  // message/file IDs, URLs, arbitrary metadata values or image bytes.
  function imageStructure(path) {
    const images = [];
    let imageParts = 0;
    for (const node of path) {
      const message = node.message;
      for (const part of Array.isArray(message?.content?.parts) ? message.content.parts : []) {
        if (part?.content_type !== 'image_asset_pointer') continue;
        imageParts++;
        if (images.length >= 12) continue;
        const tool = message.author?.name;
        const pointer = typeof part.asset_pointer === 'string' ? part.asset_pointer : '';
        images.push({
          role: ['user', 'assistant', 'tool'].includes(message.author?.role) ? message.author.role : 'other',
          tool: ['dalle', 'image_gen', 'image_gen.text2im', 'imagegen', 'python'].includes(tool) ? tool : tool ? 'other' : 'none',
          channel: ['final', 'complete', 'analysis', 'commentary'].includes(message.channel) ? message.channel : message.channel ? 'other' : 'unset',
          contentType: ['text', 'multimodal_text'].includes(message.content.content_type) ? message.content.content_type : 'other',
          hidden: message.metadata?.is_visually_hidden_from_conversation === true,
          finished: message.status === 'finished_successfully',
          pointerKind: ['sediment', 'file-service', 'sandbox'].find(kind => pointer.startsWith(`${kind}:`)) || 'other',
          width: Number.isFinite(part.width) && part.width >= 0 ? part.width : null,
          height: Number.isFinite(part.height) && part.height >= 0 ? part.height : null
        });
      }
    }
    return { version: 1, reason: 'unmapped-tool-images', imageParts, truncated: imageParts > images.length, images };
  }

  function conversationId(url) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://chatgpt.com' || parsed.searchParams.get('temporary-chat') === 'true') return null;
    return parsed.pathname.match(new RegExp(`/c/(${uuid})/?$`, 'i'))?.[1].toLowerCase() || null;
  }

  function eligible(options) {
    return location.origin === 'https://chatgpt.com' && !options.selectedOnly &&
      ['txt', 'md', 'html', 'pdf', 'json'].includes(options.outputFormat);
  }

  async function readJson(response, limit, check) {
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel();
      throw new Error('The conversation data exceeds the direct export memory limit. No file was saved.');
    }
    if (!response.headers.get('content-type')?.includes('application/json') || !response.body?.getReader) {
      await response.body?.cancel();
      fallback('Direct export returned an unsupported response.');
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, text = '';
    try {
      for (;;) {
        check();
        let chunk;
        try { chunk = await reader.read(); }
        catch (_) { fallback('The direct download was interrupted.'); }
        const { done, value } = chunk;
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw new Error('The conversation data exceeds the direct export memory limit. No file was saved.');
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      check();
      try { return JSON.parse(text); }
      catch (_) { fallback('Direct export returned invalid conversation data.'); }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  function activePath(raw, expectedId) {
    const ids = [raw?.conversation_id, raw?.id].filter(value => value != null);
    if (!ids.length) fallback('The server did not identify this conversation.');
    if (ids.some(id => typeof id !== 'string' || id.toLowerCase() !== expectedId)) {
      throw new Error('The server returned a different conversation. Export stopped; no file was saved.');
    }
    const mapping = raw.mapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || typeof raw.current_node !== 'string') {
      fallback('The current conversation branch is unavailable.');
    }
    const path = [], seen = new Set();
    let id = raw.current_node;
    while (id !== null) {
      if (typeof id !== 'string' || seen.has(id) || !Object.hasOwn(mapping, id)) fallback('The conversation branch is incomplete.');
      seen.add(id);
      const node = mapping[id];
      if (!node || node.id !== id || !Object.hasOwn(node, 'parent')) fallback('The conversation branch is incomplete.');
      path.push(node);
      id = node.parent;
    }
    // Never recover a broken branch by concatenating every node in the mapping.
    return path.reverse();
  }

  // Transform prose only. Code fences (including longer/tilde fences), indented
  // code and inline code retain their exact contents, even when links are off.
  function mapProse(source, transform, plain = false) {
    let fence = null;
    return source.split(/(?<=\n)/).map(line => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)(?:\r?\n)?$/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
          fence = null;
          return plain ? '' : line;
        }
        return line;
      }
      if (marker && !(marker[1][0] === '`' && marker[2].includes('`'))) {
        fence = marker[1];
        return plain ? '' : line;
      }
      if (/^( {4}|\t)/.test(line)) return line;
      let result = '', offset = 0;
      const runs = /`+/g;
      let opening;
      while ((opening = runs.exec(line))) {
        const closingRuns = /`+/g;
        closingRuns.lastIndex = runs.lastIndex;
        let closing;
        while ((closing = closingRuns.exec(line)) && closing[0].length !== opening[0].length) {}
        if (!closing) continue;
        result += transform(line.slice(offset, opening.index));
        result += plain ? line.slice(opening.index + opening[0].length, closing.index)
          : line.slice(opening.index, closingRuns.lastIndex);
        offset = closingRuns.lastIndex;
        runs.lastIndex = offset;
      }
      return result + transform(line.slice(offset));
    }).join('');
  }

  const labelText = value => String(value || '').replace(/[\[\]\\\r\n]/g, ' ');
  const imageReferenceTypes = ['image', 'images', 'image_v2', 'image_group'];
  // Only fixed categories, field presence and counts leave the parser. Never
  // copy marker payloads, unknown type names, labels, URLs or reference IDs.
  function referenceStructure(message, options, token, hasLayout = false) {
    const category = (value, allowed) => allowed.includes(value) ? value : value == null ? 'unset' : 'other';
    const refs = Array.isArray(message.metadata?.content_references) ? message.metadata.content_references : [];
    const matching = refs.filter(ref => ref?.matched_text === token);
    const fields = ['type', 'matched_text', 'items', 'fallback_items', 'safe_urls', 'images', 'url', 'href', 'name', 'alt', 'entity_data', 'image_url', 'content_url', 'original_content_url', 'thumbnail_url', 'asset_pointer', 'file_id', 'title', 'citation_format', 'image_result', 'image_search_query'];
    const present = value => value && typeof value === 'object' ? fields.filter(key => Object.hasOwn(value, key)) : [];
    const describe = ref => ({
      type: category(ref?.type, ['webpage', 'webpages', 'grouped_webpages', 'entity', 'file', 'image', 'images', 'image_v2', 'image_gen', 'image_group', 'citation', 'code', 'video', 'navlist', 'filenavlist', 'finance', 'weather', 'sports', 'product', 'products']),
      matches: ref?.matched_text === token,
      fields: present(ref),
      items: Array.isArray(ref?.items) ? ref.items.length : 0,
      fallbackItems: Array.isArray(ref?.fallback_items) ? ref.fallback_items.length : 0,
      images: Array.isArray(ref?.images) ? ref.images.length : 0,
      firstItemFields: present(ref?.items?.[0]),
      firstImageFields: present(ref?.images?.[0]),
      firstImageResultFields: present(ref?.images?.[0]?.image_result)
    });
    const sample = [...matching.slice(0, 6), ...refs.filter(ref => ref?.matched_text !== token).slice(0, 6)].slice(0, 8);
    const marker = typeof token === 'string' ? token.slice(1, -1).split('\uE202') : [];
    return {
      version: 2, reason: 'unsupported-rich-reference',
      context: category(message.author?.role, ['user', 'assistant', 'activity', 'tool']),
      format: category(options.outputFormat, ['txt', 'md', 'html', 'pdf', 'json']),
      marker: category(marker[0], ['cite', 'url', 'image', 'image_group', 'image_gen', 'entity', 'navlist', 'filenavlist', 'video', 'finance', 'weather', 'sports', 'product', 'products', 'file', 'download', 'table', 'map']),
      markerParts: marker.length, hasLayout,
      referenceCount: refs.length, matchingReferenceCount: matching.length,
      referencesTruncated: refs.length > sample.length,
      references: sample.map(describe)
    };
  }

  function referenceText(ref, markdown, includeLinks, addImage) {
    const items = [...(Array.isArray(ref.items) ? ref.items : []), ...(Array.isArray(ref.fallback_items) ? ref.fallback_items : [])];
    if (['webpage', 'webpages', 'grouped_webpages'].includes(ref.type)) {
      const links = items.length ? items : (ref.safe_urls || []).map(url => ({ url }));
      const seen = new Set();
      const rendered = links.flatMap(item => {
        const url = item.url || item.href;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) return [];
        seen.add(url);
        const label = labelText(item.title || item.name || item.attribution || url);
        return [includeLinks ? markdown ? `[${label}](<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)` : `${label} (${url})` : label];
      });
      if (rendered.length) return `(${rendered.join('; ')})`;
    }
    if (ref.type === 'entity' && (ref.name || ref.entity_data?.name)) return labelText(ref.name || ref.entity_data.name);
    if (ref.type === 'file' && (ref.name || ref.alt)) return `[File: ${labelText(ref.name || ref.alt)}]`;
    if (imageReferenceTypes.includes(ref.type)) {
      if (!addImage) return '[Image gallery; image data is not included in this text export.]';
      if (!Array.isArray(ref.images) || !ref.images.length) fallback('This image gallery needs collection from the page.');
      return ref.images.map(entry => {
        // image_group wraps each search result; the exact matched marker binds
        // the gallery to this message. Queries and safe_urls are not images.
        const image = ref.type === 'image_group' ? entry?.image_result ?? entry : entry;
        if (!image || typeof image !== 'object' || Array.isArray(image)) fallback('An image has no downloadable reference.');
        const url = window.ChatArchiveMarkdown.referenceImageUrl(image, ref.type !== 'image_group');
        return addImage({ url }, image.title || image.alt || 'Image');
      }).join('\n\n');
    }
    return null;
  }

  function messageContent(message, options, assets = [], warnings = null) {
    const rich = ['html', 'pdf'].includes(options.outputFormat);
    const imagesEnabled = (message.author?.role === 'user' ? options.includeUserImages : options.includeAssistantImages) !== false;
    const usedImages = new Set();
    const addImage = (source, alt = 'Image') => {
      if (!imagesEnabled) return '';
      if (!source.pointer && !source.url) fallback('An image has no downloadable reference.');
      usedImages.add(source.pointer || source.url);
      const index = assets.push(source) - 1;
      return `![${labelText(alt)}](archive-asset:${index})`;
    };
    const content = message.content;
    if (!content || !['text', 'multimodal_text'].includes(content.content_type) || !Array.isArray(content.parts)) {
      fallback('This message type needs collection from the page.');
    }
    const chunks = content.parts.map(part => {
      if (typeof part === 'string') return part;
      if (part?.content_type === 'image_asset_pointer') return rich ? addImage({ pointer: part.asset_pointer, url: part.url }, part.name || 'Image') : '[Image attachment; image data is not included in this text export.]';
      if (part?.content_type === 'file_asset_pointer') return `[File attachment: ${labelText(part.name || part.filename || 'file')}]`;
      fallback('This attachment type needs collection from the page.');
    });
    let source = chunks.join('\n');
    // Recognize layout notation outside literal code. The static renderer uses
    // saved values and exact references; it never executes component source.
    let hasLayout = false;
    if (rich && message.author?.role === 'assistant') mapProse(source, prose => {
      // Component names identify the rendered UI even without attributes, or
      // when a different attribute comes first. Cite is case-sensitive here:
      // lowercase <cite> is ordinary HTML that the Markdown renderer escapes.
      if (/<(?:AsyncImage|Entity|card|box|row|column|grid|grid-item|title|badge|text|caption|divider|spacer|svg)(?=[\s/>])/i.test(prose) || /<Cite(?=[\s/>])/.test(prose)) {
        hasLayout = true;
        if (!window.ChatArchiveComponents) fallback('This rich content needs collection from the page.', null, true);
      }
      return prose;
    });
    const markdown = options.outputFormat === 'md' || rich;
    const references = new Map();
    const contentReferences = message.metadata?.content_references || [];
    if (!Array.isArray(contentReferences)) fallback('This reference format needs collection from the page.');
    for (const ref of contentReferences) {
      if (typeof ref?.matched_text !== 'string' || !ref.matched_text.startsWith('\uE200')) continue;
      if (rich && !imagesEnabled && imageReferenceTypes.includes(ref.type)) { references.set(ref.matched_text, ''); continue; }
      let value;
      try { value = referenceText(ref, markdown, options.includeLinks !== false, rich ? addImage : null); }
      catch (error) {
        if (error instanceof PageFallback && !error.sourceDiagnostic) error.sourceDiagnostic = referenceStructure(message, options, ref.matched_text, hasLayout);
        throw error;
      }
      if (value !== null) references.set(ref.matched_text, value);
    }
    source = mapProse(source, prose => prose.replace(/\uE200[^\uE201]*\uE201/g, token => {
      // Some saved text uses an explicit label/URL marker. Its destination is
      // self-contained; no source-page or image-query inference is necessary.
      if (!references.has(token) && token.startsWith('\uE200url\uE202')) {
        const parts = token.slice(1, -1).split('\uE202');
        const target = parts[2];
        let url;
        try { if (parts.length === 3 && /^https?:\/\//i.test(target) && !/[\s<>\u0000-\u001f]/.test(target)) url = new URL(target); } catch (_) {}
        if (url && !url.username && !url.password) {
          const label = labelText(parts[1] || url.href);
          if (options.includeLinks === false) return label;
          return markdown ? `[${label}](<${url.href}>)` : `${label} (${url.href})`;
        }
      }
      // A citation with no saved reference has no recoverable destination.
      // Preserve the surrounding text and explicitly label the missing link,
      // as the static card renderer does. Unknown matched content still fails.
      if (!references.has(token) && token.startsWith('\uE200cite\uE202') && !contentReferences.some(ref => ref?.matched_text === token)) {
        if (warnings) warnings.unavailableCitations++;
        return '[Source link unavailable]';
      }
      if (!references.has(token)) fallback('This rich content needs collection from the page.', referenceStructure(message, options, token, hasLayout), hasLayout);
      return references.get(token);
    }));
    const attachments = message.metadata?.attachments;
    if (Array.isArray(attachments)) {
      for (const file of attachments) {
        if (rich && (/^image\//i.test(file?.mime_type || file?.type || '') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file?.name || file?.filename || ''))) {
          const imageSource = { pointer: file.asset_pointer || ((file.id || file.file_id) ? `file-service://${file.id || file.file_id}` : null), url: file.url };
          if (usedImages.has(imageSource.pointer || imageSource.url) || usedImages.has(`sediment://${file.id || file.file_id}`)) continue;
          source += '\n\n' + addImage(imageSource, file.name || file.file_name || 'Image');
          continue;
        }
        if (/^image\//i.test(file?.mime_type || '') && chunks.some(chunk => chunk.startsWith('[Image attachment;'))) continue;
        source += `\n\n[Attachment: ${labelText(file?.name || file?.file_name || file?.filename || 'file')}]`;
      }
    }
    if (rich) return source;
    return mapProse(source, prose => {
      let result = prose.replace(/!?\[([^\]\n]*)\]\((<(?:[^>\n]*)>|[^\s)]*(?:\([^)]*\)[^\s)]*)*)(?:\s+"[^"\n]*")?\)/g,
        (match, label, target) => options.includeLinks === false ? label : markdown ? match : `${label} (${target.replace(/^<|>$/g, '')})`);
      if (!markdown) result = result.replace(/^ {0,3}#{1,6} /gm, '').replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1');
      return result;
    }, !markdown);
  }

  function savedActivity(message, options, warnings) {
    if (!options.includeActivity || message.author?.role !== 'assistant' || message.metadata?.is_visually_hidden_from_conversation ||
        (message.recipient && message.recipient !== 'all')) return [];
    const content = message.content || {}, metadata = message.metadata || {};
    let entries = [];
    if (content.content_type === 'thoughts') {
      if (!Array.isArray(content.thoughts) || !content.thoughts.length) {
        entries = [{ title: 'Thinking', value: 'The saved conversation does not contain the text of this activity section.' }];
      } else entries = content.thoughts.map(thought => {
        if (!thought || (thought.content != null && typeof thought.content !== 'string') || (thought.summary != null && typeof thought.summary !== 'string')) {
          fallback('This saved activity format is not supported.');
        }
        return { title: thought.summary?.trim() || 'Thinking', value: thought.content || '' };
      });
    } else if (content.content_type === 'text' && (message.channel === 'commentary' || metadata.is_thinking_preamble_message === true)) {
      if (!Array.isArray(content.parts) || content.parts.some(part => typeof part !== 'string')) fallback('This saved activity format is not supported.');
      entries = [{ title: 'Working', value: content.parts.join('\n') }];
    }
    // Raw tool calls, analysis-channel text and reasoning_recap service records
    // are not the user-facing Working/Thinking sections.
    return entries.map(({ title, value }) => {
      const activityMessage = { author: { role: 'activity' }, content: { content_type: 'text', parts: [value] }, metadata: { content_references: metadata.content_references || [] } };
      const base = { ...options, includeAssistantImages: false };
      const markdown = messageContent(activityMessage, { ...base, outputFormat: 'md' }, [], warnings);
      const text = messageContent(activityMessage, { ...base, outputFormat: 'txt' });
      const html = window.ChatArchiveMarkdown ? window.ChatArchiveMarkdown.render(messageContent(activityMessage, { ...base, outputFormat: 'html' }),
        { includeLinks: options.includeLinks !== false, includeImages: false }).html : '';
      if (['html', 'pdf'].includes(options.outputFormat) && !window.ChatArchiveMarkdown) throw new Error('The HTML renderer is unavailable. Reload the conversation tab.');
      return { title, expanded: true, text, markdown, html };
    });
  }

  function normalize(raw, url, options, visibleIds = [], renderedMessage = null) {
    const path = activePath(raw, conversationId(url));
    const pathIds = new Set(path.map(node => node.message?.id).filter(Boolean));
    if (visibleIds.some(id => !pathIds.has(id))) fallback('The displayed branch differs from the server branch.');
    const jsonExport = options.outputFormat === 'json', rich = ['html', 'pdf', 'json'].includes(options.outputFormat);
    const contentOptions = jsonExport ? { ...options, outputFormat: 'md' } : options;
    const records = [], messages = [], seen = new Set(), assistantImages = new Map(), activityByTurn = new Map();
    const referenceWarnings = { unavailableCitations: 0 };
    let size = 0, turn = 0, componentMessages = 0, unavailableCitations = 0;
    for (const [pathIndex, node] of path.entries()) {
      const message = node.message;
      if (!message) continue;
      const role = message.author?.role, meta = message.metadata || {};
      if (role === 'user') turn++;
      const activities = savedActivity(message, options, referenceWarnings);
      if (activities.length) {
        if (message.status && message.status !== 'finished_successfully') fallback('Wait for the activity to finish before direct export.');
        if (typeof message.id !== 'string' || !message.id || seen.has(message.id)) fallback('Message identifiers in the response are ambiguous.');
        seen.add(message.id);
        if (!activityByTurn.has(turn)) activityByTurn.set(turn, { id: message.id, index: pathIndex, createTime: message.create_time, activities: [] });
        activityByTurn.get(turn).activities.push(...activities);
        size += activities.reduce((sum, activity) => sum + activity.title.length + activity.text.length + activity.markdown.length + activity.html.length, 0);
        if (size > maxOutputCharacters) throw new Error('This export exceeds the content memory limit. No partial file was saved.');
        continue;
      }
      if (['thoughts', 'reasoning_recap'].includes(message.content?.content_type)) continue;
      const generated = rich && !jsonExport && role === 'tool';
      if (generated && options.includeAssistantImages === false) continue;
      if (!['user', 'assistant'].includes(role) && !generated) continue;
      // Hidden tool records can repeat visible image outputs. Filter them before
      // deciding to fall back or budgeting any images, just like hidden answers.
      if (meta.is_visually_hidden_from_conversation || meta.is_thinking_preamble_message ||
          ['is_reasoning', 'reasoning_ended'].includes(meta.reasoning_status)) continue;
      let contentMessage = message;
      if (generated) {
        const parts = Array.isArray(message.content?.parts) ? message.content.parts.filter(part => part?.content_type === 'image_asset_pointer') : [];
        if (!parts.length || message.channel === 'analysis') continue;
        if (message.content.content_type !== 'multimodal_text' || message.status !== 'finished_successfully' ||
            (message.channel && !['commentary', 'final', 'complete'].includes(message.channel)) ||
            parts.some(part => typeof part.asset_pointer !== 'string' || !part.asset_pointer)) {
          fallback('This generated-image response needs collection from the page.', imageStructure(path));
        }
        // Only explicit image outputs are visible here. Tool prose, prompts,
        // attachments and execution metadata never become assistant prose.
        contentMessage = { content: { content_type: 'multimodal_text', parts }, metadata: {} };
      } else if ((message.channel && !['final', 'complete'].includes(message.channel)) ||
          (message.recipient && message.recipient !== 'all') ||
          (meta.disable_turn_actions === true && meta.hide_inline_actions === true)) continue;
      if (message.status && message.status !== 'finished_successfully') fallback('Wait for the response to finish before direct export.');
      if (typeof message.id !== 'string' || !message.id || seen.has(message.id)) fallback('Message identifiers in the response are ambiguous.');
      seen.add(message.id);
      const assets = [];
      let value = '', pageMessage = null, rendered = null;
      try {
        value = messageContent(contentMessage, contentOptions, assets, referenceWarnings);
        if (rich && value.trim()) {
          if (!window.ChatArchiveMarkdown) throw new Error('The HTML renderer is unavailable. Reload the conversation tab.');
          rendered = window.ChatArchiveMarkdown.render(value, { assets, includeLinks: options.includeLinks !== false,
            includeImages: !jsonExport && (role === 'user' ? options.includeUserImages : options.includeAssistantImages) !== false,
            allowComponents: role === 'assistant', references: meta.content_references || [], metadata: meta });
        }
      }
      catch (error) {
        if (rich && !jsonExport && role === 'assistant' && (error.componentUnsupported || error instanceof PageFallback && error.renderedLayout) && renderedMessage) {
          pageMessage = renderedMessage(message.id);
        }
        if (!pageMessage?.html?.trim()) {
          if (error.componentUnsupported) fallback(error.message, error.componentDiagnostic ? {
            ...error.componentDiagnostic, format: options.outputFormat
          } : null, true);
          throw error;
        }
      }
      if (!pageMessage && !value.trim()) continue;
      const item = { id: message.id, role: generated ? 'assistant' : role };
      if (pageMessage) item.html = pageMessage.html;
      else if (rich) {
        item.html = rendered.html;
        if (rendered.componentCount) componentMessages++;
        unavailableCitations += rendered.unavailableCitations || 0;
        if (rendered.images.length) item.media = rendered.images;
        if (role === 'assistant') {
          if (!assistantImages.has(turn)) assistantImages.set(turn, new Set());
          for (const image of rendered.images) if (image.source.pointer) assistantImages.get(turn).add(image.source.pointer);
        }
      } else item[options.outputFormat === 'md' ? 'markdown' : 'text'] = value;
      if (jsonExport) { item.markdown = value; item.text = messageContent(contentMessage, { ...options, outputFormat: 'txt' }); }
      size += (item.html || value).length + (jsonExport ? item.markdown.length + item.text.length : 0) + message.id.length;
      if (size > maxOutputCharacters) throw new Error('This export exceeds the content memory limit. No partial file was saved.');
      if (options.includeTimestamps && Number.isFinite(message.create_time) && message.create_time > 0) {
        const date = new Date(message.create_time * 1000);
        if (Number.isFinite(date.getTime())) { item.createdAt = date.toISOString(); item.messageId = message.id; }
      }
      records.push({ item, generated, turn, pathIndex, fromPage: !!pageMessage });
    }
    const renderedTurns = new Set(records.filter(record => record.fromPage).map(record => record.turn));
    if (records.some(record => record.generated && renderedTurns.has(record.turn))) {
      // Tool images can repeat media inside a rendered answer in the SAME
      // user turn. Images from other turns have separate, explicit API records
      // and do not prevent using an exactly identified page answer here.
      fallback('Rendered cards with generated-image messages need collection from the page.', {
        version: 1, reason: 'rendered-generated-image-mix',
        renderedAnswers: records.filter(record => record.fromPage).length,
        generatedImageMessages: records.filter(record => record.generated).length
      });
    }
    const generatedImages = new Map();
    const positions = new Map();
    for (const { item, generated, turn, pathIndex } of records) {
      if (generated) {
        if (!generatedImages.has(turn)) generatedImages.set(turn, new Set());
        const kept = generatedImages.get(turn);
        item.media = item.media.filter(image => {
          const pointer = image.source.pointer;
          // Prefer an explicit visible assistant reference within this same
          // response. Never deduplicate across user turns or user attachments.
          if (assistantImages.get(turn)?.has(pointer) || kept.has(pointer)) {
            item.html = item.html.replace(image.placeholder, '');
            return false;
          }
          kept.add(pointer);
          return true;
        });
        if (!item.media.length) continue;
      }
      if (item.role === 'assistant' && activityByTurn.has(turn)) { item.activities = activityByTurn.get(turn).activities; activityByTurn.delete(turn); }
      positions.set(item.id, pathIndex);
      messages.push(item);
    }
    for (const group of activityByTurn.values()) {
      const item = { id: group.id, role: 'assistant', activities: group.activities };
      if (rich) item.html = ''; else item[options.outputFormat === 'md' ? 'markdown' : 'text'] = '';
      if (jsonExport) { item.text = ''; item.markdown = ''; }
      if (options.includeTimestamps && Number.isFinite(group.createTime) && group.createTime > 0 && Number.isFinite(new Date(group.createTime * 1000).getTime())) {
        item.createdAt = new Date(group.createTime * 1000).toISOString(); item.messageId = group.id;
      }
      positions.set(item.id, group.index); messages.push(item);
    }
    messages.sort((a, b) => positions.get(a.id) - positions.get(b.id));
    messages.forEach((item, order) => { item.order = order; });
    if (!messages.length) fallback('No supported messages were returned by direct export.');
    return { provider: 'ChatGPT', title: typeof raw.title === 'string' ? raw.title : 'ChatGPT conversation',
      url, exportedAt: new Date().toISOString(), collectionMethod: 'chatgpt-api', componentMessages,
      unavailableCitations: unavailableCitations + referenceWarnings.unavailableCitations, messages };
  }

  async function collect(options, assertCurrent, onProgress = () => {}, onPart, readRendered) {
    const url = location.href, id = conversationId(url);
    if (!id) return { fallback: 'This chat needs collection from the page.' };
    const controller = new AbortController();
    let timedOut = false, interrupted = null, token = null, pageMessages = null, completedData = null;
    const check = () => {
      assertCurrent();
      if (location.href !== url) throw new Error('The conversation changed during export. No file was saved.');
    };
    const monitor = setInterval(() => { try { check(); } catch (error) { interrupted = error; controller.abort(); } }, 100);
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25000);
    const request = async (path, headers = {}) => {
      check();
      try { return await fetch(new URL(path, url).href, { method: 'GET', credentials: 'include',
        cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', ...headers } }); }
      catch (_) { fallback('Direct export is unavailable.'); }
    };
    try {
      onProgress(5, 'Loading conversation directly');
      const session = await request('/api/auth/session');
      if (session.ok) {
        const data = await readJson(session, 1024 * 1024, check);
        token = typeof data?.accessToken === 'string' ? data.accessToken : typeof data?.access_token === 'string' ? data.access_token : null;
      } else await session.body?.cancel();
      const response = await request(`/backend-api/conversation/${id}`, token ? { authorization: `Bearer ${token}` } : {});
      if (!response.ok) { await response.body?.cancel(); fallback(`Direct export is unavailable (HTTP ${response.status}).`); }
      const raw = await readJson(response, maxResponseBytes, check);
      check();
      const nodes = window.ChatArchiveExtractor?.nodes() || [];
      const visibleIds = nodes.map(node => window.ChatArchiveExtractor?.sourceIdOf?.(node) || node.getAttribute('data-chatgpt-selection-message-id') || node.getAttribute('data-message-id')).filter(Boolean);
      let data;
      try { data = normalize(raw, url, options, visibleIds); }
      catch (error) {
        if (error.renderedLayout) {
          // Plan with inert placeholders: ordinary messages still use the API,
          // and only rich component answers need an exact matching page node.
          // Their raw component references are not parsed as ordinary Markdown.
          try {
            const needed = [];
            const plan = normalize(raw, url, options, visibleIds, messageId => {
              needed.push(messageId); return { html: '<span></span>' };
            });
            pageMessages = plan.messages.map(({ id, role }) => ({ id, role }));
            if (error.sourceDiagnostic?.reason === 'unsupported-static-component') {
              const position = pageMessages.findIndex(message => message.id === needed[0]);
              if (position >= 0) error.sourceDiagnostic.messagePosition = position + 1;
            }
            if (readRendered) {
              clearTimeout(timeout); // Page media loading has its own deadline.
              let matchFailure = null;
              const rendered = await readRendered(pageMessages, needed, diagnostic => { matchFailure = diagnostic; });
              check();
              if (rendered) {
                data = normalize(raw, url, options, visibleIds, messageId => rendered.get(messageId));
                data.collectionMethod = 'chatgpt-api-rendered';
                data.renderedMessages = needed.length;
              } else {
                const diagnostic = matchFailure || { version: 1, reason: 'rendered-message-match-failed', code: 'RENDERED_MATCH_UNAVAILABLE',
                  expectedMessages: pageMessages.length, requiredRenderedMessages: needed.length };
                error.sourceDiagnostic = error.sourceDiagnostic ? { ...error.sourceDiagnostic, renderedMatch: diagnostic } : diagnostic;
                const explanations = {
                  RENDERED_MESSAGE_NOT_LOADED: `Message ${diagnostic.missingMessagePositions?.[0] || '?'} contains content that could not be reconstructed from saved data and is not loaded on the page. Open that answer in the chat, then retry.`,
                  RENDERED_ID_AMBIGUOUS: 'A loaded answer has conflicting message identifiers. Its card or diagram could not be safely matched.',
                  RENDERED_BRANCH_MISMATCH: 'The loaded answers changed during export. Retry after the chat finishes loading.',
                  RENDERED_ORDER_MISMATCH: 'Loaded answers are duplicated or out of order. Reload the chat, then retry.',
                  RENDERED_ROLE_MISMATCH: 'A loaded answer could not be matched to its author. Reload the chat, then retry.',
                  RENDERED_CONTENT_MISMATCH: 'A required card or diagram disappeared or contained no exportable content. Open that answer, then retry.'
                };
                error.message = explanations[diagnostic.code] || 'A card image or layout could not be reconstructed from saved data and could not be matched to loaded page content.';
              }
            }
          } catch (reason) {
            if (!(reason instanceof PageFallback)) throw reason;
            if (error.sourceDiagnostic && reason.sourceDiagnostic) error.sourceDiagnostic.renderedPlan = reason.sourceDiagnostic;
            pageMessages = null;
          }
        }
        if (!data) throw error;
      }
      if (['html', 'pdf'].includes(options.outputFormat)) {
        clearTimeout(timeout); // Media has its own bounded per-image deadline.
        const resolvePointer = async (pointer, messageId) => {
          const match = pointer.match(/^(file-service|sediment):\/\/([\w-]+)$/);
          const sandbox = pointer.match(/^sandbox:(\/mnt\/data\/[^\r\n]+)$/);
          if (!match && !sandbox) { const error = new Error('Unsupported image pointer.'); error.imageDiagnostic = { code: 'IMAGE_REFERENCE_UNSUPPORTED' }; throw error; }
          const path = sandbox
            ? `/backend-api/conversation/${id}/interpreter/download?${new URLSearchParams({ message_id: messageId, sandbox_path: sandbox[1], download_intent: 'true' })}`
            : match[1] === 'sediment' ? `/backend-api/conversation/${id}/attachment/${match[2]}/download` : `/backend-api/files/${match[2]}/download`;
          const referenceController = new AbortController();
          const abortReference = () => referenceController.abort();
          controller.signal.addEventListener('abort', abortReference, { once: true });
          if (controller.signal.aborted) abortReference();
          let referenceTimedOut = false, requestStage = 'request';
          const deadline = setTimeout(() => { referenceTimedOut = true; referenceController.abort(); }, 60000);
          try {
            check();
            const response = await fetch(new URL(path, url).href, { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
              signal: referenceController.signal, headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
            requestStage = 'headers';
            if (!response.ok) { await response.body?.cancel(); const error = new Error('Image download reference unavailable.'); error.imageDiagnostic = { code: 'IMAGE_REFERENCE_UNAVAILABLE', httpStatus: response.status }; throw error; }
            requestStage = 'metadata';
            const metadata = await readJson(response, 1024 * 1024, check);
            if (typeof metadata.download_url !== 'string') throw new Error('Image download reference missing.');
            return metadata.download_url;
          } catch (error) {
            check();
            const failure = new Error('Image download reference unavailable.');
            failure.imageDiagnostic = error.imageDiagnostic || { code: controller.signal.aborted ? 'IMAGE_ABORTED' : referenceTimedOut ? 'IMAGE_TIMEOUT' : requestStage === 'request' ? 'IMAGE_NETWORK_ERROR' : 'IMAGE_REFERENCE_UNAVAILABLE' };
            failure.imageDiagnostic.requestStage = requestStage;
            throw failure;
          } finally { clearTimeout(deadline); controller.signal.removeEventListener('abort', abortReference); referenceController.abort(); }
        };
        await window.ChatArchiveApiMedia.embed(data, { resolvePointer, signal: controller.signal, token, check, onProgress, onPart });
      }
      completedData = data;
      check();
      onProgress(96, 'Conversation loaded directly', data.multipart?.messages || data.messages.length);
      return { data };
    } catch (error) {
      try { check(); }
      catch (current) {
        if (current.exportStopped && error.partialRecoveryFailed) throw error;
        if (current.exportStopped && error.exportStopped) throw error;
        if (current.exportStopped && completedData) current.partialData = completedData;
        throw current;
      }
      if (interrupted) throw interrupted;
      if (timedOut) return { fallback: 'Direct export timed out.' };
      if (error instanceof PageFallback) return { fallback: error.message, sourceDiagnostic: error.sourceDiagnostic || null, pageMessages };
      throw error;
    } finally { token = null; clearTimeout(timeout); clearInterval(monitor); controller.abort(); }
  }

  window.ChatArchiveApi = { eligible, collect, normalize, conversationId, readJson };
})();
