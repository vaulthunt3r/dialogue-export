const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=';
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function fixture(body) {
  const dom = new JSDOM(`<main><div data-turn-key="one"><div data-chatgpt-selection-message-id="answer" data-chat-archive-selected="true">${body}</div></div></main>`, { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, sent = []; let listener;
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  w.matchMedia = () => ({ matches: false });
  w.browser = { runtime: { onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async req => { sent.push(req); return { ok: true }; } } };
  for (const file of ['content/media.js', 'content/extract.js', 'content/content.js', 'shared/renderers.js']) w.eval(read(file));
  return { w, clock, sent, send: req => listener(req), close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}
function imageState(img, ready = false) {
  Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: ready ? 1 : 0 }, naturalHeight: { value: ready ? 1 : 0 } });
  img.decode = () => { throw Error('Unexpected decode'); };
}
async function exportFixture(f, format = 'html', includeActivity = false) {
  await f.send({ type: 'BEGIN_EXPORT', job: { format, filename: `test.${format}`, options: { selectedOnly: true, includeLinks: true, includeActivity } } });
  await f.clock.tickAsync(500);
  return { status: (await f.send({ type: 'PING' })).exportStatus, output: f.sent.find(req => req.type === 'EXPORT_READY') };
}

for (const format of ['html', 'pdf']) test(`${format}: text with broken site icons exports automatically without loading or capturing icons`, async () => {
  const f = fixture('<p>Plain answer with <a href="https://example.com/source"><img class="icon-xs" src="https://www.google.com/s2/favicons?domain=example.com&sz=128" loading="lazy">source citation</a>.</p><span><img class="icon-sm" src="https://example.com/icon" loading="lazy"></span><img role="presentation" src="https://example.com/decoration">');
  try {
    [...f.w.document.images].forEach(img => imageState(img));
    const source = f.w.document.querySelector('[data-chatgpt-selection-message-id]');
    const original = source.innerHTML;
    const { status, output } = await exportFixture(f, format);
    assert.equal(status.state, 'done', status.label);
    assert.ok(output);
    const message = output.data.messages[0];
    assert.match(message.text, /Plain answer with source citation/);
    assert.match(message.html, /https:\/\/example.com\/source/);
    assert.doesNotMatch(message.html, /<img|<figure|favicon|could not|linked, not embedded/);
    assert.equal(source.innerHTML, original, 'source attributes and links stay untouched');
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 0);
  } finally { f.close(); }
});

for (const includeActivity of [false, true]) test(`activity media removed from the output cannot block image readiness (activity=${includeActivity})`, async () => {
  const f = fixture('<div><div class="group/activity-header"><button aria-expanded="true" aria-labelledby="worked"></button><span id="worked">Worked for 24s</span><img src="https://example.com/header-icon"></div><div><p>Checking sources.</p><img src="https://example.com/activity-thumbnail"><div data-web-image-tile></div></div></div><p>Final answer.</p>');
  try {
    [...f.w.document.images].forEach(img => imageState(img));
    const { status, output } = await exportFixture(f, 'html', includeActivity);
    assert.equal(status.state, 'done', status.label);
    const message = output.data.messages[0];
    assert.equal(message.text, 'Final answer.');
    assert.doesNotMatch(message.html, /<img|Checking sources/);
    if (includeActivity) {
      assert.match(message.activities[0].text, /Checking sources/);
      assert.doesNotMatch(message.activities[0].html, /<img/);
    } else assert.equal(message.activities, undefined);
  } finally { f.close(); }
});

test('small content and icon-styled attachments still wait and export with the right accounting', async () => {
  const f = fixture(`<img class="icon-xs" src="https://example.com/broken-icon"><img src="${pixel}" width="1" height="1" alt=""><div data-web-image-tile><button><img class="icon-xs" src="${pixel}" alt="Attachment"></button></div>`);
  try {
    const images = [...f.w.document.images];
    imageState(images[0]);
    let decodes = 0;
    images.slice(1).forEach(img => { imageState(img, true); img.decode = async () => { decodes++; }; });
    f.w.ChatArchiveMedia.beginExport();
    const e = f.w.ChatArchiveExtractor;
    await f.w.ChatArchiveMedia.waitForImages(() => e.nodes().map((node, i) => ({ node, owner: e.idOf(node, i), excludedRoots: e.mediaExclusions(node) })));
    const data = e.collect({ outputFormat: 'html' });
    assert.equal(decodes, 2);
    const parsed = new JSDOM(data.messages[0].html);
    assert.equal(parsed.window.document.images.length, 2);
    assert.equal(parsed.window.document.images[1].alt, 'Attachment');
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().assets, 2);
    assert.equal(f.w.ChatArchiveMedia.resourceUsage().pixels, 2);
    parsed.window.close();
  } finally { f.close(); }
});

test('a broken unclassified content image still fails, even with empty alt and tiny dimensions', async () => {
  const f = fixture('<p>Text</p><img src="https://example.com/content.png" width="1" height="1" alt="">');
  try {
    imageState(f.w.document.querySelector('img'));
    const { status, output } = await exportFixture(f);
    assert.equal(status.state, 'error'); assert.match(status.label, /An image failed to load/);
    assert.equal(output, undefined);
  } finally { f.close(); }
});

test('unstyled favicon controls are omitted, while favicon URLs in explicit pictures remain content', async () => {
  const src = 'https://www.google.com/s2/favicons?domain=example.com&sz=128';
  const f = fixture(`<a href="https://example.com/source"><img src="${src}">Source</a><picture><img src="${src}" alt="Example favicon" class="icon-xs"></picture>`);
  try {
    const [icon, picture] = f.w.document.images;
    imageState(icon); icon.getBoundingClientRect = () => ({ width: 16, height: 16 });
    imageState(picture, true); picture.decode = async () => {};
    f.w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    f.w.HTMLCanvasElement.prototype.toDataURL = () => pixel;
    const { status, output } = await exportFixture(f);
    assert.equal(status.state, 'done', status.label);
    const parsed = new JSDOM(output.data.messages[0].html);
    assert.equal(parsed.window.document.images.length, 1);
    assert.equal(parsed.window.document.images[0].alt, 'Example favicon');
    assert.equal(parsed.window.document.querySelector('a').textContent, 'Source');
    parsed.window.close();
  } finally { f.close(); }
});

for (const format of ['html', 'pdf']) test(`${format}: blocked gstatic faviconV2 in a citation span is not a content image`, async () => {
  const f = fixture('<p>Plain answer <span><img src="https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://example.com&size=32" loading="lazy">Source</span></p>');
  try {
    const img = f.w.document.querySelector('img'); imageState(img);
    // Failed image has no loaded dimensions or rendered box, no icon class,
    // no button/anchor, and no presentation role. URL requests a 32px favicon.
    const { status, output } = await exportFixture(f, format);
    assert.equal(status.state, 'done', status.label);
    assert.match(output.data.messages[0].text, /Plain answer Source/);
    assert.doesNotMatch(output.data.messages[0].html, /<img|favicon|linked, not embedded/);
    assert.equal(img.getAttribute('loading'), 'lazy');
  } finally { f.close(); }
});

test('a normal image named favicon or a lookalike host is not discarded', async () => {
  for (const src of ['https://example.com/faviconV2?size=32', 'https://t0.gstatic.com.evil.invalid/faviconV2?size=32', 'https://t0.gstatic.com/photo.png?size=32']) {
    const f = fixture(`<img src="${src}" alt="Content">`);
    try {
      imageState(f.w.document.querySelector('img'));
      const { status } = await exportFixture(f);
      assert.equal(status.state, 'error'); assert.equal(status.mediaDiagnostic.phase, 'load');
    } finally { f.close(); }
  }
});

test('failure metadata survives removal of the offending node without including private values', async () => {
  const f = fixture('<p>PRIVATE_TEXT</p><img src="https://private.invalid/PRIVATE_PATH?key=PRIVATE_TOKEN" alt="PRIVATE_ALT" class="PRIVATE_CLASS">');
  try {
    const img = f.w.document.querySelector('img'); imageState(img);
    const { status } = await exportFixture(f);
    img.remove();
    assert.equal(status.state, 'error');
    const diagnostic = f.w.document.querySelector('.chat-archive-image-diagnostic pre').textContent;
    assert.doesNotMatch(diagnostic, /PRIVATE|private\.invalid|https:\/\//);
    assert.equal(JSON.parse(diagnostic).phase, 'load');
    assert.equal(JSON.parse(diagnostic).ancestors[0].tag, 'img');
    assert.equal((await f.send({ type: 'PING' })).exportStatus.mediaDiagnostic.sourceKind, 'https');
  } finally { f.close(); }
});
