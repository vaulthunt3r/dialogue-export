const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=';
function fixture(body = `<img src="${pixel}" loading="lazy">`) {
  const dom = new JSDOM(`<main><div data-chatgpt-selection-message-id="answer">${body}</div></main>`, { url: 'https://chatgpt.com/c/memory', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  let send; const sent = [];
  w.matchMedia = () => ({ matches: false });
  w.browser = { runtime: { onMessage: { addListener: fn => { send = fn; } }, sendMessage: async request => { sent.push(request); return { ok: true }; } } };
  for (const file of ['content/media.js', 'content/extract.js', 'content/content.js']) w.eval(read(file));
  const roots = () => w.ChatArchiveExtractor.nodes().map((node, index) => ({ node, owner: w.ChatArchiveExtractor.idOf(node, index) }));
  return { w, clock, roots, sent, send: request => send(request), close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}
function loaded(img, width = 1, height = 1) {
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: width }, naturalHeight: { value: height } });
  img.decode = async () => {};
}
const job = { format: 'html', filename: 'memory.html', options: { selectedOnly: true } };

test('image dimensions are budgeted before decode or canvas allocation', async () => {
  const f = fixture();
  try {
    const img = f.w.document.querySelector('img'); loaded(img, 6000, 6000);
    let decoded = false; img.decode = async () => { decoded = true; };
    f.w.ChatArchiveMedia.beginExport();
    await assert.rejects(f.w.ChatArchiveMedia.waitForImages(f.roots), /image memory limit/);
    assert.equal(decoded, false);
    assert.equal(img.getAttribute('loading'), 'lazy');
    f.w.ChatArchiveMedia.endExport();
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 0);
  } finally { f.close(); }
});

test('repeated scans and remounts charge the same media once; distinct assets stay bounded', async () => {
  const f = fixture();
  try {
    f.w.ChatArchiveMedia.beginExport();
    loaded(f.w.document.querySelector('img'), 1448, 1086);
    for (let pass = 0; pass < 3; pass++) {
      await f.w.ChatArchiveMedia.waitForImages(f.roots);
      f.w.ChatArchiveExtractor.collect({ outputFormat: 'html' });
      const image = f.w.document.querySelector('img'), next = image.cloneNode(true);
      loaded(next, 1448, 1086); image.replaceWith(next);
    }
    const usage = f.w.ChatArchiveMedia.resourceUsage();
    assert.equal(usage.assets, 1); assert.equal(usage.pixels, 1448 * 1086); assert.equal(usage.imageCharacters, pixel.length);
    f.roots()[0].node.innerHTML = Array.from({ length: 129 }, () => `<img src="${pixel}">`).join('');
    await assert.rejects(f.w.ChatArchiveMedia.waitForImages(f.roots), /image memory limit/);
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 128);
  } finally { f.close(); }
});

test('only two new decodes run at once, including across virtualizer remounts', async () => {
  const f = fixture(Array.from({ length: 5 }, () => `<img src="${pixel}" loading="lazy">`).join(''));
  try {
    const pending = []; let running = 0, maximum = 0;
    const setup = img => { loaded(img); img.decode = () => { running++; maximum = Math.max(maximum, running); return new Promise(resolve => pending.push(() => { running--; resolve(); })); }; };
    [...f.w.document.images].forEach(setup);
    f.w.ChatArchiveMedia.beginExport();
    const task = f.w.ChatArchiveMedia.waitForImages(f.roots);
    await f.clock.tickAsync(1); assert.equal(pending.length, 2);
    const first = f.w.document.querySelector('img'), replacement = first.cloneNode(true);
    replacement.setAttribute('loading', 'lazy'); setup(replacement); first.replaceWith(replacement);
    await f.clock.tickAsync(200); assert.equal(running, 2);
    while (pending.length) { pending.splice(0).forEach(resolve => resolve()); await f.clock.tickAsync(250); }
    await task;
    assert.equal(maximum, 2);
    assert.ok([...f.w.document.images].every(img => img.getAttribute('loading') === 'lazy'));
  } finally { f.close(); }
});

test('HTML/PDF omit the duplicate Markdown image payload, while JSON retains its schema', () => {
  const f = fixture();
  try {
    for (const format of ['html', 'pdf', 'txt', 'md', 'json']) {
      const item = f.w.ChatArchiveExtractor.collect({ outputFormat: format }).messages[0];
      assert.equal('html' in item, ['html', 'pdf', 'json'].includes(format));
      assert.equal('markdown' in item, ['md', 'json'].includes(format));
    }
  } finally { f.close(); }
});

test('selected export skips unselected media; completion releases captures before another export', async () => {
  const f = fixture('<img src="blob:https://chatgpt.com/fixture">');
  try {
    const root = f.roots()[0].node; root.dataset.chatArchiveSelected = 'true';
    loaded(root.querySelector('img'));
    let captures = 0; const scratch = [];
    f.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    f.w.HTMLCanvasElement.prototype.toDataURL = function () { captures++; scratch.push(this); return pixel; };
    const other = root.cloneNode(true); other.dataset.chatgptSelectionMessageId = 'other'; delete other.dataset.chatArchiveSelected;
    loaded(other.querySelector('img'), 6000, 6000); root.after(other);
    for (let i = 0; i < 2; i++) {
      await f.send({ type: 'BEGIN_EXPORT', job }); await f.clock.tickAsync(250);
      assert.equal((await f.send({ type: 'PING' })).exportStatus.state, 'done');
      assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 0);
    }
    assert.equal(captures, 2, 'a finished export must not retain its captured PNG cache');
    assert.ok(scratch.every(canvas => canvas.width === 0 && canvas.height === 0));
    assert.ok(f.sent.filter(x => x.type === 'EXPORT_READY').every(x => x.data.messages.length === 1));
  } finally { f.close(); }
});

test('Stop aborts a slow image wait, releases resources and does not hand off a partial file', async () => {
  const f = fixture();
  try {
    f.roots()[0].node.dataset.chatArchiveSelected = 'true';
    Object.defineProperty(f.w.document.querySelector('img'), 'complete', { value: false });
    await f.send({ type: 'BEGIN_EXPORT', job }); await f.clock.tickAsync(400);
    f.w.document.querySelector('.chat-archive-dismiss').click(); await f.clock.tickAsync(250);
    assert.match((await f.send({ type: 'PING' })).exportStatus.label, /Export stopped/);
    assert.equal(f.sent.some(x => x.type === 'EXPORT_READY'), false);
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 0);
    assert.equal(f.w.document.querySelector('img').getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});

test('the payload budget is cumulative across virtualized windows and resets after failure', async () => {
  const f = fixture('Small fixture');
  try {
    const host = f.w.document.querySelector('main'); let top = 900;
    Object.defineProperty(f.w.document, 'scrollingElement', { value: host });
    Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 1500 }, scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(900, value)); } } });
    const extractor = f.w.ChatArchiveExtractor, snapshot = extractor.snapshot;
    // Rope strings test the actual 16 Mi-character budget without allocating
    // large image buffers or thousands of DOM nodes.
    extractor.snapshot = () => [{ id: `m${Math.floor(top / 300)}`, role: 'assistant', text: 'x'.repeat(6 * 1024 * 1024) }];
    await f.send({ type: 'BEGIN_EXPORT', job: { ...job, options: {} } }); await f.clock.tickAsync(30000);
    assert.match((await f.send({ type: 'PING' })).exportStatus.label, /content memory limit/);
    assert.equal(f.sent.some(x => x.type === 'EXPORT_READY'), false);
    assert.equal(top, 900);
    extractor.snapshot = snapshot; f.roots()[0].node.dataset.chatArchiveSelected = 'true';
    await f.send({ type: 'BEGIN_EXPORT', job }); await f.clock.tickAsync(250);
    assert.equal((await f.send({ type: 'PING' })).exportStatus.state, 'done');
  } finally { f.close(); }
});

function background() {
  let send, changed, created = 0, revoked = [], nextId = 0, tabs = [], failDownload = false, failTab = false;
  const context = vm.createContext({ setTimeout, clearTimeout, Date, Promise, URL: { createObjectURL: () => `blob:${++created}`, revokeObjectURL: url => revoked.push(url) }, Blob: class {}, crypto: { randomUUID: () => `job${tabs.length}` },
    ChatArchiveRenderers: { html: data => data.messages[0]?.html || '<main>Small document</main>' },
    browser: { runtime: { getURL: path => `https://extension.invalid/${path}`, onMessage: { addListener: fn => { send = fn; } } },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      downloads: { onChanged: { addListener: fn => { changed = fn; } }, download: async () => { if (failDownload) throw Error('Save cancelled'); return nextId++; } },
      tabs: { create: async ({ url }) => { if (failTab) throw Error('Tab failed'); tabs.push(url); return { id: tabs.length }; } } } });
  const clock = FakeTimers.withGlobal(context).install({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vm.runInContext(read('background.js'), context);
  return { send: req => send(req), change: delta => changed(delta), clock, tabs, revoked, failDownload: () => { failDownload = true; }, failTab: value => { failTab = value; }, created: () => created, close: () => clock.uninstall() };
}
test('download URLs release only on terminal states, including ID zero, failures and fallback timeout', async () => {
  const b = background();
  try {
    const req = { type: 'DOWNLOAD_FILE', content: 'Small document', mime: 'text/plain', filename: 'test.txt' };
    assert.equal((await b.send(req)).downloadId, 0);
    b.change({ id: 0, state: { current: 'in_progress' } }); assert.equal(b.revoked.length, 0);
    b.change({ id: 0, state: { current: 'complete' } }); assert.equal(b.revoked.length, 1);
    await b.send(req); await b.clock.tickAsync(10 * 60 * 1000); assert.equal(b.revoked.length, 2);
    b.failDownload(); await assert.rejects(b.send(req), /Save cancelled/); assert.equal(b.revoked.length, 3);
  } finally { b.close(); }
});
test('print handoff consumes its payload once; abandoned and failed jobs release their budget', async () => {
  const b = background();
  try {
    const req = { type: 'OPEN_PRINT_PAGE', content: 'x'.repeat(16 * 1024 * 1024) };
    await b.send(req); await b.send(req);
    await assert.rejects(b.send(req), /Previous exports/);
    const id = new URL(b.tabs[0]).searchParams.get('id');
    assert.equal((await b.send({ type: 'GET_PRINT_PAGE', id })).content.length, req.content.length);
    assert.equal((await b.send({ type: 'GET_PRINT_PAGE', id })).ok, false);
    await b.send(req); await b.clock.tickAsync(60001);
    assert.equal((await b.send({ type: 'GET_PRINT_PAGE', id: 'job1' })).ok, false);
    b.failTab(true); await assert.rejects(b.send(req), /Tab failed/);
    b.failTab(false); await b.send(req); await b.send(req);
  } finally { b.close(); }
});
test('oversized input fails before rendering or creating a download Blob', async () => {
  const b = background();
  try {
    const result = await b.send({ type: 'EXPORT_READY', job, data: { messages: [{ html: 'x'.repeat(16 * 1024 * 1024 + 1) }] } });
    assert.equal(result.ok, false); assert.match(result.error, /content memory limit/); assert.equal(b.created(), 0);
  } finally { b.close(); }
});
