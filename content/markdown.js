(function () {
  if (globalThis.ChatArchiveMarkdown) return;
  const parser = globalThis.markdownit({ html: false, linkify: false, typographer: false, breaks: false, maxNesting: 64 });
  const escape = parser.utils.escapeHtml;
  // Only our generated slots can bypass Markdown escaping. Conversation text
  // and evaluated values can never create a slot: the delimiter is rejected.
  const slotPattern = /^<\u0001CAE(\d+)\u0002>/;
  parser.inline.ruler.before('text', 'archive_slot', (state, silent) => {
    const match = state.src.slice(state.pos).match(slotPattern);
    if (!match || !state.env.slots || !Object.hasOwn(state.env.slots, match[1])) return false;
    if (!silent) { const token = state.push('archive_slot', '', 0); token.content = state.env.slots[match[1]]; }
    state.pos += match[0].length; return true;
  });
  parser.renderer.rules.archive_slot = (tokens, index) => tokens[index].content;
  parser.block.ruler.before('code', 'archive_slot_block', (state, start, end, silent) => {
    const from = state.bMarks[start] + state.tShift[start];
    const line = state.src.slice(from, state.eMarks[start]).trim();
    const match = line.match(slotPattern);
    if (!match || match[0] !== line || !state.env.slots || !Object.hasOwn(state.env.slots, match[1])) return false;
    if (!silent) { const token = state.push('archive_slot', '', 0); token.block = true; token.content = state.env.slots[match[1]]; state.line = start + 1; }
    return true;
  });
  function referenceIds(object) {
    const refs = Array.isArray(object?.refs) ? object.refs : [];
    return refs.map(ref => typeof ref === 'string' ? ref : Number.isInteger(ref?.turn_index) && Number.isInteger(ref?.ref_index)
      && /^(search|view|news|image|file)$/.test(ref.ref_type || ref.type || 'search')
      ? `turn${ref.turn_index}${ref.ref_type || ref.type || 'search'}${ref.ref_index}` : null).filter(Boolean);
  }
  function referenceImageUrl(image, allowUrl = false, absoluteOnly = false) {
    const urls = [image.content_url, image.original_content_url, image.thumbnail_url, image.image_url,
      ...(allowUrl ? [image.url] : [])].filter(value => typeof value === 'string' && value.trim() && (!absoluteOnly || /^https?:\/\//i.test(value)));
    // The saved result can name both an original third-party image and the
    // OpenAI preview used by ChatGPT. Prefer that exact saved preview: the
    // original host may prohibit page fetches even while the preview works.
    // Never construct a proxy URL or use a source-page URL from image_group.
    return urls.find(value => {
      try {
        const url = new URL(value);
        return url.origin === 'https://images.openai.com' && !url.username && !url.password &&
          /^\/(?:static-rsc-\d+\/|thumbnails\/)/.test(url.pathname);
      } catch (_) { return false; }
    }) || urls[0];
  }
  // Describe only image-reference structure when resolution fails. Never emit
  // queries, titles, URLs, IDs, arbitrary field names or unrelated metadata.
  function imageReferenceDiagnostic(env, query) {
    const fields = new Set('type images image image_result image_results image_search_results image_search_query query queries prompt_text alt title url href content_url original_content_url thumbnail_url image_url asset_pointer file_id result results items refs matched_text safe_urls async_image async_images image_references search_results model_dil_v2 code constants appData opGenui componentResults state is_loading'.split(' '));
    const types = new Set('image images image_v2 image_group image_gen async_image image_search webpage webpages grouped_webpages entity file dil'.split(' '));
    let remaining = 160, truncated = false;
    const describe = (value, depth = 0, key = '') => {
      if (remaining-- <= 0) { truncated = true; return { type: 'omitted' }; }
      if (value === null) return { type: 'null' };
      if (Array.isArray(value)) {
        const sample = value.slice(0, 4), limited = depth >= 5;
        if (limited || value.length > sample.length) truncated = true;
        const items = [];
        if (!limited) for (const item of sample) {
          if (remaining <= 0) { truncated = true; break; }
          items.push(describe(item, depth + 1));
        }
        return { type: 'array', length: value.length, ...(limited ? {} : { items }) };
      }
      if (typeof value === 'object') {
        const keys = Object.keys(value), known = keys.filter(name => fields.has(name));
        if (depth >= 5) { truncated = true; return { type: 'object', fieldCount: keys.length }; }
        const descriptions = {};
        for (const name of known) {
          if (remaining <= 0) { truncated = true; break; }
          descriptions[name] = describe(value[name], depth + 1, name);
        }
        return { type: 'object', otherFields: keys.length - known.length, fields: descriptions };
      }
      if (typeof value !== 'string') return { type: ['number', 'boolean', 'undefined'].includes(typeof value) ? typeof value : 'other' };
      const result = { type: 'string' };
      if (key === 'type') result.category = types.has(value) ? value : 'other';
      if (['query', 'image_search_query', 'prompt_text', 'title', 'alt'].includes(key)) {
        result.matchesQuery = value === query;
        result.matchesTrimmedQuery = typeof query === 'string' && value.trim() === query.trim();
      }
      if (['url', 'href', 'content_url', 'original_content_url', 'thumbnail_url', 'image_url', 'asset_pointer'].includes(key)) {
        result.referenceKind = /^https?:\/\//i.test(value) ? 'http' : /^(file-service|sediment):\/\//.test(value) ? 'file' : value.startsWith('data:image/') ? 'data-image' : 'other';
      }
      return result;
    };
    const references = describe(env.references);
    const metadata = Object.fromEntries(Object.entries(env.metadata || {}).filter(([name]) => fields.has(name)));
    return { version: 1, references, metadata: describe(metadata), truncated };
  }
  function componentReference(name, attrs, env) {
    const failure = code => {
      const error = new window.ChatArchiveComponents.Unsupported(code);
      if (name === 'AsyncImage' && ['IMAGE_REFERENCE_NOT_FOUND', 'IMAGE_REFERENCE_AMBIGUOUS'].includes(code)) {
        error.imageReferenceDiagnostic = imageReferenceDiagnostic(env, attrs.query);
      }
      throw error;
    };
    const references = env.references || [], safeUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
    if (name === 'Entity') {
      if (typeof attrs.value !== 'string') failure('ENTITY_VALUE_INVALID');
      const ref = references.find(ref => ref.type === 'entity' && (ref.name || ref.entity_data?.name) === attrs.value);
      const url = safeUrl(ref?.url || ref?.entity_data?.website_url);
      return url && env.includeLinks ? `<a href="${escape(url)}" rel="noopener noreferrer">${escape(attrs.value)}</a>` : escape(attrs.value);
    }
    if (name === 'Cite') {
      if (!env.includeLinks) return '';
      // Saved answers use both a single ref="..." and refs={...}.
      // Keep an explicitly supplied refs value authoritative, including errors.
      const refs = Object.hasOwn(attrs, 'refs') ? attrs.refs : attrs.ref;
      const ids = Array.isArray(refs) ? refs : [refs];
      if (!ids.length || ids.length > 64 || ids.some(id => typeof id !== 'string')) failure('CITATION_REFS_INVALID');
      const urls = new Map(); let missing = false;
      for (const id of ids) {
        let found = false;
        for (const ref of references) {
          if (!['webpage', 'webpages', 'grouped_webpages'].includes(ref.type)) continue;
          const groupMatch = referenceIds(ref).includes(id) || String(ref.matched_text || '').match(/turn\d+(?:search|view|news)\d+/g)?.includes(id);
          const items = [...(ref.items || []), ...(ref.fallback_items || [])];
          for (const item of items) {
            const itemIds = referenceIds(item), url = safeUrl(item.url || item.href);
            if (!url || !(itemIds.includes(id) || (!itemIds.length && groupMatch))) continue;
            found = true; urls.set(url, item.title || item.name || item.attribution || url);
          }
          if (!items.length && groupMatch) for (const url of ref.safe_urls || []) if (safeUrl(url)) { found = true; urls.set(url, url); }
        }
        if (!found) missing = true;
      }
      if (missing) env.unavailableCitations++;
      const links = [...urls].map(([url, label]) => `<a href="${escape(url)}" rel="noopener noreferrer">${escape(label)}</a>`);
      if (missing) links.push('<span class="export-unavailable-reference">Source link unavailable</span>');
      return `<span class="export-citations"> (${links.join('; ')})</span>`;
    }
    if (!env.includeImages) return '';
    let url = safeUrl(attrs.src || attrs.url);
    if (!url) {
      if (typeof attrs.query !== 'string') failure('IMAGE_QUERY_MISSING');
      const matches = new Set();
      for (const ref of references) {
        if (!['image', 'images', 'image_v2', 'image_group'].includes(ref.type) || !Array.isArray(ref.images)) continue;
        for (const entry of ref.images) {
          const image = ref.type === 'image_group' ? entry?.image_result ?? entry : entry;
          if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
          const exact = entry.image_search_query === attrs.query || image.query === attrs.query || image.title === attrs.query || (ref.images.length === 1 && (ref.query === attrs.query || ref.prompt_text === attrs.query || ref.alt === attrs.query));
          // In a grouped result, `url` can be the source page, not image bytes.
          const candidate = safeUrl(referenceImageUrl(image, ref.type !== 'image_group', true));
          if (exact && candidate) matches.add(candidate);
        }
      }
      // Newer saved answers put search-image results in DIL appData, either on
      // message metadata or on its `dil` reference. safe_urls alone cannot tell
      // an image from its source page or associate it with a particular card.
      if (!env.dilImages) {
        env.dilImages = new Map();
        const bundles = new Set([env.metadata?.model_dil_v2,
          ...references.filter(ref => ref?.type === 'dil').map(ref => ref.model_dil_v2)].filter(Boolean));
        if (bundles.size <= 64) for (const bundle of bundles) {
          const results = bundle.appData?.opGenui?.componentResults;
          if (!results || typeof results !== 'object' || Array.isArray(results)) continue;
          for (const binding of window.ChatArchiveComponents.imageBindings(bundle)) {
            if (!env.dilImages.has(binding.query)) env.dilImages.set(binding.query, new Set());
            const candidates = env.dilImages.get(binding.query);
            let id = binding.id;
            if (!Object.hasOwn(results, id) && id.startsWith('[')) {
              try { const ids = JSON.parse(id); if (Array.isArray(ids) && ids.length === 1 && typeof ids[0] === 'string') id = ids[0]; } catch (_) {}
            }
            const result = Object.hasOwn(results, id) ? results[id] : null;
            const images = result?.state?.images;
            if (result?.componentName !== 'AsyncImage' || result.state?.is_loading !== false ||
                (result.status && result.status !== 'resolved') || !Array.isArray(images) || images.length !== 1) { candidates.add(null); continue; }
            const candidate = images[0] && safeUrl(referenceImageUrl(images[0], false, true));
            candidates.add(candidate || null);
          }
        }
      }
      for (const candidate of env.dilImages.get(attrs.query) || []) matches.add(candidate);
      if (matches.has(null)) failure('IMAGE_REFERENCE_NOT_FOUND');
      if (matches.size !== 1) failure(matches.size ? 'IMAGE_REFERENCE_AMBIGUOUS' : 'IMAGE_REFERENCE_NOT_FOUND'); url = [...matches][0];
    }
    const alt = typeof attrs.alt === 'string' ? attrs.alt : 'Image';
    const placeholder = `<span class="export-image-placeholder" data-export-image="${env.images.length}">${escape(alt)}</span>`;
    env.images.push({ source: { url }, alt, placeholder });
    let style = 'min-width:0;max-width:100%;margin:0';
    if (typeof attrs.maxWidth === 'string' && /^\d{1,4}px$/.test(attrs.maxWidth)) style += `;width:${attrs.maxWidth}`;
    return `<figure class="export-api-figure" style="${style}">${placeholder}</figure>`;
  }
  function renderComponent(node, env) {
    const components = window.ChatArchiveComponents;
    const slotStart = env.slots.length, charactersStart = env.slotCharacters;
    const context = {
      includeImages: env.includeImages,
      svg(source) {
        const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
        const placeholder = `<span class="export-image-placeholder" data-export-image="${env.images.length}">Diagram</span>`;
        env.images.push({ source: { url }, alt: 'Diagram', placeholder });
        return `<figure class="export-api-figure" style="min-width:0;max-width:100%;margin:0">${placeholder}</figure>`;
      },
      reference: (name, attrs) => componentReference(name, attrs, env),
      sequence(nodes, scope, limits, inlineOnly = false) {
        scope = Object.assign(Object.create(null), scope);
        let source = '';
        for (const node of nodes) {
          if (node.type === 'text') {
            limits.textCharacters = (limits.textCharacters || 0) + node.value.length;
            if (limits.textCharacters > 16 * 1024 * 1024) throw new Error('This card exceeds the static rendering limit. No file was saved.');
            // Dedent layout-source indentation; relative Markdown list/code
            // indentation remains intact, and fenced examples remain literal.
            const lines = node.value.split('\n');
            const indents = lines.slice(1).filter(line => line.trim()).map(line => line.match(/^[ \t]*/)[0].length);
            const indent = indents.length ? Math.min(...indents) : 0;
            source += lines.map((line, index) => index === 0 ? line : line.slice(Math.min(indent, line.match(/^[ \t]*/)[0].length))).join('\n');
          } else {
            const rendered = components.render(node, context, scope, limits);
            if (!rendered.html) continue;
            env.slotCharacters += rendered.html.length;
            if (env.slotCharacters > 16 * 1024 * 1024) throw new Error('This card exceeds the static rendering limit. No file was saved.');
            const index = env.slots.push(rendered.html) - 1, marker = `<\u0001CAE${index}\u0002>`;
            source += rendered.inline ? marker : `\n\n${marker}\n\n`;
          }
        }
        return inlineOnly ? parser.renderInline(source.trim(), env) : parser.render(source, env);
      }
    };
    env.componentCount++;
    try { return components.render(node, context).html; }
    finally { env.slots.length = slotStart; env.slotCharacters = charactersStart; }
  }
  parser.inline.ruler.before('html_inline', 'archive_component', (state, silent) => {
    const components = window.ChatArchiveComponents;
    if (!state.env.allowComponents || !components?.starts(state.src, state.pos)) return false;
    const parsed = components.read(state.src, state.pos);
    if (!silent) { const token = state.push('archive_slot', '', 0); token.content = renderComponent(parsed.node, state.env); }
    state.pos = parsed.end; return true;
  });
  parser.block.ruler.before('fence', 'archive_component_block', (state, start, end, silent) => {
    const components = window.ChatArchiveComponents, from = state.bMarks[start] + state.tShift[start];
    if (!state.env.allowComponents || state.sCount[start] - state.blkIndent >= 4 || !components?.starts(state.src, from)) return false;
    const parsed = components.read(state.src, from);
    // The inline rule handles components followed by prose on the same line.
    const lineEnd = state.src.indexOf('\n', parsed.end);
    if (state.src.slice(parsed.end, lineEnd < 0 ? state.src.length : lineEnd).trim()) return false;
    if (!silent) {
      const token = state.push('archive_slot', '', 0); token.block = true; token.content = renderComponent(parsed.node, state.env);
      let next = start + 1; while (next < end && state.bMarks[next] < parsed.end) next++; state.line = next;
    }
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  parser.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index];
    const info = token.info.trim().split(/\s+/)[0];
    const language = /^[\w+#.-]{1,40}$/.test(info) ? info : '';
    const short = token.content.length < 1200 && token.content.split('\n').length <= 13;
    return `<div class="chat-archive-code${short ? ' chat-archive-code-short' : ''}">${language ? `<div class="chat-archive-code-label">${escape(language)}</div>` : ''}<pre><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(token.content)}</code></pre></div>\n`;
  };
  parser.renderer.rules.image = (tokens, index, options, env, self) => {
    if (!env.includeImages) return '';
    const token = tokens[index], src = token.attrGet('src') || '';
    const alt = self.renderInlineAsText(token.children || [], options, env);
    const source = src.startsWith('archive-asset:') ? env.assets[Number(src.slice(14))] : { url: src };
    if (!source) throw new Error('An image reference could not be resolved. No file was saved.');
    const placeholder = `<span class="export-image-placeholder" data-export-image="${env.images.length}">${escape(alt || 'Image')}</span>`;
    env.images.push({ source, alt, placeholder });
    return placeholder;
  };
  parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
    if (env.includeLinks === false) return '';
    const href = tokens[index].attrGet('href') || '';
    if (!/^(?:https?:|mailto:|#)/i.test(href)) return '<span>';
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return self.renderToken(tokens, index, options);
  };
  parser.renderer.rules.link_close = (tokens, index, options, env) => {
    if (env.includeLinks === false) return '';
    // Links cannot nest in CommonMark; find the matching opening token.
    let opening = index - 1;
    while (opening >= 0 && tokens[opening].type !== 'link_open') opening--;
    const href = tokens[opening]?.attrGet('href') || '';
    return /^(?:https?:|mailto:|#)/i.test(href) ? '</a>' : '</span>';
  };
  window.ChatArchiveMarkdown = {
    referenceImageUrl,
    render(source, { assets = [], includeLinks = true, includeImages = true, allowComponents = false, references = [], metadata = {} } = {}) {
      if (/[\u0001\u0002]/.test(source)) throw new Error('The message contains unsupported control characters. No file was saved.');
      const env = { assets, images: [], slots: [], slotCharacters: 0, includeLinks, includeImages, allowComponents, references, metadata, componentCount: 0, unavailableCitations: 0 };
      const html = parser.render(source, env);
      return { html, images: env.images, componentCount: env.componentCount, unavailableCitations: env.unavailableCitations };
    }
  };
})();
