(function () {
  'use strict';

  // Read only data properties. Do not call page functions or accessors.
  function own(object, key) {
    if (!object || typeof object !== 'object') return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } catch (_) { return undefined; }
  }

  function messageElement(node) {
    return node.hasAttribute('data-message-id') ? node : node.querySelector('[data-message-id]');
  }

  function messageId(node) {
    return messageElement(node)?.getAttribute('data-message-id') || null;
  }

  function fromDOM(node) {
    const elements = [messageElement(node), node].filter(Boolean);
    for (const element of elements) {
      for (const attribute of ['data-message-created-at', 'data-message-create-time', 'data-message-timestamp', 'data-created-at', 'data-create-time']) {
        const iso = ChatArchiveTimestamps.normalize(element.getAttribute(attribute));
        if (iso) return iso;
      }
    }
    // A <time> inside the conversation body may be part of the reply itself.
    // Only explicitly marked message metadata outside content is eligible.
    const time = node.querySelector('time[data-message-timestamp][datetime]');
    if (time && !time.closest('.markdown, .prose, pre, code, [contenteditable], [data-message-content]')) {
      return ChatArchiveTimestamps.normalize(time.getAttribute('datetime'));
    }
    return null;
  }

  function fromProps(props, id, role) {
    const candidates = [props, own(props, 'message')];
    const messages = own(props, 'messages');
    if (Array.isArray(messages)) {
      const length = Math.min(own(messages, 'length') || 0, 250);
      for (let i = 0; i < length; i++) candidates.push(own(messages, String(i)));
    }
    for (const candidate of candidates) {
      const message = own(candidate, 'message') || candidate;
      if (own(message, 'id') !== id) continue;
      const messageRole = own(own(message, 'author'), 'role');
      if (messageRole && messageRole !== role) continue;
      const iso = ChatArchiveTimestamps.normalize(own(message, 'create_time'));
      if (iso) return iso;
    }
    return null;
  }

  function fromReact(node, id, role) {
    // Matching the exact message ID avoids assigning a user's time to an answer
    // or choosing another regenerated answer from a turn's messages array.
    if (!id) return null;
    const visited = new Set();
    let element = messageElement(node) || node;
    const turn = element.closest('section[data-turn-id], article[data-testid^="conversation-turn-"]');
    for (let level = 0; element && level < 8; level++, element = element.parentElement) {
      try {
        // Firefox exposes page-owned React properties through this DOM wrapper.
        // Only scalar id/role/time values cross into the extension's own data.
        const pageElement = element.wrappedJSObject || element;
        for (const key of Object.getOwnPropertyNames(pageElement)) {
          if (key.startsWith('__reactProps$')) {
            const iso = fromProps(own(pageElement, key), id, role);
            if (iso) return iso;
          }
          if (!key.startsWith('__reactFiber$') && !key.startsWith('__reactInternalInstance$')) continue;
          let fiber = own(pageElement, key);
          for (let depth = 0; fiber && depth < 24 && !visited.has(fiber); depth++) {
            visited.add(fiber);
            const iso = fromProps(own(fiber, 'memoizedProps'), id, role);
            if (iso) return iso;
            fiber = own(fiber, 'return');
          }
        }
      } catch (_) { /* A changed or inaccessible page object must not stop export. */ }
      if (element === turn) break;
    }
    return null;
  }

  window.ChatArchiveMessageTimestamps = {
    messageId,
    read(node, role) {
      if (location.hostname !== 'chatgpt.com') return null;
      try { return fromDOM(node) || fromReact(node, messageId(node), role); }
      catch (_) { return null; }
    }
  };
})();
