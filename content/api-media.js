(function () {
  if (globalThis.ChatArchiveApiMedia) return;
  const maxImageBytes = 8 * 1024 * 1024;
  const maxOutputCharacters = 16 * 1024 * 1024;
  const maxImagePixels = 16 * 1024 * 1024;
  const maxTotalPixels = 24 * 1024 * 1024;
  function imageFailure(code, message, details = {}) {
    const error = new Error(message);
    error.imageDiagnostic = { code, ...details };
    return error;
  }
  const bridgeFailureCodes = new Set(['IMAGE_HTTP_ERROR', 'IMAGE_BODY_UNAVAILABLE', 'IMAGE_SIZE_LIMIT', 'IMAGE_TIMEOUT',
    'IMAGE_ABORTED', 'IMAGE_NETWORK_ERROR', 'IMAGE_FORMAT_UNSUPPORTED', 'IMAGE_DECODE_FAILED', 'IMAGE_PERMISSION_REQUIRED',
    'IMAGE_REQUEST_REJECTED', 'IMAGE_FETCH_BUSY', 'IMAGE_FETCH_FAILED']);
  function previewBridgeUrl(value) {
    if (location.origin !== 'https://chatgpt.com' || typeof globalThis.browser?.runtime?.sendMessage !== 'function') return null;
    try {
      const url = new URL(value);
      return url.origin === 'https://images.openai.com' && !url.username && !url.password &&
        /^\/(?:static-rsc-\d+\/|thumbnails\/)/.test(url.pathname) ? url.href : null;
    } catch (_) { return null; }
  }
  async function loadPreview(url, { signal, check }) {
    check();
    if (signal.aborted) throw imageFailure('IMAGE_ABORTED', 'Image preparation interrupted.');
    const id = crypto.randomUUID();
    let timer, abort, stopped = false;
    const cancel = () => { browser.runtime.sendMessage({ type: 'PAGE_IMAGE_CANCEL', id }).catch(() => {}); };
    try {
      const interrupted = new Promise((_, reject) => {
        const stop = (code, message) => {
          if (stopped) return;
          stopped = true; cancel(); reject(imageFailure(code, message, { transport: 'extension' }));
        };
        abort = () => stop('IMAGE_ABORTED', 'Image preparation interrupted.');
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => stop('IMAGE_TIMEOUT', 'The image download timed out.'), 70000);
      });
      const response = await Promise.race([browser.runtime.sendMessage({ type: 'PAGE_IMAGE_READ', id, url }), interrupted]);
      check();
      if (signal.aborted) throw imageFailure('IMAGE_ABORTED', 'Image preparation interrupted.');
      if (!response?.ok) {
        const code = bridgeFailureCodes.has(response?.code) ? response.code : 'IMAGE_RESPONSE_INVALID';
        const details = { transport: 'extension' }, diagnostic = response?.diagnostic;
        if (Number.isInteger(diagnostic?.httpStatus) && diagnostic.httpStatus >= 100 && diagnostic.httpStatus <= 599) details.httpStatus = diagnostic.httpStatus;
        if (['request', 'headers', 'body'].includes(diagnostic?.requestStage)) details.requestStage = diagnostic.requestStage;
        if (Number.isInteger(diagnostic?.receivedBytes) && diagnostic.receivedBytes >= 0 && diagnostic.receivedBytes <= maxImageBytes + 1) details.receivedBytes = diagnostic.receivedBytes;
        throw imageFailure(code, code === 'IMAGE_PERMISSION_REQUIRED' ? 'Firefox has not granted image access. Click Allow image access, then retry.' : 'The extension could not prepare the image.', details);
      }
      const image = response.image;
      // Only the extension background produces this reply. Validate its bounded
      // shape before embedding; byte format and decoding are checked there.
      if (!image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(image.type) ||
          typeof image.src !== 'string' || !image.src.startsWith(`data:${image.type};base64,`) ||
          !/^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(image.src) ||
          image.src.length > Math.ceil(maxImageBytes / 3) * 4 + 64 ||
          !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.width * image.height > maxImagePixels) {
        throw imageFailure('IMAGE_RESPONSE_INVALID', 'The extension returned an invalid image.', { transport: 'extension' });
      }
      return { src: image.src, type: image.type, width: image.width, height: image.height };
    } catch (error) {
      if (error.imageDiagnostic) throw error;
      check();
      throw imageFailure(signal.aborted ? 'IMAGE_ABORTED' : 'IMAGE_RESPONSE_INVALID', 'The image request was interrupted or unavailable.', { transport: 'extension' });
    } finally {
      clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort);
    }
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function allowedUrl(value) {
    let url;
    try { url = new URL(value, location.origin); }
    catch (_) { throw imageFailure('IMAGE_URL_UNSUPPORTED', 'The image URL is not supported for direct export.'); }
    if (url.origin === location.origin && url.pathname.startsWith('/backend-api/')) return url;
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
        !url.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
        url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') || url.hostname.includes(':')) {
      throw imageFailure('IMAGE_URL_UNSUPPORTED', 'The image URL is not supported for direct export.');
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
      if (!match || match[1].length > Math.ceil(maxImageBytes * 4 / 3) + 4) throw imageFailure('IMAGE_DATA_INVALID', 'The embedded image is invalid or too large.');
      try { return Uint8Array.from(atob(match[1]), character => character.charCodeAt(0)); }
      catch (_) { throw imageFailure('IMAGE_DATA_INVALID', 'The embedded image is invalid.'); }
    }
    const url = allowedUrl(value), local = url.origin === location.origin;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, 60000);
    let reader, requestStage = 'request', receivedBytes = 0;
    try {
      check();
      const response = await fetch(url.href, { method: 'GET', credentials: local ? 'include' : 'omit', redirect: 'error',
        referrerPolicy: 'no-referrer', signal: controller.signal, headers: local && token ? { authorization: `Bearer ${token}` } : {} });
      requestStage = 'headers';
      if (!response.ok) {
        await response.body?.cancel();
        throw imageFailure('IMAGE_HTTP_ERROR', 'The image server rejected the download.', { httpStatus: response.status });
      }
      if (!response.body?.getReader) throw imageFailure('IMAGE_BODY_UNAVAILABLE', 'The image response body is unavailable.');
      if (Number(response.headers.get('content-length')) > maxImageBytes) { await response.body.cancel(); throw imageFailure('IMAGE_SIZE_LIMIT', 'The image exceeds the download limit.'); }
      reader = response.body.getReader();
      requestStage = 'body';
      const chunks = []; let count = 0;
      for (;;) {
        check();
        const { value, done } = await reader.read();
        if (done) break;
        count += value.length;
        receivedBytes = count;
        if (count > maxImageBytes) throw imageFailure('IMAGE_SIZE_LIMIT', 'The image exceeds the download limit.');
        chunks.push(value);
      }
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    } catch (error) {
      const details = { requestStage, receivedBytes: Math.min(receivedBytes, maxImageBytes + 1) };
      if (signal.aborted) throw imageFailure('IMAGE_ABORTED', 'Image preparation interrupted.', details);
      if (timedOut) throw imageFailure('IMAGE_TIMEOUT', 'The image download timed out.', details);
      if (error.imageDiagnostic) { Object.assign(error.imageDiagnostic, details); throw error; }
      throw imageFailure('IMAGE_NETWORK_ERROR', 'The image request failed.', details);
    } finally {
      await reader?.cancel().catch(() => {}); reader?.releaseLock();
      clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort();
    }
  }

  async function loadImage(url, { signal, token = null, check = () => {} }) {
    // MV3 content-script fetch remains subject to page CORS even with a host
    // permission. Reuse the existing, narrowly scoped preview background reader.
    // Background pages do not take this branch, so it cannot recurse.
    const previewUrl = previewBridgeUrl(url);
    if (previewUrl) return loadPreview(previewUrl, { signal, check });
    let bytes, image;
    try { bytes = await download(url, { signal, token, check }); }
    catch (error) {
      if (error.imageDiagnostic) throw error;
      throw imageFailure(signal.aborted ? 'IMAGE_ABORTED' : 'IMAGE_NETWORK_ERROR', 'The image request failed.');
    }
    try { image = inspect(bytes); }
    catch (_) { throw imageFailure('IMAGE_FORMAT_UNSUPPORTED', 'The downloaded image format is unsupported or invalid.'); }
    const area = image.width * image.height;
    if (!Number.isFinite(area) || image.width <= 0 || image.height <= 0 || area > maxImagePixels) throw imageFailure('IMAGE_SIZE_LIMIT', 'The image pixel budget was exceeded.');
    try { await validateDecode(image, signal); }
    catch (_) { throw imageFailure(signal.aborted ? 'IMAGE_ABORTED' : 'IMAGE_DECODE_FAILED', 'Firefox could not decode the downloaded image.'); }
    check();
    return { width: image.width, height: image.height, type: image.type, src: dataUrl(image) };
  }

  async function waitRetry(milliseconds, signal, check) {
    check();
    let timer, abort;
    try {
      await new Promise((resolve, reject) => {
        abort = () => reject(imageFailure('IMAGE_ABORTED', 'Image preparation interrupted.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else timer = setTimeout(resolve, milliseconds);
      });
    } catch (error) { check(); throw error; }
    finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
    check();
  }

  async function checkPreviewAccess(data, { signal, check, onProgress }) {
    let total = 0, needed = null;
    for (let position = 0; position < data.messages.length; position++) {
      for (const entry of data.messages[position].media || []) {
        total++;
        if (!needed && !entry.source.pointer && previewBridgeUrl(entry.source.url)) needed = { image: total, messagePosition: position + 1 };
      }
    }
    if (!needed) return;
    check();
    onProgress(70, 'Checking image access', 0);
    let timer, abort, response;
    try {
      const interrupted = new Promise((_, reject) => {
        abort = () => reject(imageFailure('IMAGE_ABORTED', 'Image preparation interrupted.'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        timer = setTimeout(() => reject(imageFailure('IMAGE_RESPONSE_INVALID', 'Image access check timed out.')), 5000);
      });
      response = await Promise.race([browser.runtime.sendMessage({ type: 'IMAGE_ACCESS_CHECK' }), interrupted]);
      check();
    } catch (error) {
      check();
      if (signal.aborted) throw error;
    } finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
    if (response?.ok === true && response.granted === true) return;
    const denied = response?.ok === true && response.granted === false;
    const error = new Error(denied
      ? 'Image access is required before export. Click Allow image access, then start the export again. No images were downloaded.'
      : 'Could not check image access. Reload the extension and retry. No images were downloaded.');
    error.mediaDiagnostic = { version: 5, phase: 'permission', ...needed, total, referenceKind: 'url', attempts: 0,
      download: { code: denied ? 'IMAGE_PERMISSION_REQUIRED' : 'IMAGE_RESPONSE_INVALID', transport: 'extension' } };
    // This happens before modifying/staging messages or resolving file pointers.
    // No partial-save decision is needed: there is no prepared prefix to lose.
    throw error;
  }

  function retryable(error, phase, refreshable) {
    const code = error.imageDiagnostic?.code, status = error.imageDiagnostic?.httpStatus;
    if (['IMAGE_NETWORK_ERROR', 'IMAGE_TIMEOUT'].includes(code)) return true;
    if (!['IMAGE_HTTP_ERROR', 'IMAGE_REFERENCE_UNAVAILABLE'].includes(code)) return false;
    return [408, 429, 500, 502, 503, 504].includes(status) || phase === 'download' && refreshable && [401, 403].includes(status);
  }

  async function embed(data, { resolvePointer, signal, token, check, onProgress, onPart }) {
    await checkPreviewAccess(data, { signal, check, onProgress });
    const cache = new Map();
    // Leave room for document wrappers and message labels below the background
    // 16 Mi-character ceiling. At most one part plus one message is prepared.
    const partLimit = onPart ? 12 * 1024 * 1024 : maxOutputCharacters;
    const messageLimit = onPart ? 15 * 1024 * 1024 : maxOutputCharacters;
    const source = data.messages, messageCount = source.length;
    let partMessages = [], characters = 0, pixels = 0, occurrences = 0, processed = 0, parts = 0;
    let completedMessages = 0, completedImages = 0;
    const total = data.messages.reduce((sum, m) => sum + (m.media?.length || 0), 0);
    if (!onPart && total > 128) throw new Error('This export has too many images for a single file. No partial file was saved.');
    if (total) data.imageExport = { originalVerified: false, rasterReencoded: false };
    const metadata = { ...data }; delete metadata.messages;
    data.messages = [];
    const flush = async (stopped = false) => {
      if (!partMessages.length) return;
      if (!onPart) throw new Error('Images exceed the single-file export memory limit. No partial file was saved.');
      if (!stopped) check();
      await onPart({ ...metadata, messages: partMessages }, { stopped });
      // Commit the acknowledged part before the next cancellation check, so
      // stopping during a disk write cannot stage the same messages twice.
      parts++; partMessages = []; characters = 0; pixels = 0; occurrences = 0; cache.clear();
      // The next message may already be fully embedded when it triggers this
      // flush. Let the caller commit it before the next cancellation check.
    };
    try {
      for (let index = 0; index < source.length; index++) {
        const message = source[index];
        source[index] = null; // Staged messages must not remain reachable here.
        const prepared = new Map();
        let messageCharacters = (message.html?.length || 0) + (message.id?.length || 0) + 256 +
          (message.activities || []).reduce((sum, activity) => sum + ['title', 'text', 'markdown', 'html'].reduce((n, key) => n + (activity[key]?.length || 0), 0), 0);
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
            const refreshable = !!entry.source.pointer || reference.startsWith('sandbox:');
            const referenceKind = ['sediment', 'file-service', 'sandbox'].find(kind => reference.startsWith(`${kind}:`)) || (reference.startsWith('data:') ? 'embedded' : 'url');
            for (let attempt = 1; attempt <= 3; attempt++) {
              let phase = refreshable ? 'reference' : 'download';
              try {
                // Resolve again on every attempt: a signed download URL may
                // have expired. Completed images and staged parts stay intact.
                const url = refreshable ? await resolvePointer(reference, message.id) : reference;
                phase = 'download';
                image = await loadImage(url, { signal, token, check });
                break;
              } catch (error) {
                check();
                if (attempt < 3 && retryable(error, phase, refreshable)) {
                  onProgress(75 + Math.round(processed / Math.max(1, total) * 20), `Retrying image ${processed + 1}/${total} · attempt ${attempt + 1}/3`, messageCount);
                  await waitRetry(attempt === 1 ? 500 : 1500, signal, check);
                  continue;
                }
                const known = ['IMAGE_HTTP_ERROR', 'IMAGE_NETWORK_ERROR', 'IMAGE_TIMEOUT', 'IMAGE_BODY_UNAVAILABLE', 'IMAGE_SIZE_LIMIT', 'IMAGE_FORMAT_UNSUPPORTED', 'IMAGE_DECODE_FAILED', 'IMAGE_ABORTED', 'IMAGE_REFERENCE_UNAVAILABLE', 'IMAGE_REFERENCE_UNSUPPORTED', 'IMAGE_URL_UNSUPPORTED', 'IMAGE_DATA_INVALID', ...bridgeFailureCodes, 'IMAGE_RESPONSE_INVALID'];
                const code = known.includes(error.imageDiagnostic?.code) ? error.imageDiagnostic.code : phase === 'reference' ? 'IMAGE_REFERENCE_UNAVAILABLE' : 'IMAGE_FETCH_FAILED';
                const status = error.imageDiagnostic?.httpStatus;
                const diagnostic = { code, ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}) };
                const stage = error.imageDiagnostic?.requestStage, bytes = error.imageDiagnostic?.receivedBytes;
                if (['request', 'headers', 'body', 'metadata'].includes(stage)) diagnostic.requestStage = stage;
                if (Number.isInteger(bytes) && bytes >= 0 && bytes <= maxImageBytes + 1) diagnostic.receivedBytes = bytes;
                if (error.imageDiagnostic?.transport === 'extension') diagnostic.transport = 'extension';
                const failure = new Error(`Image ${processed + 1} of ${total} could not be embedded (${code}${diagnostic.httpStatus ? `, HTTP ${diagnostic.httpStatus}` : ''}; ${attempt} attempt${attempt > 1 ? 's' : ''}). No file was saved yet.`);
                failure.imageEmbedFailed = true;
                failure.mediaDiagnostic = { version: 4, phase, image: processed + 1, total, messagePosition: index + 1, referenceKind, attempts: attempt, download: diagnostic };
                throw failure;
              }
            }
          }
          prepared.set(key, image);
          if ([...prepared.values()].reduce((sum, item) => sum + item.width * item.height, 0) > maxTotalPixels) {
            throw new Error('Images in one message exceed the pixel limit for a part. No file was saved.');
          }
          const html = `<figure class="export-api-figure"><img class="export-api-image" src="${image.src}" alt="${escape(entry.alt || 'Image')}" width="${image.width}" height="${image.height}"></figure>`;
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
        completedMessages++; completedImages += messageOccurrences;
      }
      check();
      if (total) data.embeddedImages = processed;
      if (parts) {
        await flush();
        data.multipart = { parts, messages: messageCount };
      } else data.messages = partMessages;
      return data;
    } catch (error) {
      if (error.exportStopped === true || error.imageEmbedFailed === true) {
        // Only fully prepared messages belong to the snapshot. The current
        // message may contain unresolved images and must never be handed off.
        if (parts) {
          try { await flush(true); }
          catch (storageError) { storageError.partialRecoveryFailed = true; throw storageError; }
          data.messages = []; data.multipart = { parts, messages: completedMessages };
        } else data.messages = partMessages;
        if (completedMessages) {
          data.embeddedImages = completedImages;
          if (completedMessages < messageCount) data.partialExport = { reason: error.exportStopped ? 'stopped' : 'image-error', messages: completedMessages, totalMessages: messageCount };
          error.partialData = data;
        }
      }
      throw error;
    } finally { cache.clear(); }
  }
  window.ChatArchiveApiMedia = { embed, inspect, allowedUrl, loadImage };
})();
