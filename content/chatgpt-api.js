(function () {
  // A separate, on-demand reader for saved ChatGPT conversations. No page-world
  // injection, persistent token storage or intercepted requests.
  const maxResponseBytes = 32 * 1024 * 1024;
  const maxOutputCharacters = 16 * 1024 * 1024;
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  class PageFallback extends Error {}
  const fallback = (message, sourceDiagnostic) => {
    const error = new PageFallback(message);
    if (sourceDiagnostic) error.sourceDiagnostic = sourceDiagnostic;
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
      ['txt', 'md', 'html', 'pdf'].includes(options.outputFormat);
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
    if (['image', 'images', 'image_v2'].includes(ref.type)) {
      if (!addImage) return '[Image gallery; image data is not included in this text export.]';
      if (!Array.isArray(ref.images) || !ref.images.length) fallback('This image gallery needs collection from the page.');
      return ref.images.map(image => addImage({ url: image.content_url || image.original_content_url || image.thumbnail_url || image.image_url || image.url }, image.title || image.alt || 'Image')).join('\n\n');
    }
    return null;
  }

  function messageContent(message, options, assets = []) {
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
    const markdown = options.outputFormat === 'md' || rich;
    const references = new Map();
    const contentReferences = message.metadata?.content_references || [];
    if (!Array.isArray(contentReferences)) fallback('This reference format needs collection from the page.');
    for (const ref of contentReferences) {
      if (typeof ref?.matched_text !== 'string' || !ref.matched_text.startsWith('\uE200')) continue;
      if (rich && !imagesEnabled && ['image', 'images', 'image_v2'].includes(ref.type)) { references.set(ref.matched_text, ''); continue; }
      const value = referenceText(ref, markdown, options.includeLinks !== false, rich ? addImage : null);
      if (value !== null) references.set(ref.matched_text, value);
    }
    let source = chunks.join('\n');
    source = mapProse(source, prose => prose.replace(/\uE200[^\uE201]*\uE201/g, token => {
      if (!references.has(token)) fallback('This rich content needs collection from the page.');
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

  function normalize(raw, url, options, visibleIds = []) {
    const path = activePath(raw, conversationId(url));
    const pathIds = new Set(path.map(node => node.message?.id).filter(Boolean));
    if (visibleIds.some(id => !pathIds.has(id))) fallback('The displayed branch differs from the server branch.');
    const rich = ['html', 'pdf'].includes(options.outputFormat);
    const records = [], messages = [], seen = new Set(), assistantImages = new Map();
    let size = 0, turn = 0;
    for (const node of path) {
      const message = node.message;
      if (!message) continue;
      const role = message.author?.role, meta = message.metadata || {};
      if (role === 'user') turn++;
      const generated = rich && role === 'tool';
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
      const value = messageContent(contentMessage, options, assets);
      if (!value.trim()) continue;
      const item = { id: message.id, role: generated ? 'assistant' : role };
      if (rich) {
        if (!window.ChatArchiveMarkdown) throw new Error('The HTML renderer is unavailable. Reload the conversation tab.');
        const rendered = window.ChatArchiveMarkdown.render(value, { assets, includeLinks: options.includeLinks !== false,
          includeImages: (role === 'user' ? options.includeUserImages : options.includeAssistantImages) !== false });
        item.html = rendered.html;
        if (rendered.images.length) item.media = rendered.images;
        if (role === 'assistant') {
          if (!assistantImages.has(turn)) assistantImages.set(turn, new Set());
          for (const image of rendered.images) if (image.source.pointer) assistantImages.get(turn).add(image.source.pointer);
        }
      } else item[options.outputFormat === 'md' ? 'markdown' : 'text'] = value;
      size += (item.html || value).length + message.id.length;
      if (size > maxOutputCharacters) throw new Error('This export exceeds the content memory limit. No partial file was saved.');
      if (options.includeTimestamps && Number.isFinite(message.create_time) && message.create_time > 0) {
        const date = new Date(message.create_time * 1000);
        if (Number.isFinite(date.getTime())) { item.createdAt = date.toISOString(); item.messageId = message.id; }
      }
      records.push({ item, generated, turn });
    }
    const generatedImages = new Map();
    for (const { item, generated, turn } of records) {
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
      item.order = messages.length;
      messages.push(item);
    }
    if (!messages.length) fallback('No supported messages were returned by direct export.');
    return { provider: 'ChatGPT', title: typeof raw.title === 'string' ? raw.title : 'ChatGPT conversation',
      url, exportedAt: new Date().toISOString(), collectionMethod: 'chatgpt-api', messages };
  }

  async function collect(options, assertCurrent, onProgress = () => {}, onPart) {
    if (options.includeActivity) return { fallback: 'Including Working / Thinking requires collection from the page.' };
    const url = location.href, id = conversationId(url);
    if (!id) return { fallback: 'This chat needs collection from the page.' };
    const controller = new AbortController();
    let timedOut = false, interrupted = null, token = null;
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
      const visibleIds = nodes.map(node => node.getAttribute('data-chatgpt-selection-message-id') || node.getAttribute('data-message-id')).filter(Boolean);
      const data = normalize(raw, url, options, visibleIds);
      if (['html', 'pdf'].includes(options.outputFormat)) {
        clearTimeout(timeout); // Media has its own bounded per-image deadline.
        const resolvePointer = async (pointer, messageId) => {
          const match = pointer.match(/^(file-service|sediment):\/\/([\w-]+)$/);
          const sandbox = pointer.match(/^sandbox:(\/mnt\/data\/[^\r\n]+)$/);
          if (!match && !sandbox) throw new Error('Unsupported image pointer.');
          const path = sandbox
            ? `/backend-api/conversation/${id}/interpreter/download?${new URLSearchParams({ message_id: messageId, sandbox_path: sandbox[1], download_intent: 'true' })}`
            : match[1] === 'sediment' ? `/backend-api/conversation/${id}/attachment/${match[2]}/download` : `/backend-api/files/${match[2]}/download`;
          const deadline = setTimeout(() => controller.abort(), 60000);
          try {
            const response = await request(path, token ? { authorization: `Bearer ${token}` } : {});
            if (!response.ok) { await response.body?.cancel(); throw new Error('Image download reference unavailable.'); }
            const metadata = await readJson(response, 1024 * 1024, check);
            if (typeof metadata.download_url !== 'string') throw new Error('Image download reference missing.');
            return metadata.download_url;
          } finally { clearTimeout(deadline); }
        };
        await window.ChatArchiveApiMedia.embed(data, { resolvePointer, signal: controller.signal, token, check, onProgress, onPart, includeImageDetails: options.includeImageDetails === true });
      }
      check();
      onProgress(96, 'Conversation loaded directly', data.multipart?.messages || data.messages.length);
      return { data };
    } catch (error) {
      check();
      if (interrupted) throw interrupted;
      if (timedOut) return { fallback: 'Direct export timed out.' };
      if (error instanceof PageFallback) return { fallback: error.message, sourceDiagnostic: error.sourceDiagnostic || null };
      throw error;
    } finally { token = null; clearTimeout(timeout); clearInterval(monitor); controller.abort(); }
  }

  window.ChatArchiveApi = { eligible, collect, normalize, conversationId, readJson };
})();
