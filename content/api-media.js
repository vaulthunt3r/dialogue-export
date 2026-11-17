(function () {
  const maxImageBytes = 8 * 1024 * 1024;
  const maxOutputCharacters = 16 * 1024 * 1024;
  const maxImagePixels = 16 * 1024 * 1024;
  const maxTotalPixels = 24 * 1024 * 1024;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function allowedUrl(value) {
    const url = new URL(value, location.origin);
    if (url.origin === location.origin && url.pathname.startsWith('/backend-api/')) return url;
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
        !url.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
        url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') || url.hostname.includes(':')) {
      throw new Error('The image URL is not supported for direct export.');
    }
    return url;
  }

  function inspect(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const word = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
    if (bytes.length >= 24 && word(1, 3) === 'PNG' && bytes[0] === 137) {
      return { type: 'image/png', width: view.getUint32(16), height: view.getUint32(20), bytes };
    }
    if (bytes.length >= 10 && /^GIF8[79]a$/.test(word(0, 6))) {
      return { type: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true), bytes };
    }
    if (bytes.length >= 30 && word(0, 4) === 'RIFF' && word(8, 4) === 'WEBP') {
      const kind = word(12, 4);
      if (kind === 'VP8X') return { type: 'image/webp', width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(26, true) >>> 8), bytes };
      if (kind === 'VP8 ' && word(23, 3) === '\x9d\x01\x2a') return { type: 'image/webp', width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, bytes };
      if (kind === 'VP8L' && bytes[20] === 47) {
        const packed = view.getUint32(21, true);
        return { type: 'image/webp', width: 1 + (packed & 0x3fff), height: 1 + ((packed >>> 14) & 0x3fff), bytes };
      }
    }
    if (bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset + 8 < bytes.length && bytes[offset] === 255) {
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if ([216, 217, 1].includes(marker)) continue;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
          return { type: 'image/jpeg', width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), bytes };
        }
        offset += length;
      }
    }
    if (bytes.length <= 1024 * 1024 && /^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(new TextDecoder().decode(bytes.subarray(0, 300)))) {
      const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml');
      if (xml.querySelector('parsererror')) throw new Error('Invalid SVG image.');
      const svg = xml.documentElement;
      const tags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask title desc marker use'.split(' '));
      const elements = [svg, ...svg.querySelectorAll('*')];
      if (elements.length > 4000) throw new Error('SVG image is too complex.');
      for (const element of elements) {
        if (element.namespaceURI !== 'http://www.w3.org/2000/svg' || !tags.has(element.localName)) throw new Error('SVG image contains unsupported active content.');
        for (const attr of element.attributes) {
          if (/^on/i.test(attr.name) || ['style', 'class', 'base'].includes(attr.localName) ||
              (attr.localName === 'href' && !/^#[\w.-]+$/.test(attr.value)) ||
              (/url\s*\(/i.test(attr.value) && !/^url\(#[\w.-]+\)$/.test(attr.value)) || /(?:javascript:|https?:|data:)/i.test(attr.value) && !attr.name.startsWith('xmlns')) {
            throw new Error('SVG image contains unsupported external content or styling.');
          }
        }
      }
      const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      const dimension = (name, fallback) => {
        const value = svg.getAttribute(name);
        if (!value) return fallback;
        if (!/^\d+(?:\.\d+)?(?:px)?$/.test(value)) throw new Error('Unsupported SVG dimensions.');
        return Number.parseFloat(value);
      };
      const width = dimension('width', box.length === 4 ? box[2] : 300), height = dimension('height', box.length === 4 ? box[3] : 150);
      return { type: 'image/svg+xml', width, height, bytes: new TextEncoder().encode(new XMLSerializer().serializeToString(svg)) };
    }
    throw new Error('The downloaded image format is unsupported or invalid.');
  }

  function dataUrl(image) {
    const pieces = [];
    for (let i = 0; i < image.bytes.length; i += 32768) pieces.push(String.fromCharCode(...image.bytes.subarray(i, i + 32768)));
    return `data:${image.type};base64,${btoa(pieces.join(''))}`;
  }

  async function validateDecode(image, signal) {
    const url = URL.createObjectURL(new Blob([image.bytes], { type: image.type }));
    const preview = new Image();
    let timer, abort;
    try {
      if (signal.aborted) throw new Error('Image preparation interrupted.');
      preview.src = url;
      await Promise.race([preview.decode(), new Promise((_, reject) => {
        abort = () => reject(new Error('Image preparation interrupted.'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new Error('Image decoding timed out.')), 60000);
      })]);
    } finally {
      clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort);
      preview.src = ''; URL.revokeObjectURL(url);
    }
  }

  async function download(value, { signal, token, check }) {
    if (value.startsWith('data:')) {
      const match = value.match(/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$/);
      if (!match || match[1].length > Math.ceil(maxImageBytes * 4 / 3) + 4) throw new Error('The embedded image is invalid or too large.');
      return Uint8Array.from(atob(match[1]), character => character.charCodeAt(0));
    }
    const url = allowedUrl(value), local = url.origin === location.origin;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(abort, 60000);
    let reader;
    try {
      check();
      const response = await fetch(url.href, { method: 'GET', credentials: local ? 'include' : 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: controller.signal, headers: local && token ? { authorization: `Bearer ${token}` } : {} });
      if (!response.ok || !response.body?.getReader) throw new Error('The image download is unavailable.');
      if (Number(response.headers.get('content-length')) > maxImageBytes) { await response.body.cancel(); throw new Error('The image exceeds the download limit.'); }
      reader = response.body.getReader();
      const chunks = []; let count = 0;
      for (;;) {
        check();
        const { value, done } = await reader.read();
        if (done) break;
        count += value.length;
        if (count > maxImageBytes) throw new Error('The image exceeds the download limit.');
        chunks.push(value);
      }
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } finally {
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
      clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort();
    }
  }

  async function embed(data, { resolvePointer, signal, token, check, onProgress, onPart, includeImageDetails = false }) {
    const cache = new Map();
    // Leave room for document wrappers and message labels below the background
    // 16 Mi-character ceiling. At most one part plus one message is prepared.
    const partLimit = onPart ? 12 * 1024 * 1024 : maxOutputCharacters;
    const messageLimit = onPart ? 15 * 1024 * 1024 : maxOutputCharacters;
    const source = data.messages, messageCount = source.length;
    let partMessages = [], characters = 0, pixels = 0, occurrences = 0, processed = 0, parts = 0;
    const total = data.messages.reduce((sum, m) => sum + (m.media?.length || 0), 0);
    if (!onPart && total > 128) throw new Error('This export has too many images for a single file. No partial file was saved.');
    if (total) data.imageExport = { originalVerified: false, rasterReencoded: false };
    const metadata = { ...data }; delete metadata.messages;
    data.messages = [];
    const flush = async () => {
      if (!onPart) throw new Error('Images exceed the single-file export memory limit. No partial file was saved.');
      check();
      await onPart({ ...metadata, messages: partMessages });
      check();
      parts++; partMessages = []; characters = 0; pixels = 0; occurrences = 0; cache.clear();
    };
    try {
      for (let index = 0; index < source.length; index++) {
        const message = source[index];
        source[index] = null; // Staged messages must not remain reachable here.
        const prepared = new Map();
        let messageCharacters = (message.html?.length || 0) + (message.id?.length || 0) + 256;
        const messageOccurrences = message.media?.length || 0;
        if (messageOccurrences > 128) throw new Error('One message contains too many images for a part. No file was saved.');
        for (const entry of message.media || []) {
          check();
          onProgress(75 + Math.round(processed / Math.max(1, total) * 20), `Embedding images: ${processed}/${total}${parts ? ` · preparing part ${parts + 1}` : ''}`, messageCount);
          const reference = entry.source.pointer || entry.source.url;
          // Sandbox paths can be reused by different messages for different files.
          const key = reference?.startsWith('sandbox:') ? `${message.id}:${reference}` : reference;
          if (typeof key !== 'string' || !key) throw new Error('An image has no downloadable reference. No file was saved.');
          let image = prepared.get(key) || cache.get(key);
          if (!image) {
            try {
              const url = entry.source.pointer || reference.startsWith('sandbox:') ? await resolvePointer(reference, message.id) : reference;
              image = inspect(await download(url, { signal, token, check }));
              const area = image.width * image.height;
              if (!Number.isFinite(area) || image.width <= 0 || image.height <= 0 || area > maxImagePixels) {
                throw new Error('The image pixel budget was exceeded.');
              }
              await validateDecode(image, signal);
              check();
              image = { width: image.width, height: image.height, type: image.type, src: dataUrl(image) };
            } catch (_) {
              check();
              throw new Error(`Image ${processed + 1} of ${total} could not be embedded (unavailable, unsupported, or over the image limit). No file was saved. Text export is still available.`);
            }
          }
          prepared.set(key, image);
          if ([...prepared.values()].reduce((sum, item) => sum + item.width * item.height, 0) > maxTotalPixels) {
            throw new Error('Images in one message exceed the pixel limit for a part. No file was saved.');
          }
          const origin = message.role === 'user' ? 'User image' : 'Image from ChatGPT response';
          const format = image.type === 'image/svg+xml' ? 'SVG' : image.type.slice(6).toUpperCase();
          const caption = includeImageDetails ? `<figcaption>${origin} · ${image.width} × ${image.height} px · ${format}${format === 'SVG' ? ' · sanitized SVG' : ' · no re-encoding'} · original file not verified</figcaption>` : '';
          const html = `<figure class="export-api-figure"><img class="export-api-image" src="${image.src}" alt="${escape(entry.alt || 'Image')}" width="${image.width}" height="${image.height}">${caption}</figure>`;
          messageCharacters += html.length - entry.placeholder.length;
          if (messageCharacters > messageLimit) throw new Error('Images in one message exceed the single-part memory limit. No file was saved.');
          message.html = message.html.replace(entry.placeholder, html);
          processed++;
        }
        delete message.media;
        if (messageCharacters > messageLimit) throw new Error('One message exceeds the single-part memory limit. No file was saved.');
        let newPixels = [...prepared].reduce((sum, [key, image]) => sum + (cache.has(key) ? 0 : image.width * image.height), 0);
        if (partMessages.length && (characters + messageCharacters > partLimit || pixels + newPixels > maxTotalPixels || occurrences + messageOccurrences > 128)) {
          await flush();
          newPixels = [...prepared.values()].reduce((sum, image) => sum + image.width * image.height, 0);
        }
        for (const [key, image] of prepared) cache.set(key, image);
        partMessages.push(message); characters += messageCharacters; pixels += newPixels; occurrences += messageOccurrences;
      }
      check();
      if (total) data.embeddedImages = processed;
      if (parts) {
        await flush();
        data.multipart = { parts, messages: messageCount };
      } else data.messages = partMessages;
      return data;
    } finally { cache.clear(); }
  }
  window.ChatArchiveApiMedia = { embed, inspect, allowedUrl };
})();
