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
function fixture(html, url = 'https://chatgpt.com/c/fixture') {
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

test('kept-alive chats and foreign conversation IDs never enter snapshots or selection', () => {
  const hidden = ['hidden', 'inert', 'aria-hidden="true"', 'style="display:none"', 'style="visibility:hidden"', 'style="content-visibility:hidden"'];
  const old = hidden.map((attribute, i) => `<section ${attribute}>${user(`old-q${i}`, 'FOREIGN')}${assistant(`old-a${i}`, 'FOREIGN')}</section>`).join('');
  const foreign = assistant('foreign', 'FOREIGN').replace('conversation-id="fixture"', 'conversation-id="other"');
  const f = fixture(old + `<section hidden>${foreign}</section>` + `<div style="transform:translateY(2000px)">${user('q', 'Current question')}${assistant('a', 'Current answer')}</div>`);
  try {
    const nodes = f.extractor.nodes();
    assert.equal(nodes.length, 2);
    nodes.forEach(node => { node.dataset.chatArchiveSelected = 'true'; });
    for (const selectedOnly of [false, true]) {
      assert.deepEqual(copy(f.extractor.collect({ selectedOnly })).messages.map(m => m.text), ['Current question', 'Current answer']);
    }
  } finally { f.close(); }
});

test('message previews outside main and hidden legacy fallback are excluded', () => {
  const f = fixture('<section hidden><article data-testid="conversation-turn-0">FOREIGN</article></section>');
  try {
    f.w.document.body.insertAdjacentHTML('beforeend', assistant('preview', 'FOREIGN'));
    assert.equal(f.extractor.snapshot().length, 0);
    f.w.document.querySelector('main').insertAdjacentHTML('beforeend', '<article data-testid="conversation-turn-1" aria-label="You said">Current</article>');
    assert.deepEqual(copy(f.extractor.snapshot()).map(m => m.text), ['Current']);
  } finally { f.close(); }
});

test('visible foreign assistant aborts instead of retaining its untagged user bubble', () => {
  const foreign = assistant('foreign', 'FOREIGN').replace('conversation-id="fixture"', 'conversation-id="other"');
  const f = fixture(user('foreign-question', 'FOREIGN') + foreign + user('q') + assistant('a'));
  try { assert.throws(() => f.extractor.collect(), /another conversation/); }
  finally { f.close(); }
});

test('navigation during collection aborts before sending any file', async () => {
  const f = fixture(user('q') + assistant('a'));
  const host = f.w.document.querySelector('main');
  host.style.overflowY = 'auto';
  let top = 600;
  Object.defineProperty(f.w.document, 'scrollingElement', { value: host });
  Object.defineProperties(host, {
    clientHeight: { value: 600 }, scrollHeight: { value: 1200 },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(600, value)); } }
  });
  try {
    await f.send({ type: 'BEGIN_EXPORT', job: { format: 'md', filename: 'test.md', options: {} } });
    f.w.history.pushState({}, '', '/c/other');
    await f.clock.tickAsync(2000);
    assert.equal(f.sent.some(req => req.type === 'EXPORT_READY'), false);
    assert.ok(f.sent.some(req => req.type === 'EXPORT_FAILED'));
    host.replaceChildren(); // The new route has removed the old conversation.
    assert.match((await f.send({ type: 'PING' })).exportStatus.label, /conversation changed/);
  } finally { f.close(); }
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

for (const config of [
  { name: 'document, disjoint', overlap: false },
  { name: 'document, overlap', overlap: true },
  { name: 'hidden overflow', overflow: 'hidden' },
  { name: 'small hidden scroll range', overflow: 'hidden', range: 60 },
  { name: 'negative coordinates at the bottom', overflow: 'auto', reverse: true },
  { name: 'blocked inner wrapper', overflow: 'auto', blockedInner: true }
]) test(`modern virtualized windows retain all messages in order (${config.name})`, async () => {
  // Opaque IDs deliberately have suffixes contrary to conversation order.
  const ids = ['z99', 'a80', 'm70', 'b50', 'y20', 'c10'];
  const f = fixture(''), { w, clock } = f, host = w.document.querySelector('main');
  const { overlap } = config, maximum = config.range || 1200;
  let stage = 2, top = maximum, pending = false;
  host.style.overflowY = config.overflow || 'auto';
  host.style.setProperty('scroll-behavior', 'smooth', 'important');
  host.style.setProperty('scroll-snap-type', 'y mandatory');
  if (config.reverse) host.style.flexDirection = 'column-reverse';
  const show = () => {
    const start = overlap ? Math.max(0, stage * 2 - 1) : stage * 2;
    const html = ids.slice(start, stage * 2 + 2).map((id, j) => (start + j) % 2 ? assistant(id, `Message ${start + j}`) : user(id, `Message ${start + j}`)).join('');
    host.innerHTML = config.blockedInner ? `<div class="blocked" style="overflow-y:auto">${html}</div>` : `<div>${html}</div>`;
    if (config.blockedInner) Object.defineProperties(host.firstElementChild, {
      clientHeight: { value: 600 }, scrollHeight: { value: 1800 },
      scrollTop: { get: () => 0, set: () => {} }
    });
  };
  show();
  Object.defineProperty(w.document, 'scrollingElement', { value: config.overflow ? w.document.documentElement : host });
  Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 600 + maximum }, scrollTop: {
    get: () => config.reverse ? top - maximum : top, set: value => {
      // Model instant movement only when the controller disables smooth scroll.
      if (host.style.getPropertyValue('scroll-behavior') !== 'auto') return;
      top = Math.max(0, Math.min(maximum, value + (config.reverse ? maximum : 0)));
      if (top === 0 && stage > 0 && !pending) {
        pending = true;
        w.setTimeout(() => { stage--; show(); top = maximum / 2; pending = false; }, 350);
      } else if (top >= maximum * 0.83 && stage < 2 && !pending) { stage++; show(); top = maximum / 2; }
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
    assert.equal(host.scrollTop, config.reverse ? 0 : maximum);
    assert.equal(host.style.getPropertyValue('scroll-behavior'), 'smooth');
    assert.equal(host.style.getPropertyPriority('scroll-behavior'), 'important');
    assert.equal(host.style.getPropertyValue('scroll-snap-type'), 'y mandatory');
  } finally { f.close(); }
});

test('unmovable conversation does not silently export only the visible window', async () => {
  const f = fixture(user('q') + assistant('a')), host = f.w.document.querySelector('main');
  host.style.overflowY = 'hidden';
  Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 1800 }, scrollTop: { get: () => 400, set: () => {} } });
  Object.defineProperty(f.w.document, 'scrollingElement', { value: f.w.document.documentElement });
  try {
    await f.send({ type: 'BEGIN_EXPORT', job: { format: 'json', filename: 'test.json', options: {} } });
    await f.clock.tickAsync(100);
    const info = await f.send({ type: 'PING' });
    assert.equal(info.exportStatus.state, 'error');
    assert.match(info.exportStatus.label, /could not be scrolled/);
    assert.equal(f.sent.some(req => req.type === 'EXPORT_READY'), false);
    assert.equal(host.style.getPropertyValue('scroll-behavior'), '');
  } finally { f.close(); }
});

test('mid-export scroll stall stops promptly and restores the position and styles', async () => {
  const f = fixture(user('q') + assistant('a')), host = f.w.document.querySelector('main');
  host.style.overflowY = 'auto';
  host.style.scrollBehavior = 'smooth';
  let top = 1200;
  Object.defineProperty(f.w.document, 'scrollingElement', { value: host });
  Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 1800 }, scrollTop: {
    get: () => top, set: value => {
      // Accept the original position for restoration, but stop at 432 on descent.
      top = value === 1200 || f.w.Date.now() < 10000 ? Math.max(0, Math.min(1200, value)) : Math.min(432, Math.max(0, value));
    }
  } });
  try {
    await f.send({ type: 'BEGIN_EXPORT', job: { format: 'json', filename: 'test.json', options: {} } });
    await f.clock.tickAsync(25000);
    const info = await f.send({ type: 'PING' });
    assert.equal(info.exportStatus.state, 'error');
    assert.match(info.exportStatus.label, /stopped scrolling/);
    assert.equal(f.sent.some(req => req.type === 'EXPORT_READY'), false);
    assert.equal(top, 1200);
    assert.equal(host.style.scrollBehavior, 'smooth');
  } finally { f.close(); }
});
