const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fixture(extra = '') {
  const d = new JSDOM(`<style>${read('tests/fixtures/components.css')}</style><main><div data-chatgpt-selection-message-id="card-answer">${read('tests/fixtures/tariff-card.html')}${extra}</div></main>`, { url: 'https://chatgpt.com/c/fixture', runScripts: 'outside-only' });
  for (const file of ['content/extract.js', 'shared/renderers.js']) d.window.eval(read(file));
  return d;
}

test('rendered text cards keep empty chart bars, responsive proportions and layout with images disabled', () => {
  for (const outputFormat of ['html', 'pdf']) {
    const d = fixture();
    try {
      const data = d.window.ChatArchiveExtractor.collect({ outputFormat, includeAssistantImages: false });
      const result = new JSDOM(d.window.ChatArchiveRenderers.html(data));
      try {
        const doc = result.window.document;
        const fills = [...doc.querySelectorAll('[data-d-has-width][data-d-has-height]')];
        assert.deepEqual(fills.map(el => el.style.width), ['10%', '30%', '50%', '100%']);
        for (const fill of fills) {
          assert.equal(fill.style.height, '12px');
          assert.equal(fill.style.backgroundColor, 'rgb(22, 163, 74)');
          assert.equal(fill.parentElement.style.height, '12px');
          assert.equal(fill.parentElement.style.flexGrow, '1');
        }
        assert.equal(doc.querySelector('[data-d-component="card"]').style.flexDirection, 'column');
        assert.equal(doc.querySelector('[data-d-component="spacer"]').style.flexGrow, '1');
        assert.equal(doc.querySelector('[data-d-text-align="end"]').style.textAlign, 'end');
        assert.match(doc.body.textContent, /Самые выгодные тарифы для интернета/);
        assert.match(doc.body.textContent, /100 ГБ/);
        assert.match(doc.querySelector('style').textContent, /print-color-adjust:exact/);
      } finally { result.window.close(); }
    } finally { d.window.close(); }
  }
});

test('component styling drops resource URLs, positioning and clipping without styling code samples', () => {
  const d = fixture('<div data-d-component="card" style="position:fixed;overflow:hidden;background-image:url(https://example.invalid/image);height:20px"><p style="color:rgb(12,34,56)">Long readable content</p><button onclick="alert(1)">Passive label</button><span style="display:none">Hidden content</span></div><pre><code>&lt;card&gt;literal&lt;/card&gt;</code></pre>');
  try {
    const html = d.window.ChatArchiveExtractor.collect({ outputFormat: 'html' }).messages[0].html;
    assert.doesNotMatch(html, /position:|overflow:|background-image:|example.invalid|onclick|<button|Hidden content/);
    const result = new JSDOM(html);
    try {
      const last = [...result.window.document.querySelectorAll('[data-d-component="card"]')].at(-1);
      assert.equal(last.style.height, '');
      assert.match(last.textContent, /Passive label/);
      assert.equal(result.window.document.querySelector('code').classList.contains('chat-archive-component'), false);
      assert.equal(last.querySelector('p').style.color, 'rgb(12, 34, 56)');
    } finally { result.window.close(); }
  } finally { d.window.close(); }
});

test('table edge overlays never add blank blocks while real content and chart bars remain', () => {
  const d = fixture(read('tests/fixtures/component-table.html'));
  try {
    const frame = d.window.document.querySelector('[data-d-component="table"]');
    frame.insertAdjacentHTML('beforeend', '<div class="Edges-note">A real table note</div><div class="table-footer">Footer</div><div class="Edges-media"><img alt="Attached diagram"></div>');
    d.window.document.querySelector('[data-chatgpt-selection-message-id]').insertAdjacentHTML('beforeend','<div class="Edges-outside" style="height:50px"></div>');
    const originalText = frame.textContent;
    for (const outputFormat of ['html', 'pdf']) {
      const data = d.window.ChatArchiveExtractor.collect({ outputFormat });
      const result = new JSDOM(d.window.ChatArchiveRenderers.html(data));
      try {
        const doc = result.window.document;
        assert.equal(doc.querySelector('.Edges-example'), null);
        assert.equal(doc.querySelectorAll('table').length, 1);
        assert.equal(doc.querySelector('[data-d-component="table"]').textContent, originalText);
        assert.ok(doc.querySelector('.Edges-note'));
        assert.ok(doc.querySelector('.Edges-media img'));
        assert.ok(doc.querySelector('.table-footer'));
        assert.ok(doc.querySelector('.Edges-outside'), 'same-named elements outside a table frame are not removed');
        assert.equal(doc.querySelectorAll('[data-d-has-width][data-d-has-height]').length,4);
        assert.match(doc.querySelector('style').textContent,/td>:first-child\{margin-top:0\}/);
      } finally { result.window.close(); }
    }
  } finally { d.window.close(); }
});
