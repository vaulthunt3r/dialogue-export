(function () {
  const maxPixels = 16000000;
  const maxDataLength = 12000000;
  let imageCache = new WeakMap();
  let decodedImages = new WeakMap();
  let resources = null;
  const limits = Object.freeze({ imageCharacters: 16 * 1024 * 1024, pixels: 24 * 1024 * 1024, assets: 128 });
  function resetResources(active = false) {
    imageCache = new WeakMap(); decodedImages = new WeakMap();
    resources = active ? { entries: new Map(), characters: 0, pixels: 0 } : null;
  }
  function reserve(owner, kind, index, pixels = 0, characters = 0) {
    if (!resources) return;
    const key = `${owner}:${kind}:${index}`;
    const old = resources.entries.get(key) || { pixels: 0, characters: 0 };
    const next = { pixels: Math.max(old.pixels, pixels), characters: Math.max(old.characters, characters) };
    const nextPixels = resources.pixels - old.pixels + next.pixels;
    const nextCharacters = resources.characters - old.characters + next.characters;
    if (nextPixels > limits.pixels || nextCharacters > limits.imageCharacters || (!resources.entries.has(key) && resources.entries.size >= limits.assets)) {
      throw new Error('This export exceeds the image memory limit. Export fewer selected messages. No partial file was saved.');
    }
    resources.entries.set(key, next); resources.pixels = nextPixels; resources.characters = nextCharacters;
  }
  const raster = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
  const svgTags = new Set('svg g path rect circle ellipse line polyline polygon text tspan title desc defs marker clipPath mask linearGradient radialGradient stop pattern use'.toLowerCase().split(' '));
  const svgAttributes = new Set('id viewBox width height x y dx dy x1 x2 y1 y2 cx cy r rx ry d points transform preserveAspectRatio fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity color font-family font-size font-weight font-style text-anchor dominant-baseline clip-path clip-rule mask marker-start marker-mid marker-end markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform offset stop-color stop-opacity patternUnits patternTransform href'.toLowerCase().split(' '));
  const paintStyles = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'color', 'font-size', 'font-family', 'font-weight', 'text-anchor'];
  const safeValue = value => !/[<>]|javascript:|data:|https?:|\/\//i.test(value) &&
    [...value.matchAll(/url\((.*?)\)/gi)].every(match => match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#'));

  function svgImage(source) {
    const svg = source.cloneNode(true);
    const originals = [source, ...source.querySelectorAll('*')];
    const copies = [svg, ...svg.querySelectorAll('*')];
    let omitted = false;
    copies.forEach((element, index) => {
      if (!svgTags.has(element.localName.toLowerCase())) { omitted = true; element.remove(); return; }
      for (const attribute of [...element.attributes]) {
        if (attribute.name === 'xlink:href' && attribute.value.startsWith('#')) element.setAttribute('href', attribute.value);
        if (!svgAttributes.has(attribute.name.toLowerCase()) || !safeValue(attribute.value) ||
            (attribute.name === 'href' && !attribute.value.startsWith('#'))) {
          if ((/^(?:xlink:)?href$/.test(attribute.name) && !attribute.value.startsWith('#')) || attribute.name === 'filter') omitted = true;
          element.removeAttribute(attribute.name);
        }
      }
      const style = getComputedStyle(originals[index]);
      for (const name of paintStyles) {
        const value = style.getPropertyValue(name);
        if (value && safeValue(value)) element.setAttribute(name, value);
      }
    });
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    return { data: data.length <= maxDataLength ? data : '', omitted };
  }

  function capture(source) {
    const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
    if (!width || !height || width * height > maxPixels) return '';
    const canvas = source.localName === 'canvas' ? source : document.createElement('canvas');
    try {
      if (canvas !== source) {
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(source, 0, 0);
      }
      const data = canvas.toDataURL('image/png');
      return raster.test(data) && data.length <= maxDataLength ? data : '';
    } catch (_) { return ''; } // Cross-origin pixels may be unreadable in Firefox.
    finally { if (canvas !== source) { canvas.width = 0; canvas.height = 0; } }
  }

  function normalizeGalleries(root) {
    const selector = '[class~="group/generated-image-gallery-controls"]';
    const galleries = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    for (const gallery of galleries) {
      const figures = [...gallery.querySelectorAll('figure[data-export-media]')];
      if (!figures.length) continue;
      // The live carousel fixes its viewport and slide height. Exported images
      // have their own aspect ratio and must take up their full height in flow.
      if (gallery === root) {
        root.replaceChildren(...figures);
        root.removeAttribute('style'); root.removeAttribute('class');
      } else gallery.replaceWith(...figures);
    }
  }

  function availableMedia(element) {
    if (element.closest('nav, .chat-archive-picker')) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (parent.hidden || parent.hasAttribute('inert') || parent.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return false;
    }
    return true;
  }

  function decorativeImage(element) {
    if (element.localName !== 'img') return false;
    // Explicit content containers win over icon styling: tiny attachments and
    // generated images are still content. Size or an empty alt alone proves nothing.
    if (element.closest('[data-web-image-tile], figure, picture, [class~="group/generated-image-gallery-controls"]')) return false;
    if (element.closest('[class~="group/activity-header"]') || ['presentation', 'none'].includes(element.getAttribute('role'))) return true;
    const iconStyle = [...element.classList].some(name => /^icon-(?:2xs|xs|sm)$/.test(name));
    if (iconStyle) return true;
    const bounds = element.getBoundingClientRect();
    const small = bounds.width > 0 && bounds.height > 0 && bounds.width <= 48 && bounds.height <= 48;
    // Both endpoints are observed in supplied DOM / Firefox network evidence.
    // A favicon service's explicit small requested size identifies an icon even
    // before loading and without an anchor/button (citation pills can be spans).
    try {
      const url = new URL(element.currentSrc || element.getAttribute('src') || '', location.href);
      const google = ['google.com', 'www.google.com'].includes(url.hostname) && url.pathname === '/s2/favicons';
      const gstatic = /^t[0-3]\.gstatic\.com$/.test(url.hostname) && url.pathname === '/faviconV2';
      if (!google && !gstatic) return false;
      const size = Number(url.searchParams.get(google ? 'sz' : 'size'));
      return small || (size > 0 && size <= 48);
    } catch (_) {}
    return false;
  }

  function imageError(message, img, phase) {
    const error = new Error(message);
    let sourceKind = 'empty', faviconPath = false;
    try {
      const src = img?.currentSrc || img?.getAttribute('src') || '';
      if (src) {
        const url = new URL(src, location.href);
        sourceKind = ['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) ? url.protocol.slice(0, -1) : 'other';
        faviconPath = /favicon/i.test(url.pathname);
      }
    } catch (_) { sourceKind = 'invalid'; }
    const ancestors = [];
    const tags = new Set(['img', 'div', 'span', 'a', 'button', 'picture', 'figure', 'p', 'article', 'section', 'main']);
    for (let el = img; el && ancestors.length < 10; el = el.parentElement) {
      ancestors.push({ tag: tags.has(el.localName) ? el.localName : 'other',
        imageTile: el.hasAttribute('data-web-image-tile'), activityHeader: el.classList.contains('group/activity-header'),
        presentation: ['presentation', 'none'].includes(el.getAttribute('role')),
        iconClass: [...el.classList].some(name => /^icon-(?:2xs|xs|sm)$/.test(name)) });
    }
    const rect = img?.getBoundingClientRect();
    // Store values now, not the DOM node: collection restores the original scroll
    // position on failure and can immediately unmount the offending image.
    error.mediaDiagnostic = { version: 1, phase, sourceKind, faviconPath, complete: img?.complete ?? null,
      naturalSize: img ? [img.naturalWidth, img.naturalHeight] : null,
      renderedSize: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
      hasSrcset: !!img?.hasAttribute('srcset'), hasAlt: !!img?.hasAttribute('alt'),
      emptyAlt: img?.getAttribute('alt') === '', ancestors };
    return error;
  }

  function exportableMedia(element, excludedRoots = []) {
    return !excludedRoots.some(root => root.contains(element)) && !decorativeImage(element) && availableMedia(element);
  }

  async function waitForImages(getRoots, { timeoutMs = 60000, onProgress = () => {} } = {}) {
    const deadline = Date.now() + timeoutMs;
    const lazy = new Map();
    const pendingDecodes = new Set();
    let lastProgress = '';
    try {
      for (;;) {
        // Re-read the mounted window: the site's virtualizer can replace nodes
        // while an image is loading. The caller also checks conversation identity.
        const entries = getRoots().map((entry, index) => entry.node ? entry : { node: entry, owner: `root-${index}` });
        const roots = entries.map(entry => entry.node);
        for (const [img, original] of lazy) {
          if (!roots.some(root => root.contains(img))) {
            if (img.getAttribute('loading') === 'eager') img.setAttribute('loading', original);
            lazy.delete(img);
          }
        }
        const images = [...new Set(entries.flatMap(({ node, owner, excludedRoots }) => [...node.querySelectorAll('img')].flatMap((img, index) => {
          if (!exportableMedia(img, excludedRoots)) return [];
          reserve(owner, 'img', index, img.naturalWidth * img.naturalHeight);
          return [img];
        })))];
        const emptyTiles = [...new Set(entries.flatMap(({ node, excludedRoots }) => [...node.querySelectorAll('[data-web-image-tile]')]
          .filter(tile => !tile.querySelector('img') && exportableMedia(tile, excludedRoots))))];
        let ready = 0;
        const decoding = [];
        let inFlight = pendingDecodes.size;
        for (const img of images) {
          // Offscreen lazy images within a mounted message otherwise never load
          // while we hold the scroll position. Restore their attribute afterwards.
          const existing = decodedImages.get(img);
          const readyKey = `${img.currentSrc || img.getAttribute('src') || img.getAttribute('srcset') || ''}:${img.naturalWidth}:${img.naturalHeight}`;
          if (img.complete && img.naturalWidth > 0 && existing?.key === readyKey && existing.status === 'ready') { ready++; continue; }
          if (existing?.key === readyKey && existing.status === 'pending') { decoding.push(existing.promise); continue; }
          if (inFlight >= 2) continue;
          inFlight++;
          if (img.getAttribute('loading') === 'lazy') { lazy.set(img, 'lazy'); img.setAttribute('loading', 'eager'); }
          const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('srcset') || '';
          if (!img.complete) continue;
          if (!img.naturalWidth || !img.naturalHeight) {
            if (src) throw imageError('An image failed to load in the conversation. Export was stopped to avoid missing images. Reload the image and retry.', img, 'load');
            continue;
          }
          if (typeof img.decode !== 'function') {
            decodedImages.set(img, { key: readyKey, status: 'ready' }); ready++; continue;
          }
          const key = `${src}:${img.naturalWidth}:${img.naturalHeight}`;
          let state = decodedImages.get(img);
          if (!state || state.key !== key) {
            state = { key, status: 'pending', img };
            pendingDecodes.add(state);
            state.promise = Promise.resolve().then(() => img.decode()).then(
              () => { state.status = 'ready'; pendingDecodes.delete(state); state.img = null; },
              () => { state.status = 'error'; pendingDecodes.delete(state); state.img = null; });
            decodedImages.set(img, state);
          }
          if (state.status === 'error') throw imageError('An image could not be decoded. Export was stopped to avoid missing images. Reload the image and retry.', img, 'decode');
          if (state.status === 'ready') ready++;
          else decoding.push(state.promise);
        }
        const total = images.length + emptyTiles.length;
        if (ready === total) return;
        if (Date.now() >= deadline) throw imageError('Images did not finish loading within 60 seconds. Export was stopped to avoid missing images. Wait for the images in the chat and retry.', images.find(img => decodedImages.get(img)?.status !== 'ready'), 'timeout');
        const progress = `${ready}/${total}`;
        if (progress !== lastProgress) { onProgress(ready, total); lastProgress = progress; }
        let timer;
        try {
          await Promise.race([new Promise(resolve => { timer = setTimeout(resolve, Math.min(200, deadline - Date.now())); }), ...decoding]);
        } finally { clearTimeout(timer); }
      }
    } finally {
      for (const [img, original] of lazy) if (img.getAttribute('loading') === 'eager') img.setAttribute('loading', original);
    }
  }

  window.ChatArchiveMedia = {
    limits,
    beginExport: () => resetResources(true),
    endExport: () => resetResources(false),
    resourceUsage: () => resources ? { assets: resources.entries.size, pixels: resources.pixels, imageCharacters: resources.characters } : { assets: 0, pixels: 0, imageCharacters: 0 },
    normalizeGalleries,
    waitForImages,
    preserve(source, clone, { owner = 'unscoped', excludedRoots = [] } = {}) {
      const originals = [...source.querySelectorAll('img,svg,canvas')];
      const copies = [...clone.querySelectorAll('img,svg,canvas')];
      const indexes = { img: 0, svg: 0, canvas: 0 };
      originals.forEach((element, index) => {
        const mediaIndex = indexes[element.localName]++;
        const copy = copies[index];
        if (!copy || !clone.contains(copy)) return;
        if (!exportableMedia(element, excludedRoots)) { copy.remove(); return; }
        const svg = element.localName === 'svg';
        let pixels = (element.naturalWidth || element.width || 0) * (element.naturalHeight || element.height || 0);
        if (svg) {
          const bounds = element.getBoundingClientRect();
          const width = bounds.width || Number(element.getAttribute('width'));
          const height = bounds.height || Number(element.getAttribute('height'));
          if (!(width > 48 && height > 48) && element.getAttribute('role') !== 'img') { copy.remove(); return; }
          pixels = Math.max(width || 0, Number(element.getAttribute('width')) || 0) * Math.max(height || 0, Number(element.getAttribute('height')) || 0);
        }
        reserve(owner, element.localName, mediaIndex, pixels);
        const label = element.getAttribute('alt') || element.getAttribute('aria-label') ||
          (svg ? element.querySelector('title')?.textContent : '') || (svg ? 'Diagram' : element.localName === 'canvas' ? 'Canvas snapshot' : 'Image');
        const figure = document.createElement('figure');
        figure.setAttribute('data-export-media', '');
        let data = '', external = '', notice = '';
        if (svg) {
          const result = svgImage(element); data = result.data;
          if (result.omitted) notice = 'Some embedded or interactive diagram elements could not be saved.';
        } else {
          const src = element.currentSrc || element.getAttribute('src') || '';
          const key = `${src}:${element.naturalWidth}:${element.naturalHeight}`;
          const cached = element.localName === 'img' ? imageCache.get(element) : null;
          data = cached?.key === key ? cached.data : raster.test(src) && src.length <= maxDataLength ? src : capture(element);
          if (element.localName === 'img') imageCache.set(element, { key, data });
          if (!data && src) {
            try { const url = new URL(src, location.href); if (/^https?:$/.test(url.protocol)) external = url.href; } catch (_) {}
          }
        }
        if (data || external) {
          reserve(owner, element.localName, mediaIndex, 0, data.length);
          const image = document.createElement('img');
          image.setAttribute('src', data || external); image.alt = label;
          figure.append(image);
          if (external) notice = 'Image is linked, not embedded; it may require the original site and a valid session.';
        } else notice = 'Visual content could not be embedded. Open the original conversation to view it.';
        if (notice) {
          const caption = document.createElement('figcaption');
          caption.textContent = `${label}: ${notice}`;
          figure.append(caption);
        }
        copy.closest('picture')?.querySelectorAll('source').forEach(candidate => candidate.remove());
        copy.replaceWith(figure);
      });
      // Attachment thumbnails are often buttons. Keep their captured media only.
      clone.querySelectorAll('button').forEach(button => {
        const media = [...button.querySelectorAll('figure[data-export-media]')];
        if (media.length) button.replaceWith(...media);
      });
      normalizeGalleries(clone);
    }
  };
})();
