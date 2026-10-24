const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=';
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function fixture(content = `<img src="${pixel}" loading="lazy">`) {
  const d = new JSDOM(`<main><div data-chatgpt-selection-message-id="answer">${content}</div></main>`, { url: 'https://chatgpt.com/c/fixture', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = d.window;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  w.eval(read('content/media.js'));
  const roots = () => [w.document.querySelector('[data-chatgpt-selection-message-id]')];
  return { w, clock, roots, close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}
function state(img, initial = false) {
  const s = { complete: initial, loaded: initial };
  Object.defineProperties(img, { complete: { get: () => s.complete }, naturalWidth: { get: () => s.loaded ? 1 : 0 }, naturalHeight: { get: () => s.loaded ? 1 : 0 } });
  img.decode = async () => {};
  return s;
}

test('slow images load concurrently, lazy attributes restore and decoded images do not wait again', async () => {
  const f = fixture(`<img src="${pixel}" loading="lazy"><img src="${pixel}">`);
  try {
    const images = [...f.w.document.images], states = images.map(img => state(img));
    let done = false, decodes = 0;
    images.forEach(img => { img.decode = async () => { decodes++; }; });
    const progress = [];
    const task = f.w.ChatArchiveMedia.waitForImages(f.roots, { onProgress: (...x) => progress.push(x) }).then(() => { done = true; });
    await f.clock.tickAsync(15000);
    assert.equal(done, false);
    assert.equal(images[0].getAttribute('loading'), 'eager');
    Object.assign(states[0], { complete: true, loaded: true });
    await f.clock.tickAsync(200);
    assert.deepEqual(progress.at(-1), [1, 2]);
    Object.assign(states[1], { complete: true, loaded: true });
    await f.clock.tickAsync(200); await task;
    assert.equal(done, true);
    assert.equal(images[0].getAttribute('loading'), 'lazy');
    assert.equal(images[1].hasAttribute('loading'), false);
    await f.w.ChatArchiveMedia.waitForImages(f.roots);
    assert.equal(decodes, 2, 'loaded pixels are not decoded on every collection pass');
  } finally { f.close(); }
});

test('a loading image tile waits for its image node; hidden broken images are ignored', async () => {
  const f = fixture(`<div hidden><img src="broken"></div><div data-web-image-tile></div>`);
  try {
    let done = false;
    const task = f.w.ChatArchiveMedia.waitForImages(f.roots).then(() => { done = true; });
    await f.clock.tickAsync(1000); assert.equal(done, false);
    const img = f.w.document.createElement('img'); img.src = pixel; state(img, true);
    f.w.document.querySelector('[data-web-image-tile]').append(img);
    await f.clock.tickAsync(200); await task;
    assert.equal(done, true);
  } finally { f.close(); }
});

test('timeout and image errors stop instead of claiming success and restore lazy loading', async () => {
  const f = fixture();
  try {
    const img = f.w.document.querySelector('img'), s = state(img);
    const task = f.w.ChatArchiveMedia.waitForImages(f.roots, { timeoutMs: 1000 }).then(() => '', e => e.message);
    await f.clock.tickAsync(1001);
    assert.match(await task, /did not finish loading/);
    assert.equal(img.getAttribute('loading'), 'lazy');
    s.complete = true;
    await assert.rejects(f.w.ChatArchiveMedia.waitForImages(f.roots), /failed to load/);
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});

test('conversation identity checks interrupt an image wait and restore page attributes', async () => {
  const f = fixture();
  try {
    const img = f.w.document.querySelector('img'); state(img);
    let changed = false;
    const task = f.w.ChatArchiveMedia.waitForImages(() => { if (changed) throw new Error('Conversation changed'); return f.roots(); }).then(() => '', e => e.message);
    await f.clock.tickAsync(200); changed = true; await f.clock.tickAsync(200);
    assert.match(await task, /Conversation changed/);
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});

test('HTML collection holds its scroll window for a slow image and captures it before moving on', async () => {
  const f = fixture();
  try {
    const w = f.w, host = w.document.querySelector('main'), img = w.document.querySelector('img');
    const s = state(img); let top = 600, listener;
    Object.defineProperty(w.document, 'scrollingElement', { value: host });
    Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 1200 }, scrollTop: { get: () => top, set: x => { top = Math.max(0, Math.min(600, x)); } } });
    const sent = [];
    w.matchMedia = () => ({ matches: false });
    w.browser = { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async x => { sent.push(x); return { ok: true }; } } };
    for (const file of ['content/extract.js', 'content/content.js']) w.eval(read(file));
    await listener({ type: 'BEGIN_EXPORT', job: { format: 'html', filename: 'test.html', options: {} } });
    await f.clock.tickAsync(20000);
    assert.equal(top, 600, 'collector must not scroll away before the pixels are ready');
    assert.match((await listener({ type: 'PING' })).exportStatus.label, /Waiting for images/);
    assert.equal(sent.some(x => x.type === 'EXPORT_READY'), false);
    Object.assign(s, { complete: true, loaded: true });
    await f.clock.tickAsync(30000);
    const output = sent.find(x => x.type === 'EXPORT_READY');
    assert.ok(output, JSON.stringify(sent));
    assert.match(output.data.messages[0].html, /data:image\/png/);
    assert.equal(top, 600);
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});

test('an HTML image timeout reports export failure without sending a partial file', async () => {
  const f = fixture();
  try {
    const w = f.w, img = w.document.querySelector('img'); state(img);
    f.roots()[0].dataset.chatArchiveSelected = 'true';
    let listener; const sent = [];
    w.matchMedia = () => ({ matches: false });
    w.browser = { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async x => { sent.push(x); return { ok: true }; } } };
    for (const file of ['content/extract.js', 'content/content.js']) w.eval(read(file));
    await listener({ type: 'BEGIN_EXPORT', job: { format: 'html', filename: 'test.html', options: { selectedOnly: true } } });
    await f.clock.tickAsync(61000);
    assert.equal(sent.some(x => x.type === 'EXPORT_READY'), false);
    assert.equal(sent.some(x => x.type === 'EXPORT_FAILED'), true);
    const status = (await listener({ type: 'PING' })).exportStatus;
    assert.equal(status.state, 'error'); assert.match(status.label, /Images did not finish loading/);
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});
