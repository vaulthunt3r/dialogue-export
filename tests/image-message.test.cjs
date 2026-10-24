const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=';
const tile = `<div data-web-image-tile data-image-transparency-backdrop-scope><button aria-hidden="false"><img src="${pixel}" alt="Generated shapes"></button><button>Download</button><button>Share</button></div>`;
const unit = (id, content = tile) => `<div data-chatgpt-search-message-ids="${id}">${content}</div>`;
// Structural facts from the anonymized report: the image unit has no ordinary
// message marker; its enclosing turn also contains a separate user bubble.
const turn = (id, attrs = '') => `<div data-turn-key="turn-${id}" ${attrs}><div data-content-search-turn-key="turn-${id}"><div data-talvt-turn-state><div><div data-chatgpt-search-message-ids="question-${id}"><div data-user-message-bubble>Make an image</div></div><div>${unit(id)}</div></div></div></div></div>`;
function fixture(body) {
  const d = new JSDOM(`<main hidden>Home</main><main></main><main>${body}</main><nav><img src="${pixel}" alt="Avatar"></nav>`, { url: 'https://chatgpt.com/c/fixture', runScripts: 'outside-only' });
  for (const file of ['content/media.js', 'content/extract.js', 'shared/renderers.js']) d.window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  return d;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('standalone generated image units retain their own message between questions in DOM order', () => {
  const d = fixture(turn('image-1') + '<div data-turn-key="later"><div data-user-message-bubble>Next question</div><div data-chatgpt-selection-message-id="answer">Next answer</div></div>');
  try {
    const e = d.window.ChatArchiveExtractor, messages = plain(e.snapshot());
    assert.deepEqual(messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
    assert.match(messages[1].id, /image-1/);
    assert.match(messages[1].html, /data:image\/png/);
    assert.doesNotMatch(messages[1].text, /Download|Share|Make an image|Avatar/);
    assert.equal(new JSDOM(messages[1].html).window.document.querySelectorAll('img').length, 1);
    e.nodes()[1].dataset.chatArchiveSelected = 'true';
    assert.deepEqual(plain(e.collect({ selectedOnly: true }).messages).map(m => m.id), [messages[1].id]);
    const html = d.window.ChatArchiveRenderers.html(e.collect());
    assert.equal(new JSDOM(html).window.document.querySelectorAll('article').length, 4);
    d.window.document.querySelector('main:last-of-type').innerHTML = turn('image-2') + turn('image-1');
    assert.equal(e.snapshot()[3].id, messages[1].id, 'identity survives remounts and a different viewport position');
  } finally { d.window.close(); }
});

test('tiles already inside user or assistant messages are not counted twice or relabelled', () => {
  const d = fixture(`<div data-turn-key="turn"><div data-user-message-bubble>${tile}</div><div data-chatgpt-selection-message-id="answer">${unit('image', tile + tile)}</div></div>`);
  try {
    const messages = plain(d.window.ChatArchiveExtractor.snapshot());
    assert.deepEqual(messages.map(m => m.role), ['user', 'assistant']);
    assert.equal(new JSDOM(messages[1].html).window.document.querySelectorAll('img').length, 2);
  } finally { d.window.close(); }
});

test('hidden image turns and unbounded previews stay excluded; foreign owners stop export', () => {
  const d = fixture(turn('old', 'hidden') + turn('inert', 'inert') + unit('unbounded') + turn('current'));
  try {
    const e = d.window.ChatArchiveExtractor;
    assert.equal(e.snapshot().length, 2);
    d.window.document.body.insertAdjacentHTML('beforeend', turn('outside-main'));
    assert.equal(e.snapshot().length, 2);
    d.window.document.querySelector('[data-turn-key="turn-current"]').setAttribute('data-chatgpt-selection-conversation-id', 'other');
    assert.throws(() => e.snapshot(), /another conversation/);
  } finally { d.window.close(); }
});

test('image units without identifiers or with shared ambiguous identifiers cannot silently merge', () => {
  const d = fixture(turn('image'));
  try {
    const e = d.window.ChatArchiveExtractor, host = d.window.document.querySelector('main:last-of-type');
    const imageUnit = host.querySelector('[data-chatgpt-search-message-ids="image"]');
    imageUnit.setAttribute('data-chatgpt-search-message-ids', '');
    assert.throws(() => e.snapshot(), /image.*identifier/i);
    host.innerHTML = turn('same') + turn('same');
    assert.throws(() => e.snapshot(), /identifier.*shared|shared.*identifier/i);
    host.innerHTML = turn('image');
    host.querySelector('[data-chatgpt-search-message-ids="image"]').setAttribute('data-chatgpt-search-message-ids', 'question-image');
    assert.throws(() => e.snapshot(), /identifier.*shared|shared.*identifier/i);
  } finally { d.window.close(); }
});
