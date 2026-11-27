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

test('status cards retain four inline vector icons and thin padded separators with either image setting', () => {
  const d = fixture(fs.readFileSync(path.join(__dirname, 'fixtures/status-card.html'), 'utf8') + `<img src="${pixel}" alt="Following attachment">`);
  try {
    const before = d.window.document.body.innerHTML;
    for (const outputFormat of ['html', 'pdf']) for (const includeAssistantImages of [true, false]) {
      const data = d.window.ChatArchiveExtractor.collect({ outputFormat, includeAssistantImages });
      const output = new JSDOM(d.window.ChatArchiveRenderers.html(data));
      try {
        const doc = output.window.document, icons = [...doc.querySelectorAll('img[data-export-icon]')];
        assert.equal(icons.length, 4);
        assert.deepEqual(icons.map(i => i.style.width), ['18px', '18px', '18px', '18px']);
        assert.ok(icons.every(i => i.style.height === '18px' && i.style.flexShrink === '0' && !i.closest('figure')));
        const vectors = icons.map(i => decodeURIComponent(i.src.split(',')[1]));
        assert.match(vectors[0], /0, 122, 51/); assert.match(vectors[2], /180, 65, 0/);
        assert.match(vectors[0], /circle/); assert.match(vectors[2], /M12 3 22 21H2Z/);
        for (const divider of doc.querySelectorAll('[data-d-component="divider"]')) {
          assert.equal(divider.style.height, '1px');
          assert.equal(divider.style.padding, '8px 0px');
          assert.equal(divider.style.backgroundClip, 'content-box');
          assert.equal(divider.style.boxSizing, 'content-box');
        }
        assert.equal(doc.querySelectorAll('figure img').length, includeAssistantImages ? 1 : 0);
        assert.doesNotMatch(data.messages[0].text, /Diagram|data:image/);
      } finally { output.window.close(); }
    }
    assert.equal(d.window.document.body.innerHTML, before);
  } finally { d.window.close(); }
});

test('semantic icon capture sanitizes handlers and still excludes hidden icons and UI controls', () => {
  const icon = '<svg data-d-component="icon" width="18" height="18" viewBox="0 0 24 24" onload="alert(1)"><path d="M2 2h20v20" onclick="alert(1)"/></svg>';
  const d = fixture(`<div data-d-component="box">Status${icon}<button aria-label="Copy">${icon}</button><span style="display:none">${icon}</span></div><svg width="18" height="18"><path d="M0 0"/></svg><img src="${pixel}" alt="After icons">`);
  try {
    const data = d.window.ChatArchiveExtractor.collect({ outputFormat: 'html' });
    const output = new JSDOM(data.messages[0].html);
    try {
      assert.equal(output.window.document.querySelectorAll('[data-export-icon]').length, 1);
      assert.equal(output.window.document.querySelector('figure img').alt, 'After icons');
      assert.doesNotMatch(decodeURIComponent(output.window.document.images[0].src), /onload|onclick|alert/);
      assert.equal(output.window.document.querySelector('button,svg'), null);
    } finally { output.window.close(); }
    d.window.document.querySelector('svg').insertAdjacentHTML('beforeend', '<use href="https://example.invalid/icon.svg#x"/>');
    assert.throws(() => d.window.ChatArchiveExtractor.collect({ outputFormat: 'html' }), /unsupported visual/);
  } finally { d.window.close(); }
});

test('HTML/PDF thumbnail cards preserve portable layout, badge styling and passive entity labels', () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/rich-cards.html'), 'utf8');
  const d = new JSDOM(html, { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  try {
    for (const file of ['content/media.js', 'content/extract.js', 'shared/renderers.js']) d.window.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    for (const img of d.window.document.images) img.src = pixel;
    const before = d.window.document.body.innerHTML;
    for (const outputFormat of ['html', 'pdf']) {
      const data = d.window.ChatArchiveExtractor.collect({ outputFormat });
      const output = new JSDOM(d.window.ChatArchiveRenderers.html(data));
      try {
        const rows = output.window.document.querySelectorAll('.chat-archive-card');
        assert.equal(rows.length, 2);
        assert.equal(rows[0].style.getPropertyValue('--export-card-width'), '136px');
        assert.equal(rows[0].querySelectorAll('figure img').length, 1);
        assert.equal(rows[0].querySelector('.entity').textContent, 'Example browser');
        assert.equal(rows[0].querySelector('.badge').style.backgroundColor, 'rgb(216, 243, 227)');
        assert.equal(rows[0].querySelector('.card-text').style.flexDirection, 'column');
        assert.equal(output.window.document.querySelector('button,script'), null);
        assert.equal(output.window.document.querySelectorAll('a').length, 3);
      } finally { output.window.close(); }
    }
    assert.equal(d.window.document.body.innerHTML, before, 'page is never restyled or rewritten');
    const noImages = d.window.ChatArchiveExtractor.collect({ outputFormat: 'html', includeAssistantImages: false });
    assert.doesNotMatch(noImages.messages[0].html, /<img/);
    assert.match(noImages.messages[0].html, /Example browser/);
  } finally { d.window.close(); }
});

test('right-hand cards drop fixed positioning, clipping and CSS resources while retaining content', () => {
  const d = fixture(`<div style="display:flex;position:fixed;top:0;height:40px;overflow:hidden;background-image:url(https://example.com/tracker)"><div><span style="background-image:url(https://example.com/tracker);color:rgb(12,34,56)">Card text</span><button onclick="alert(1)">Entity name</button></div><img width="136" height="102" alt="Preview" src="${pixel}"></div>`);
  try {
    const item = d.window.ChatArchiveExtractor.collect({ outputFormat: 'html', includeLinks: false }).messages[0];
    const output = new JSDOM(item.html);
    try {
      assert.ok(output.window.document.querySelector('.chat-archive-card-image-right'));
      assert.match(output.window.document.body.textContent, /Card text.*Entity name/);
      assert.doesNotMatch(item.html, /position:|overflow:|height: 40px|tracker|onclick|<button/);
      assert.match(item.html, /color: rgb\(12, 34, 56\)/);
    } finally { output.window.close(); }
  } finally { d.window.close(); }
});

test('hidden icons in cards never shift the original-to-clone pairing of following images', () => {
  const d = fixture(`<section style="display:flex;flex-direction:column"><div style="display:flex"><div><img width="136" height="102" alt="First" src="${pixel}"></div><div>First card<span style="display:none"><svg width="16" height="16"></svg></span></div></div><div style="display:flex"><div><img width="136" height="102" alt="Second" src="${pixel}"></div><div>Second card<span style="display:none"><svg width="16" height="16"></svg></span></div></div><p>After</p><img width="136" height="102" alt="Third" src="${pixel}"></section>`);
  try {
    const item = d.window.ChatArchiveExtractor.collect({ outputFormat: 'html' }).messages[0];
    const output = new JSDOM(item.html);
    try {
      assert.deepEqual([...output.window.document.images].map(i => i.alt), ['First', 'Second', 'Third']);
      assert.equal(output.window.document.querySelectorAll('figure[data-export-media]').length, 3);
      assert.equal(output.window.document.querySelectorAll('.chat-archive-card')[1].querySelector('img').alt, 'Second');
    } finally { output.window.close(); }
  } finally { d.window.close(); }
});
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
