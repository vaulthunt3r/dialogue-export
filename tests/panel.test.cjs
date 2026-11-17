const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture({ invalidIds = false, mediaRight = 1200 } = {}) {
  const dom = new JSDOM(`<main><article data-testid="conversation-turn-0" data-right="1920"><div data-chatgpt-search-message-ids="image" data-right="1920"><div data-web-image-tile><img data-right="${mediaRight}"></div></div></article><form data-right="1654"><div id="prompt-textarea"></div></form></main>`, { url: 'https://chatgpt.com/c/fixture', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.innerWidth = 1920; w.innerHeight = 1080;
  w.browser = { runtime: { getURL: name => 'https://extension.invalid/' + name } };
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const right = Number(this.dataset.right || 0);
    return { left: 694, right, top: 120, bottom: 800, width: Math.max(0, right - 694), height: right ? 680 : 0 };
  };
  let calls = 0;
  w.ChatArchiveExtractor = { nodes() { calls++; if (invalidIds) throw Error('Image identifier unavailable'); return [w.document.querySelector('[data-chatgpt-search-message-ids]')]; } };
  w.eval(fs.readFileSync(path.join(__dirname, '../content/panel.js'), 'utf8'));
  return { w, get calls() { return calls; }, dock: () => w.document.querySelector('.chat-archive-dock'), close() { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}

test('an image inside a full-width turn leaves the actual right gutter available', () => {
  const f = fixture(); try {
    f.w.ChatArchivePanel.mount();
    assert.equal(f.dock().dataset.unavailable, 'false');
    assert.equal(f.dock().dataset.room, 'true');
  } finally { f.close(); }
});

test('launcher layout does not invoke export identifier validation', () => {
  const f = fixture({ invalidIds: true }); try {
    assert.doesNotThrow(() => f.w.ChatArchivePanel.mount());
    assert.equal(f.calls, 0);
    assert.equal(f.dock().dataset.room, 'true');
  } finally { f.close(); }
});

test('wide visible media still prevents overlap; a hidden retained turn does not', () => {
  const f = fixture({ mediaRight: 1900 }); try {
    f.w.ChatArchivePanel.mount();
    assert.equal(f.dock().dataset.unavailable, 'true');
    f.w.document.querySelector('article').setAttribute('aria-hidden', 'true');
    f.w.ChatArchivePanel.layout();
    assert.equal(f.dock().dataset.room, 'true');
  } finally { f.close(); }
});
