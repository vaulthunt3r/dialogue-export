/* Read-only, explicitly started history sessions. Credentials never leave this script. */
(function () {
  const origin = 'https://chatgpt.com';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // Only fixed categories cross into reports; never forward arbitrary exception text.
  const normalizationCodes = new Map([
    ['The server did not identify this conversation.', 'CHAT_ID_MISSING'],
    ['The server returned a different conversation. Export stopped; no file was saved.', 'CHAT_ID_MISMATCH'],
    ['The current conversation branch is unavailable.', 'BRANCH_UNAVAILABLE'],
    ['The conversation branch is incomplete.', 'BRANCH_INCOMPLETE'],
    ['This message type needs collection from the page.', 'MESSAGE_TYPE'],
    ['This attachment type needs collection from the page.', 'ATTACHMENT_TYPE'],
    ['This reference format needs collection from the page.', 'REFERENCE_FORMAT'],
    ['This rich content needs collection from the page.', 'RICH_REFERENCE'],
    ['Wait for the response to finish before direct export.', 'RESPONSE_UNFINISHED'],
    ['Message identifiers in the response are ambiguous.', 'MESSAGE_IDS'],
    ['The HTML renderer is unavailable. Reload the conversation tab.', 'RENDERER_UNAVAILABLE'],
    ['This export exceeds the content memory limit. No partial file was saved.', 'CONTENT_LIMIT'],
    ['No supported messages were returned by direct export.', 'NO_MESSAGES']
  ]);
  let session = null;
  function check(current) {
    if (session !== current || current.controller.signal.aborted || location.origin !== origin) throw Error('STOPPED');
  }
  async function request(current, path, limit) {
    check(current);
    const controller = new AbortController();
    const abort = () => controller.abort();
    current.controller.signal.addEventListener('abort', abort, { once: true });
    let timedOut = false, readingBody = false;
    const deadline = setTimeout(() => {timedOut = true; abort();}, 30000);
    try {
      const response = await fetch(new URL(path, origin), { method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
        signal: controller.signal, headers: { accept: 'application/json', ...(current.token ? { authorization: `Bearer ${current.token}` } : {}) } });
      if (!response.ok) {
        const seconds = Number(response.headers.get('retry-after'));
        await response.body?.cancel();
        return { ok: false, code: `HTTP_${response.status}`, retryAfter: Number.isFinite(seconds) ? Math.min(60, Math.max(1, seconds)) : 5 };
      }
      readingBody = true;
      const data = await ChatArchiveApi.readJson(response, limit, () => check(current));
      check(current); return { ok: true, data };
    } catch (error) { return { ok: false, code: current.controller.signal.aborted ? 'STOPPED' : timedOut ? 'REQUEST_TIMEOUT'
      : error.message?.includes('memory limit') ? 'RESPONSE_LIMIT' : !readingBody ? 'NETWORK_ERROR'
      : ['Direct export returned invalid conversation data.', 'Direct export returned an unsupported response.'].includes(error.message) ? 'INVALID_RESPONSE' : 'READ_FAILED' }; }
    finally { clearTimeout(deadline); current.controller.signal.removeEventListener('abort', abort); }
  }
  window.ChatArchiveHistory = {
    get active() { return session !== null; },
    async handle(message) {
      if (location.origin !== origin) return { ok: false, code: 'CHATGPT_ONLY' };
      if (message.type === 'HISTORY_END') {
        if (session?.id === message.session) { session.controller.abort(); session.token = null; session = null; }
        return { ok: true };
      }
      if (message.type === 'HISTORY_START') {
        if (session || !uuid.test(message.session)) return { ok: false, code: 'BUSY' };
        const current = { id: message.session, token: null, controller: new AbortController() }; session = current;
        const result = await request(current, '/api/auth/session', 1024 * 1024);
        if (session !== current) return { ok: false, code: 'STOPPED' };
        const token = result.data?.accessToken || result.data?.access_token;
        if (!result.ok || typeof token !== 'string' || !token) { current.controller.abort(); session = null; return { ok: false, code: result.code || 'HTTP_401' }; }
        current.token = token; return { ok: true };
      }
      const current = session;
      if (!current || current.id !== message.session || !current.token) return { ok: false, code: 'SESSION_ENDED' };
      if (message.type === 'HISTORY_LIST') {
        if (!Number.isSafeInteger(message.offset) || message.offset < 0 || message.offset > 10000 || typeof message.archived !== 'boolean') return { ok: false, code: 'INVALID_REQUEST' };
        const query = new URLSearchParams({ offset: String(message.offset), limit: '100', order: 'updated', is_archived: String(message.archived) });
        const result = await request(current, `/backend-api/conversations?${query}`, 4 * 1024 * 1024);
        if (!result.ok) return result;
        const raw = result.data;
        if (!Array.isArray(raw?.items) || raw.items.length > 100 || !Number.isSafeInteger(raw.total) || raw.total < 0 ||
            (raw.offset != null && raw.offset !== message.offset) || raw.items.some(item => !uuid.test(item?.id))) return { ok: false, code: 'LIST_CHANGED' };
        return { ok: true, total: raw.total, items: raw.items.map(item => ({ id: item.id.toLowerCase(), title: typeof item.title === 'string' ? item.title.slice(0, 300) : 'Untitled',
          archived: message.archived, updatedAt: typeof item.update_time === 'string' ? item.update_time.slice(0, 50) : null })) };
      }
      if (message.type === 'HISTORY_CHAT') {
        if (!uuid.test(message.id) || !['md', 'txt', 'html', 'json'].includes(message.format)) return { ok: false, code: 'INVALID_REQUEST' };
        const result = await request(current, `/backend-api/conversation/${message.id}`, 32 * 1024 * 1024);
        if (!result.ok) return result;
        try {
          const data = ChatArchiveApi.normalize(result.data, `${origin}/c/${message.id}`, { outputFormat: message.format,
            includeUserImages: false, includeAssistantImages: false, includeLinks: true, includeTimestamps: true });
          return { ok: true, data };
        } catch (error) { return { ok: false, code: normalizationCodes.get(error.message) || 'UNSUPPORTED_CHAT' }; }
      }
      return { ok: false, code: 'INVALID_REQUEST' };
    }
  };
  window.addEventListener('pagehide', () => { session?.controller.abort(); session = null; });
})();
