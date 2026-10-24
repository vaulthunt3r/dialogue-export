const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvXkAAAAASUVORK5CYII=';
function fixture(body) {
  const dom = new JSDOM(`<main><div data-chatgpt-selection-message-id="answer">${body}</div></main>`, { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  for (const file of ['content/media.js', 'content/extract.js', 'shared/renderers.js']) dom.window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  return dom;
}
test('image-only messages and linked attachment buttons survive HTML with links disabled', () => {
  const d = fixture(`<button><a href="https://example.com/file"><picture><source srcset="https://example.com/other"><img alt="Attachment" src="${pixel}" loading="lazy" srcset="https://example.com/other 2x"></picture></a></button>`);
  try {
    const data = d.window.ChatArchiveExtractor.collect({ includeLinks: false });
    assert.equal(data.messages.length, 1);
    assert.match(data.messages[0].text, /Image: Attachment/);
    const html = d.window.ChatArchiveRenderers.html(data);
    const parsed = new JSDOM(html);
    assert.equal(parsed.window.document.querySelector('img').src, pixel);
    assert.equal(parsed.window.document.querySelector('button,a,source,[srcset],[loading]'), null);
    parsed.window.close();
  } finally { d.window.close(); }
});
test('static SVG becomes an embedded image, with scripts and external resources removed', () => {
  const d = fixture('<svg width="400" height="200" viewBox="0 0 400 200"><title>Flow chart</title><script>alert(1)</script><rect width="100" height="50" fill="red" onclick="alert(1)"/><text x="10" y="30">Step one</text><use href="https://example.com/external.svg#x"/></svg><svg width="16" height="16"><path d="M0 0"/></svg>');
  try {
    const data = d.window.ChatArchiveExtractor.collect();
    const output = new JSDOM(data.messages[0].html);
    const images = output.window.document.querySelectorAll('img');
    assert.equal(images.length, 1);
    const svg = decodeURIComponent(images[0].src.split(',')[1]);
    assert.match(svg, /Step one/);
    assert.doesNotMatch(svg, /onclick|script|example.com/);
    assert.match(data.messages[0].text, /embedded or interactive/);
    output.window.close();
  } finally { d.window.close(); }
});
test('canvas pixels are captured; unreadable canvas produces a visible notice', () => {
  const d = fixture('<canvas width="200" height="100"></canvas>');
  try {
    const c = d.window.document.querySelector('canvas');
    c.toDataURL = () => pixel;
    assert.match(d.window.ChatArchiveExtractor.collect().messages[0].html, /data:image\/png/);
    c.toDataURL = () => { throw new Error('Tainted'); };
    assert.match(d.window.ChatArchiveExtractor.collect().messages[0].text, /could not be embedded/);
  } finally { d.window.close(); }
});
test('unreadable remote images are explicitly linked; ephemeral blob URLs are not exported', () => {
  const d = fixture('<img src="/image.png" alt="Remote"><img src="blob:https://chatgpt.com/expired" alt="Temporary">');
  try {
    const item = d.window.ChatArchiveExtractor.collect().messages[0];
    assert.match(item.html, /src="https:\/\/chatgpt.com\/image.png"/);
    assert.match(item.text, /linked, not embedded/);
    assert.match(item.text, /Temporary: Visual content could not be embedded/);
    assert.doesNotMatch(item.html, /blob:/);
  } finally { d.window.close(); }
});

test('hidden media is excluded and unsupported SVG resources produce a notice', () => {
  const d = fixture(`<div style="display:none"><img src="${pixel}" alt="Hidden"></div><svg width="100" height="100"><use href="https://example.com/remote.svg#node"/></svg>`);
  try {
    const item = d.window.ChatArchiveExtractor.collect().messages[0];
    assert.doesNotMatch(item.html, /Hidden|example.com/);
    assert.match(item.text, /could not be saved/);
  } finally { d.window.close(); }
});

test('generated galleries become flowing figures without fixed-height carousel wrappers', () => {
  const d = fixture(`<p>Before</p><div class="group/generated-image-gallery-controls" style="height:360px;overflow:hidden"><div style="height:360px;transform:translateX(-10px)"><div data-web-image-tile><button><img src="${pixel}" alt="First"></button></div><div data-web-image-tile><button><img src="${pixel}" alt="Second"></button></div></div><button>Next</button></div><p>After</p>`);
  try {
    const original = d.window.document.querySelector('[data-chatgpt-selection-message-id]').innerHTML;
    const item = d.window.ChatArchiveExtractor.collect().messages[0];
    const output = new JSDOM(item.html);
    assert.deepEqual([...output.window.document.images].map(img => img.alt), ['First', 'Second']);
    assert.equal(output.window.document.querySelector('[style],button,[data-web-image-tile]'), null);
    assert.deepEqual([...output.window.document.body.children].map(el => el.tagName), ['P', 'FIGURE', 'FIGURE', 'P']);
    assert.match(item.text, /Before[\s\S]*First[\s\S]*Second[\s\S]*After/);
    assert.equal(d.window.document.querySelector('[data-chatgpt-selection-message-id]').innerHTML, original);
    output.window.close();
  } finally { d.window.close(); }
});
