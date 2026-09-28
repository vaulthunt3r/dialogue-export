const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

// Attribute placement follows issue #2. Values are synthetic opaque keys:
// the report intentionally omitted message IDs and conversation text.
function user(id, text = 'Question') {
  return `<div data-turn-key="turn-${id}"><div data-chatgpt-search-unit-key="unit-${id}" data-chatgpt-search-message-ids='["${id}"]'><div data-content-search-unit-key="content-${id}"><div class="group/user-message"><div data-user-message-bubble><div><div data-search-result-target><div class="text-size-chat whitespace-pre-wrap">${text}</div></div></div></div></div></div></div></div>`;
}
function assistant(id, text = 'Answer') {
  return `<div data-turn-key="turn-${id}"><div data-content-search-turn-key="turn-${id}"><div data-content-search-unit-key="content-${id}" data-chatgpt-search-unit-key="unit-${id}" data-chatgpt-search-message-ids='["${id}"]'><div data-chatgpt-selection-conversation-id="fixture" data-chatgpt-selection-message-id="${id}"><div data-selected-text-overlay-target data-markdown-text-style><p><span>${text}</span></p></div></div></div></div></div>`;
}
function fixture(html, url = 'https://chatgpt.com/c/test') {
  const dom = new JSDOM(`<main>${html}</main>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let listener;
  const sent = [];
  w.browser = { runtime: {
    onMessage: { addListener: fn => { listener = fn; } },
    sendMessage: async req => { sent.push(req); return { ok: true }; }
  } };
  for (const file of ['shared/timestamps.js', 'content/timestamps.js', 'content/extract.js', 'content/content.js']) w.eval(read(file));
  return { w, clock, sent, extractor: w.ChatArchiveExtractor, send: req => listener(req),
    close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}

test('reported modern markup detects both authors and preserves content without picker controls', async () => {
  const f = fixture(user('q9', 'Question <a href="https://example.com">link</a>') + assistant('a2', 'Hello <code>world</code>'));
  try {
    assert.equal((await f.send({ type: 'PING' })).count, 2);
    await f.send({ type: 'SET_PICKING', enabled: true });
    f.w.document.querySelectorAll('.chat-archive-picker')[1].click();
    const messages = copy(f.extractor.collect().messages);
    assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
    assert.match(messages[0].markdown, /\[link\]\(https:\/\/example.com\/?\)/);
    assert.match(messages[1].html, /<code>world<\/code>/);
    assert.ok(messages.every(m => !m.html.includes('chat-archive-picker')));
    assert.equal(f.extractor.collect({ selectedOnly: true }).messages[0].role, 'assistant');
  } finally { f.close(); }
});

test('authors do not depend on viewport parity or words inside the message', () => {
  const f = fixture(assistant('a9', 'You said this') + assistant('a2') + user('q1', 'ChatGPT said this'));
  try { assert.deepEqual(copy(f.extractor.snapshot()).map(m => m.role), ['assistant', 'assistant', 'user']); }
  finally { f.close(); }
});

test('mixed old/new markers yield one message each in DOM order', () => {
  const f = fixture(`<div data-message-author-role="user" data-message-id="old">${user('q')}</div>` + assistant('a') + '<div data-message-author-role="assistant">Old answer</div>');
  try { assert.deepEqual(copy(f.extractor.snapshot()).map(m => m.text), ['Question', 'Answer', 'Old answer']); }
  finally { f.close(); }
});

test('modern IDs survive remounts and do not merge equal text or opposite roles', () => {
  const f = fixture(user('same') + assistant('same') + user('other'));
  try {
    const first = copy(f.extractor.snapshot()).map(m => m.id);
    assert.equal(new Set(first).size, 3);
    f.w.document.querySelector('main').innerHTML = user('other') + assistant('same');
    assert.deepEqual(copy(f.extractor.snapshot()).map(m => m.id), [first[2], first[1]]);
  } finally { f.close(); }
});

test('missing modern stable keys fail explicitly instead of reusing viewport positions', () => {
  const f = fixture('<div data-user-message-bubble>Question</div>');
  try { assert.throws(() => f.extractor.snapshot(), /stable message identifiers/); }
  finally { f.close(); }
});

test('opaque search keys are not parsed and turn-key fallback separates authors', () => {
  const f = fixture('<div data-turn-key="opaque-turn"><div data-user-message-bubble>Q</div><div data-chatgpt-selection-message-id="">A</div></div>');
  try {
    const messages = copy(f.extractor.snapshot());
    assert.notEqual(messages[0].id, messages[1].id);
    assert.ok(messages.every(m => m.id.endsWith(':opaque-turn')));
  } finally { f.close(); }
});

test('legacy article fallback and Gemini remain supported', () => {
  for (const [html, url] of [
    ['<article data-testid="conversation-turn-0" aria-label="You said">Q</article><article data-testid="conversation-turn-1" aria-label="ChatGPT said">A</article>', 'https://chatgpt.com/c/test'],
    ['<user-query><div class="query-text">Q</div></user-query><model-response><message-content>A</message-content></model-response>', 'https://gemini.google.com/app/test']
  ]) {
    const f = fixture(html, url);
    try { assert.deepEqual(copy(f.extractor.snapshot()).map(m => [m.role, m.text]), [['user', 'Q'], ['assistant', 'A']]); }
    finally { f.close(); }
  }
});

test('modern assistant timestamps match exact metadata; user search keys do not invent a time', () => {
  const f = fixture(user('q') + assistant('a'));
  try {
    const node = f.w.document.querySelector('[data-chatgpt-selection-message-id]');
    node.__reactProps$fixture = { messages: [
      { id: 'other', author: { role: 'assistant' }, create_time: 1788777600 },
      { id: 'a', author: { role: 'assistant' }, create_time: 1788777720 }
    ] };
    const messages = copy(f.extractor.snapshot({ includeTimestamps: true }));
    assert.equal(messages[0].createdAt, null);
    assert.equal(messages[1].createdAt, '2026-09-07T10:42:00.000Z');
  } finally { f.close(); }
});

for (const overlap of [false, true]) test(`modern virtualized windows retain all messages in order (overlap=${overlap})`, async () => {
  // Opaque IDs deliberately have suffixes contrary to conversation order.
  const ids = ['z99', 'a80', 'm70', 'b50', 'y20', 'c10'];
  const f = fixture(''), { w, clock } = f, host = w.document.querySelector('main');
  let stage = 2, top = 1200, pending = false;
  const show = () => {
    const start = overlap ? Math.max(0, stage * 2 - 1) : stage * 2;
    host.innerHTML = ids.slice(start, stage * 2 + 2).map((id, j) => (start + j) % 2 ? assistant(id, `Message ${start + j}`) : user(id, `Message ${start + j}`)).join('');
  };
  show();
  Object.defineProperty(w.document, 'scrollingElement', { value: host });
  Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 1800 }, scrollTop: {
    get: () => top, set: value => {
      top = Math.max(0, Math.min(1200, value));
      if (top === 0 && stage > 0 && !pending) {
        pending = true;
        w.setTimeout(() => { stage--; show(); top = 600; pending = false; }, 350);
      } else if (top >= 1000 && stage < 2 && !pending) { stage++; show(); top = 600; }
    }
  } });
  try {
    await f.send({ type: 'BEGIN_EXPORT', job: { format: 'json', filename: 'test.json', options: { selectedOnly: false } } });
    await clock.tickAsync(60000);
    const data = f.sent.find(req => req.type === 'EXPORT_READY')?.data;
    assert.ok(data, JSON.stringify(f.sent));
    assert.deepEqual(copy(data.messages).map(m => m.text), ids.map((_, i) => `Message ${i}`));
    assert.equal(new Set(data.messages.map(m => m.id)).size, 6);
    assert.deepEqual(copy(data.messages).map(m => m.order), [0, 1, 2, 3, 4, 5]);
  } finally { f.close(); }
});
