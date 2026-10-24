const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const source = fs.readFileSync(path.join(__dirname, '../scripts/image-failure-diagnostics.js'), 'utf8');
test('image failure report excludes private values and copies only bounded structural metadata', () => {
  const d = new JSDOM('<main><div data-chatgpt-selection-message-id="PRIVATE_ID" class="PRIVATE_CLASS"><p>PRIVATE_TEXT</p><img src="https://private.invalid/PRIVATE_PATH?token=PRIVATE_TOKEN" alt="PRIVATE_ALT" class="icon-xs PRIVATE_IMAGE_CLASS"></div></main><div class="chat-archive-progress" data-state="error">PRIVATE_ERROR</div>', { url: 'https://chatgpt.com/c/PRIVATE_CHAT', runScripts: 'outside-only' });
  try {
    const w = d.window, img = w.document.querySelector('img'); let copied;
    Object.defineProperty(img, 'complete', { value: true });
    w.copy = value => { copied = value; };
    w.fetch = () => { throw Error('No network allowed'); };
    const before = w.document.documentElement.outerHTML;
    w.eval(source);
    assert.ok(copied); assert.doesNotMatch(copied, /PRIVATE|private\.invalid|https:\/\/|token=/);
    const item = JSON.parse(copied).samples[0].candidates[0];
    assert.equal(item.inMessage, true); assert.equal(item.sourceKind, 'https');
    assert.deepEqual(item.ancestors[0].classes, ['icon-xs']);
    assert.equal(w.document.documentElement.outerHTML, before);
  } finally { d.window.close(); }
});
test('recorder observes later failure, stops and retains at most six bounded snapshots', async () => {
  const d = new JSDOM('<main><div><img src="https://example.com/unavailable"></div></main><div class="chat-archive-progress" data-state="running"></div>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  const w = d.window, clock = FakeTimers.withGlobal(w).install({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  try {
    let complete = false, copied; const img = w.document.querySelector('img');
    Object.defineProperty(img, 'complete', { get: () => complete });
    w.copy = value => { copied = value; };
    w.eval(source);
    await clock.tickAsync(500); assert.equal(copied, undefined);
    complete = true; w.document.querySelector('.chat-archive-progress').dataset.state = 'error';
    await clock.tickAsync(250);
    const data = JSON.parse(copied);
    assert.equal(data.samples.at(-1).failed, 1); assert.ok(data.samples.length <= 6);
    assert.equal(clock.countTimers(), 0);
  } finally { clock.uninstall(); w.close(); }
});

test('exact saved failure is copied after virtualization removes the image and values are allowlisted', () => {
  const d = new JSDOM('<main>No images remain</main><div class="chat-archive-progress" data-state="error"><details class="chat-archive-image-diagnostic"><pre></pre></details></div>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  try {
    const w = d.window; let copied;
    w.document.querySelector('pre').textContent = JSON.stringify({ version: 1, phase: 'load', sourceKind: 'https://PRIVATE', naturalSize: [0, 0], ancestors: [{ tag: 'img', imageTile: true, url: 'PRIVATE' }, { tag: 'PRIVATE' }], secret: 'PRIVATE' });
    w.copy = value => { copied = value; }; w.eval(source);
    assert.ok(copied); assert.doesNotMatch(copied, /PRIVATE/);
    const data = JSON.parse(copied).samples[0];
    assert.equal(data.failed, 0); assert.equal(data.extensionFailure.phase, 'load');
    assert.equal(data.extensionFailure.sourceKind, 'other');
    assert.equal(data.extensionFailure.ancestors[0].imageTile, true);
  } finally { d.window.close(); }
});
