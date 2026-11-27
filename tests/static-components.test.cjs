const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc', URL = `https://chatgpt.com/c/${ID}`;
const card = read('tests/fixtures/static-card.txt');
const diagram = read('tests/fixtures/static-diagram.txt');
const metrics = read('tests/fixtures/formatted-metrics.txt');
const dilImages = require('./fixtures/dil-images.cjs');
const promptCard = read('tests/fixtures/static-prompt.txt');
function raw(source, metadata = {}) { return { conversation_id: ID, title: 'Static card', current_node: 'answer', mapping: {
  root: { id: 'root', parent: null, message: null }, answer: { id: 'answer', parent: 'root', message: { id: 'answer', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: [source] }, metadata } }
} }; }
function fixture() {
  const d = new JSDOM('<main></main>', { url: URL, runScripts: 'outside-only' }), w = d.window;
  w.TextDecoder = TextDecoder;
  for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js', 'content/chatgpt-api.js', 'shared/renderers.js']) w.eval(read(file));
  return { w, close: () => w.close(), normalize: (source, options = {}, metadata) => w.ChatArchiveApi.normalize(raw(source, metadata), URL, { outputFormat: 'html', ...options }) };
}
function inspect(html, check) { const d = new JSDOM(html); try { check(d.window.document); } finally { d.window.close(); } }

test('direct status cards retain semantic icons without remote image metadata or enabled image downloads', () => {
  const f = fixture(); try {
    for (const outputFormat of ['html', 'pdf', 'json']) {
      const data = f.normalize(read('tests/fixtures/static-status-card.txt'), { outputFormat, includeAssistantImages: false });
      inspect(data.messages[0].html, doc => {
        assert.equal(doc.querySelectorAll('[data-export-icon]').length, 4);
        const vectors = [...doc.images].map(i => decodeURIComponent(i.src.split(',')[1]));
        assert.match(vectors[0], /circle.*m8 12 3 3 5-6/);
        assert.match(vectors[2], /stroke="#92400e"/);
        assert.ok([...doc.images].every(i => i.style.fontSize === '18px' && i.style.width === '1em'));
        assert.equal(doc.querySelectorAll('hr').length, 2);
      });
    }
    assert.throws(() => f.normalize('<box><icon name="PRIVATE_UNRECOGNIZED"/>Status</box>'), error => {
      assert.equal(error.sourceDiagnostic.code, 'ICON_NAME_UNSUPPORTED');
      assert.doesNotMatch(JSON.stringify(error.sourceDiagnostic), /PRIVATE_UNRECOGNIZED/);
      return true;
    });
  } finally { f.close(); }
});

test('saved body const prompt renders its exact text and whitespace without running its copy handler', () => {
  const f = fixture(); try {
    for (const outputFormat of ['html', 'pdf', 'json']) {
      const data = f.normalize('Before\n\n' + promptCard + '\n\nAfter', { outputFormat });
      inspect(data.messages[0].html, doc => {
        const prompt = [...doc.querySelectorAll('[data-d-component="text"]')].find(n => n.style.whiteSpace === 'pre-wrap');
        assert.ok(prompt);
        assert.equal(prompt.textContent, 'First paragraph.\n\nSecond paragraph with two  spaces.\n  Indented line.\n\nLiteral <script>text</script> and **asterisks**.');
        assert.match(doc.body.textContent, /Before[\s\S]*Copy prompt[\s\S]*After/);
        assert.equal(doc.querySelector('script,button,[onclick]'), null);
        assert.doesNotMatch(doc.body.textContent, /\{@body|GenUI\.copy|\{prompt\}/);
      });
    }
  } finally { f.close(); }
});

test('body const bindings are sequential, scoped to their layout and isolated between loop iterations', () => {
  const f = fixture(); try {
    const source = '<box>{@body const value = "outer";}<text>{value}</text><box>{@body const value = "inner"}<text>{value}</text></box><text>{value}</text>{#each [1,2] as n}<box>{@body const doubled = n * 2}<text>{doubled}</text></box>{/each}</box>';
    inspect(f.normalize(source).messages[0].html, doc => assert.deepEqual([...doc.querySelectorAll('[data-d-component="text"]')].map(n => n.textContent), ['outer', 'inner', 'outer', '2', '4']));
    for (const source of [
      '<box>{@body const value = "inner"}</box>\n\n<box><text>{value}</text></box>',
      '<box><box>{@body const value = "inner"}</box><text>{value}</text></box>',
      '<box><text>{value}</text>{@body const value = "later"}</box>',
      '<box>{@body const value = 1}{@body const value = 2}</box>'
    ]) assert.throws(() => f.normalize(source), /unsupported/);
  } finally { f.close(); }
});

test('body statements cannot execute JavaScript, mutate state, access globals or change literal examples', () => {
  const f = fixture(); try {
    for (const statement of [
      'const value = alert(1)', 'const value = globalThis.document', 'const value = (()=>1)()',
      'let value = 1', 'const value = 1; globalThis.EXECUTED = true', 'const {value} = {value:1}',
      'const constructor = 1', 'const value = 1, other = 2', 'value = 1', 'const value = value'
    ]) {
      assert.throws(() => f.normalize(`<box>{@body ${statement}}<text>{value}</text></box>`), /unsupported/);
      assert.equal(f.w.EXECUTED, undefined);
    }
    const literal = '{@body const value = "literal"}';
    inspect(f.normalize('<box>```text\n' + literal + '\n```</box>').messages[0].html, doc => assert.equal(doc.querySelector('code').textContent, literal + '\n'));
    assert.throws(() => f.normalize('<text preserveWhitespace="yes">Text</text>'), /unsupported/);
  } finally { f.close(); }
});

test('unsupported component diagnostics identify nested failure stages without source values', () => {
  const f = fixture(); try {
    const cases = [
      ['<card><Cite refs={[{id:"PRIVATE_ID"}]} PRIVATE_ATTRIBUTE="PRIVATE_VALUE"/></card>', 'Cite', 'reference', 'CITATION_REFS_INVALID'],
      ['<card><Cite refs={PRIVATE_FUNCTION()}/></card>', 'Cite', 'parse'],
      ['<card><Cite refs={PRIVATE_NAME}/></card>', 'Cite', 'attribute'],
      ['<card><box background="PRIVATE_COLOR">PRIVATE_TEXT</box></card>', 'box', 'style'],
      ['<card><AsyncImage query="PRIVATE_QUERY"/></card>', 'AsyncImage', 'reference', 'IMAGE_REFERENCE_NOT_FOUND'],
      ['<card><AsyncImage/></card>', 'AsyncImage', 'reference', 'IMAGE_QUERY_MISSING'],
      ['<card><Entity value={123}/></card>', 'Entity', 'reference', 'ENTITY_VALUE_INVALID'],
      ['<svg><use href="https://private.invalid/PRIVATE.svg"/></svg>', 'svg', 'svg']
    ];
    for (const outputFormat of ['html', 'pdf']) for (const [source, component, phase, code] of cases) {
      assert.throws(() => f.normalize(source, { outputFormat }), error => {
        const report = JSON.parse(JSON.stringify(error.sourceDiagnostic));
        assert.equal(error.renderedLayout, true);
        assert.equal(report.reason, 'unsupported-static-component');
        assert.equal(report.component, component); assert.equal(report.phase, phase);
        assert.equal(report.code, code); assert.equal(report.format, outputFormat);
        assert.doesNotMatch(JSON.stringify(report), /PRIVATE|private|https:|FUNCTION|NAME/);
        if (code === 'CITATION_REFS_INVALID') {
          assert.equal(report.unknownAttributes, 1);
          assert.deepEqual(report.attributes, [{ name: 'refs', type: 'array', length: 1, itemTypes: ['object'], truncated: false }]);
        }
        if (['parse', 'attribute'].includes(phase)) assert.equal(report.attribute, 'refs');
        return true;
      });
    }
    // Array diagnostics are bounded even for a rejected large reference list.
    assert.throws(() => f.normalize('<Cite refs={' + JSON.stringify(Array(100).fill('PRIVATE_ID')) + '}/>'), error => {
      const attr = error.sourceDiagnostic.attributes[0];
      assert.equal(attr.length, 100); assert.equal(attr.truncated, true); assert.deepEqual(Array.from(attr.itemTypes), ['string']);
      assert.doesNotMatch(JSON.stringify(error.sourceDiagnostic), /PRIVATE/); return true;
    });
  } finally { f.close(); }
});

test('unresolved AsyncImage reports reference shapes and query matches without private values', () => {
  const f = fixture(); try {
    const metadata = {
      PRIVATE_METADATA_KEY: 'PRIVATE_METADATA_VALUE',
      image_results: [{ query: 'PRIVATE_QUERY', image_url: 'https://private.invalid/PRIVATE_IMAGE' }],
      content_references: [{ type: 'image_group', images: [{ image_search_query: ' PRIVATE_QUERY ',
        image_result: { title: 'PRIVATE_TITLE', thumbnail_url: 'https://private.invalid/PRIVATE_PREVIEW' } }],
        PRIVATE_REF_KEY: 'PRIVATE_REF_VALUE' }]
    };
    assert.throws(() => f.normalize('<AsyncImage query="PRIVATE_QUERY" aspectRatio="5:3"/>', {}, metadata), error => {
      const report = JSON.parse(JSON.stringify(error.sourceDiagnostic));
      assert.equal(report.code, 'IMAGE_REFERENCE_NOT_FOUND');
      const diagnostic = report.imageReferences;
      assert.equal(diagnostic.references.length, 1);
      const ref = diagnostic.references.items[0];
      assert.equal(ref.fields.type.category, 'image_group');
      assert.equal(ref.otherFields, 1);
      const image = ref.fields.images.items[0];
      assert.equal(image.fields.image_search_query.matchesQuery, false);
      assert.equal(image.fields.image_search_query.matchesTrimmedQuery, true);
      assert.equal(image.fields.image_result.fields.thumbnail_url.referenceKind, 'http');
      assert.equal(diagnostic.metadata.fields.image_results.items[0].fields.query.matchesQuery, true);
      assert.equal(diagnostic.truncated, false);
      assert.doesNotMatch(JSON.stringify(report), /PRIVATE|private|https:|5:3/);
      return true;
    });
  } finally { f.close(); }
});

test('image reference diagnostic is bounded for large and deeply nested metadata', () => {
  const f = fixture(); try {
    let nested = { query: 'PRIVATE_QUERY', url: 'https://private.invalid/PRIVATE' };
    for (let i = 0; i < 30; i++) nested = { images: [nested, nested, nested, nested] };
    const refs = Array.from({ length: 2000 }, () => ({ type: 'PRIVATE_TYPE', images: [], results: nested }));
    assert.throws(() => f.normalize('<AsyncImage query="PRIVATE_QUERY"/>', {}, { content_references: refs }), error => {
      const diagnostic = error.sourceDiagnostic.imageReferences;
      assert.equal(diagnostic.references.length, 2000);
      assert.equal(diagnostic.references.items.length, 4);
      assert.equal(diagnostic.truncated, true);
      assert.ok(JSON.stringify(diagnostic).length < 20000);
      assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE|private|https:/);
      return true;
    });
  } finally { f.close(); }
});

test('unmounted SVG cards preserve the observed geometry and embed through the image pipeline', async () => {
  const f = fixture(); try {
    f.w.TextEncoder = TextEncoder;
    f.w.URL.createObjectURL = () => 'blob:static-diagram'; f.w.URL.revokeObjectURL = () => {};
    f.w.Image = class { async decode() {} }; // Pixel decoding needs browser verification.
    f.w.fetch = () => { throw Error('A static diagram must not make a network request'); };
    for (const outputFormat of ['html', 'pdf']) {
      const data = f.normalize('Before\n\n' + diagram + '\n\nAfter', { outputFormat });
      assert.equal(data.messages[0].media.length, 1);
      await f.w.ChatArchiveApiMedia.embed(data, { signal: new f.w.AbortController().signal, check() {}, onProgress() {} });
      inspect(data.messages[0].html, doc => {
        const image = doc.querySelector('img'); assert.ok(image);
        const source = Buffer.from(image.src.split(',')[1], 'base64').toString('utf8');
        const xml = new f.w.DOMParser().parseFromString(source, 'image/svg+xml');
        assert.equal(xml.querySelector('parsererror'), null);
        assert.equal(xml.querySelectorAll('rect').length, 4); assert.equal(xml.querySelectorAll('path').length, 3);
        assert.match(xml.documentElement.textContent, /Wi-Fi/); assert.match(xml.documentElement.textContent, /Local network/);
        assert.equal(xml.documentElement.getAttribute('viewBox'), '0 0 340 160');
        assert.equal(image.getAttribute('width'), '340'); assert.equal(image.getAttribute('height'), '160');
        assert.doesNotMatch(source, /currentColor/);
        assert.match(doc.body.textContent, /Before/); assert.match(doc.body.textContent, /After/);
      });
    }
    const disabled = f.normalize('Before\n\n' + diagram + '\n\nAfter', { includeAssistantImages: false });
    assert.equal(disabled.messages[0].media, undefined);
    assert.match(disabled.messages[0].html, /Before/); assert.doesNotMatch(disabled.messages[0].html, /<svg|<img|export-image-placeholder/);
  } finally { f.close(); }
});

test('unmounted cards expand rows, expressions, percentages and passive controls directly for HTML/PDF', () => {
  const f = fixture(); try {
    for (const outputFormat of ['html', 'pdf']) {
      const data = f.normalize(card, { outputFormat, includeAssistantImages: false });
      assert.equal(data.collectionMethod, 'chatgpt-api'); assert.equal(data.componentMessages, 1);
      inspect(data.messages[0].html, doc => {
        assert.equal(doc.querySelectorAll('[data-d-component="card"]').length, 2);
        const bars = [...doc.querySelectorAll('[data-d-component="box"]')].filter(node => node.style.backgroundColor === 'rgb(22, 163, 74)');
        assert.deepEqual(bars.map(node => node.style.width), ['10%', '30%', '50%', '100%']);
        assert.ok(bars.every(node => node.style.height === '12px'));
        assert.deepEqual([...doc.querySelectorAll('[data-d-component="caption"]')].map(node => node.textContent.trim()), ['25 per GB', '10 per GB', '9 per GB', '9 per GB', 'Check balance', 'Settings']);
        assert.match(doc.body.textContent, /250 credits\/month/); assert.match(doc.body.textContent, /\*100#/);
        assert.doesNotMatch(doc.body.textContent, /\{#each|t\.gb|<card|GenUI/);
        assert.equal(doc.querySelector('button,script,[onclick]'), null);
        assert.equal(doc.querySelector('span p'), null);
      });
    }
  } finally { f.close(); }
});

test('static SVG preserves local gradients, repeated shapes, style precedence and Unicode text', async () => {
  const f = fixture(); try {
    f.w.TextEncoder = TextEncoder;
    f.w.URL.createObjectURL = () => 'blob:static-svg'; f.w.URL.revokeObjectURL = () => {};
    f.w.Image = class { async decode() {} };
    const source = `<svg width="100%" viewBox="0 0 180 80">
      <defs><linearGradient id="shade"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stopColor="#123456"/></linearGradient><path id="line" d="M0 0 L5 5"/></defs>
      <g>{#each [10,30,50] as x,i}{#if i<2}<rect x={x} y="5" width="12" height="15" fill="red" style={{fill:"url('#shade')",strokeWidth:2}}/>{/if}{/each}</g>
      <use href="#line" x="80"/>
      <text x="5" y="50">Схема &amp; USB &#x2192; Wi-Fi</text>
      <text x="5" y="70">{"<safe> & text"}</text>
    </svg>`;
    const data = f.normalize(source);
    await f.w.ChatArchiveApiMedia.embed(data, { signal: new f.w.AbortController().signal, check() {}, onProgress() {} });
    const html = new f.w.DOMParser().parseFromString(data.messages[0].html, 'text/html');
    const encoded = html.querySelector('img').src.split(',')[1];
    const xml = new f.w.DOMParser().parseFromString(Buffer.from(encoded, 'base64').toString('utf8'), 'image/svg+xml');
    assert.equal(xml.querySelector('parsererror'), null);
    assert.deepEqual([...xml.querySelectorAll('rect')].map(el => el.getAttribute('x')), ['10', '30']);
    assert.equal(xml.querySelectorAll('linearGradient stop').length, 2);
    assert.equal(xml.querySelector('rect').getAttribute('fill'), 'url(#shade)');
    assert.equal(xml.querySelector('rect').getAttribute('stroke-width'), '2');
    assert.equal(xml.querySelector('use').getAttribute('href'), '#line');
    assert.match(xml.documentElement.textContent, /Схема & USB → Wi-Fi/);
    assert.match(xml.documentElement.textContent, /<safe> & text/);
    assert.equal(xml.querySelector('safe'), null);
  } finally { f.close(); }
});

test('static SVG rejects external and active content without executing event handlers', () => {
  const f = fixture(); try {
    f.w.PWNED = false;
    for (const body of ['<script>globalThis.PWNED=true</script>', '<foreignObject/>', '<image href="https://example.com/image.png"/>', '<use href="https://example.com/shape.svg#x"/>', '<path fill="url(https://example.com/paint.svg#x)"/>', '<path fill="url(&#104;ttps://example.com/paint.svg#x)"/>', '<path style="fill:url(https://example.com/x)"/>', '<animate/>']) {
      assert.throws(() => f.normalize(`<svg viewBox="0 0 100 100">${body}</svg>`), /unsupported/);
    }
    const result = f.normalize('<svg viewBox="0 0 100 100" onload={globalThis.PWNED=true}><rect width="10" height="10" onclick={()=>globalThis.PWNED=true}/></svg>');
    assert.equal(f.w.PWNED, false);
    const svg = Buffer.from(result.messages[0].media[0].source.url.split(',')[1], 'base64').toString('utf8');
    assert.doesNotMatch(svg, /onload|onclick|PWNED/);
  } finally { f.close(); }
});

test('SVG examples in fenced code and user messages remain literal', () => {
  const f = fixture(); try {
    for (const source of ['```svg\n' + diagram + '\n```', '~~~xml\n' + diagram + '\n~~~', '`<svg viewBox="0 0 1 1"/>`']) {
      const data = f.normalize(source);
      assert.equal(data.componentMessages, 0); assert.equal(data.messages[0].media, undefined);
      inspect(data.messages[0].html, doc => assert.match(doc.querySelector('code').textContent, /<svg/));
    }
    const user = raw(diagram); user.mapping.answer.message.author.role = 'user';
    const data = f.w.ChatArchiveApi.normalize(user, URL, { outputFormat: 'html' });
    assert.equal(data.messages[0].media, undefined); assert.match(data.messages[0].html, /&lt;svg/);
  } finally { f.close(); }
});

test('literal component code in fenced, indented and inline examples is not interpreted', () => {
  const f = fixture(); try {
    for (const source of ['```jsx\n' + card + '\n```', '~~~jsx\n' + card + '\n~~~', '    <card>Example</card>', '`<card>Example</card>`']) {
      const data = f.normalize(source);
      assert.equal(data.componentMessages, 0);
      inspect(data.messages[0].html, doc => { assert.match(doc.querySelector('code').textContent, /<card/); assert.equal(doc.querySelector('[data-d-component]'), null); });
    }
    const user = raw('<card>user-provided markup</card>'); user.mapping.answer.message.author.role = 'user';
    assert.match(f.w.ChatArchiveApi.normalize(user, URL, { outputFormat: 'html' }).messages[0].html, /&lt;card&gt;/);
  } finally { f.close(); }
});

test('literal Markdown tables and code within a component preserve structure and whitespace', () => {
  const f = fixture(); try {
    const source = '<card>\n  # Title\n\n  |A|B|\n  |-|-|\n  |1|2|\n\n  ```js\n  if (x) {\n      const text = "<card>{x}</card>";\n  }\n  ```\n</card>';
    inspect(f.normalize(source).messages[0].html, doc => {
      assert.equal(doc.querySelector('h1').textContent, 'Title'); assert.equal(doc.querySelectorAll('td').length, 2);
      assert.equal(doc.querySelector('code').textContent, 'if (x) {\n    const text = "<card>{x}</card>";\n}\n');
    });
  } finally { f.close(); }
});

test('component expressions cannot call functions, reach prototypes, execute events or inject slots/styles', () => {
  const f = fixture(); try {
    f.w.PWNED = false;
    for (const source of ['<card>{globalThis.PWNED=true}</card>', '<card>{[].constructor}</card>', '<card>{({a:1})["__proto__"]}</card>', '<card>{(()=>1)()}</card>', '<box background="url(https://evil.invalid)"/>', '<card>{1/0}</card>', '<card>{missing.value}</card>', '<card>\u0001CAE0\u0002</card>', '<card><text>{"<\\u0001CAE0\\u0002>"}</text></card>', '<card>{#each [1,2] as a}<text>{a}</card>']) {
      assert.throws(() => f.normalize(source), /unsupported|control characters/);
    }
    const data = f.normalize('<card><text onmouseover={globalThis.PWNED=true}>{"<img src=x onerror=alert(1)>"}</text><button onClick={()=>{globalThis.PWNED=true}}>Label</button></card>');
    assert.equal(f.w.PWNED, false);
    inspect(data.messages[0].html, doc => { assert.equal(doc.querySelector('img,script,button,[onmouseover],[onclick]'), null); assert.match(doc.body.textContent, /<img src=x/); });
  } finally { f.close(); }
});

test('expanded layout and expression depth have finite limits before a partial document can escape', () => {
  const f = fixture(); try {
    const many = '[' + Array(200).fill('1').join(',') + ']';
    assert.throws(() => f.normalize(`<card>{#each ${many} as a}{#each ${many} as b}<text>{a+b}</text>{/each}{/each}</card>`), /static rendering limit/);
    assert.throws(() => f.normalize('<card>{' + '('.repeat(70) + '1' + ')'.repeat(70) + '}</card>'), /unsupported/);
    assert.throws(() => f.normalize('<card>{' + Array(100).fill('1').join('+') + '}</card>'), /unsupported/);
    inspect(f.normalize('<Card><Row><Text>Still usable after rejection</Text></Row></Card>').messages[0].html, doc => {
      assert.equal(doc.querySelectorAll('[data-d-component="card"]').length, 1); assert.match(doc.body.textContent, /Still usable/);
    });
  } finally { f.close(); }
});

test('nested loops and conditionals use local data and preserve variable scope', () => {
  const f = fixture(); try {
    const source = '<card>{#each [{name:"A",items:[1,2]},{name:"B",items:[3]}] as row,i}<box><text>{row.name}: {i+1}</text>{#each row.items as n}{#if n>1}<text>{n%2===0 ? "even" : "odd"}: {n}</text>{/if}{/each}</box>{/each}</card>';
    inspect(f.normalize(source).messages[0].html, doc => { assert.match(doc.body.textContent, /A: 1/); assert.match(doc.body.textContent, /B: 2/); assert.match(doc.body.textContent, /even: 2/); assert.match(doc.body.textContent, /odd: 3/); });
  } finally { f.close(); }
});

test('Cite and Entity use exact source references and escape labels; missing citations are explicit', () => {
  const f = fixture(); try {
    const metadata = { content_references: [{ type: 'grouped_webpages', items: [{ title: '<source>', url: 'https://example.com/source', refs: [{ turn_index: 7, ref_type: 'view', ref_index: 0 }] }] }, { type: 'entity', name: 'Example', entity_data: { website_url: 'https://example.com' } }] };
    const source = '**<Entity value="Example"/>** <Cite refs={["turn7view0"]}/>';
    const data = f.normalize(source, {}, metadata);
    inspect(data.messages[0].html, doc => { assert.equal(doc.querySelector('strong a').textContent, 'Example'); assert.equal(doc.querySelectorAll('a').length, 2); assert.match(doc.body.textContent, /<source>/); assert.equal(doc.querySelector('source'), null); });
    assert.equal(data.unavailableCitations, 0);
    const missing = f.normalize(source); assert.equal(missing.unavailableCitations, 1); assert.match(missing.messages[0].html, /Source link unavailable/);
    const off = f.normalize(source, { includeLinks: false }, metadata); assert.doesNotMatch(off.messages[0].html, /<a |turn7|Source link unavailable/);
  } finally { f.close(); }
});

test('observed singular Cite ref resolves exactly like refs without requiring rendered content', () => {
  const f = fixture(); try {
    const metadata = { content_references: [{ type: 'grouped_webpages', items: [
      { title: 'Documentation', url: 'https://example.com/docs', refs: [{ turn_index: 7, ref_type: 'search', ref_index: 0 }] },
      { title: 'Unrelated', url: 'https://example.com/unrelated', refs: ['turn7search1'] }
    ] }] };
    for (const outputFormat of ['html', 'pdf', 'json']) for (const attribute of ['ref="turn7search0"', 'ref={"turn7search0"}', 'refs="turn7search0"', 'refs={["turn7search0"]}']) {
      const source = `Before\n\n- **Install** the file. <Cite ${attribute}/>\n\nAfter`;
      const data = f.normalize(source, { outputFormat }, metadata);
      assert.equal(data.collectionMethod, 'chatgpt-api'); assert.equal(data.unavailableCitations, 0);
      inspect(data.messages[0].html, doc => {
        assert.equal(doc.querySelectorAll('a').length, 1); assert.equal(doc.querySelector('a').href, 'https://example.com/docs');
        assert.equal(doc.querySelector('li a').textContent, 'Documentation'); assert.match(doc.body.textContent, /Before[\s\S]*Install[\s\S]*After/);
        assert.doesNotMatch(doc.body.textContent, /Unrelated|<Cite|turn7/);
      });
      const missing = f.normalize(source, { outputFormat });
      assert.equal(missing.unavailableCitations, 1); assert.match(missing.messages[0].html, /Source link unavailable/);
      const off = f.normalize(source, { outputFormat, includeLinks: false }, metadata);
      assert.doesNotMatch(off.messages[0].html, /<a |Source link unavailable|Cite|turn7/); assert.match(off.messages[0].html, /After/);
    }
    for (const source of ['<Cite ref={42}/>', '<Cite ref={{id:"turn7search0"}}/>', '<Cite refs={null} ref="turn7search0"/>']) {
      assert.throws(() => f.normalize(source), error => error.sourceDiagnostic?.code === 'CITATION_REFS_INVALID');
    }
    for (const source of ['`<Cite ref="turn7search0"/>`', '```xml\n<Cite ref="turn7search0"/>\n```']) {
      inspect(f.normalize(source).messages[0].html, doc => { assert.match(doc.querySelector('code').textContent, /<Cite ref=/); assert.equal(doc.querySelector('a'), null); });
    }
  } finally { f.close(); }
});

test('formatted metric layouts preserve numeric labels, bars, grid items and titles without mounted messages', () => {
  const f = fixture(); try {
    for (const outputFormat of ['html', 'pdf', 'json']) {
      const data = f.normalize('Before\n\n' + metrics + '\n\nAfter', { outputFormat });
      assert.equal(data.collectionMethod, 'chatgpt-api');
      inspect(data.messages[0].html, doc => {
        const labels = [...doc.querySelectorAll('[data-d-component="text"]')].filter(el => el.style.width === '112px');
        assert.deepEqual(labels.map(el => el.textContent.replace(/\u00a0/g, ' ')), ['12 500 units', '25 000 units', '62 500 units', '83 333 units']);
        assert.ok(labels.every(el => el.style.fontVariantNumeric === 'tabular-nums'));
        const bars = [...doc.querySelectorAll('[data-d-component="box"]')].filter(el => el.style.height === '100%');
        assert.deepEqual(bars.map(el => el.style.width), ['15%', '30%', '75%', '100%']);
        assert.equal(bars[0].style.backgroundColor, 'rgb(22, 163, 74)');
        assert.equal(doc.querySelector('[data-d-component="grid"]').style.gridTemplateColumns, 'repeat(2,minmax(0,1fr))');
        assert.equal(doc.querySelectorAll('[data-d-component="grid-item"]').length, 2);
        assert.deepEqual([...doc.querySelectorAll('[data-d-component="title"]')].map(el => el.style.fontSize), ['24px', '20px']);
        assert.equal(doc.querySelector('[data-d-component="box"]').style.borderWidth, '1px');
        assert.match(doc.body.textContent, /Before[\s\S]*After/); assert.doesNotMatch(doc.body.textContent, /toLocaleString|\{#each|<grid-item|<title/);
        assert.equal(doc.querySelector('title,script,button,[onclick]'), null);
      });
    }
  } finally { f.close(); }
});

test('numeric formatting supports explicit locales and passive options in expressions and SVG labels', () => {
  const f = fixture(); try {
    const samples = [
      ['(12345.67).toLocaleString("ru-RU")', '12 345,67'],
      ['(12345.67).toLocaleString("en-US")', '12,345.67'],
      ['(12345.67).toLocaleString("de-DE")', '12.345,67'],
      ['(12345.6).toLocaleString(["ru-RU","en-US"],{useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2})', '12345,60'],
      ['(0.125).toLocaleString("en-US",{style:"percent",maximumFractionDigits:1})', '12.5%'],
      ['(-45).toLocaleString("en-US",{style:"currency",currency:"USD"})', '-$45.00'],
      ['(15).toLocaleString("en-US",{style:"unit",unit:"meter"})', '15 m']
    ];
    for (const [expression, expected] of samples) {
      inspect(f.normalize('<text>{' + expression + '}</text>').messages[0].html, doc => assert.equal(doc.body.textContent.replace(/[\u00a0\u202f]/g, ' ').trim(), expected));
    }
    const svg = f.normalize('<svg viewBox="0 0 150 40"><title>Metric</title><text x="5" y="20">{(12500).toLocaleString("ru-RU")}</text></svg>').messages[0].media[0].source.url;
    assert.match(Buffer.from(svg.split(',')[1], 'base64').toString('utf8'), /12\u00a0500/);
  } finally { f.close(); }
});

test('numeric formatting cannot call arbitrary methods or coerce objects, and has finite format bounds', () => {
  const f = fixture(); try {
    f.w.PWNED = false;
    const expressions = [
      '(1).toString()', '(1).toFixed(2)', '(1).toLocaleString.call(null)', 'globalThis.PWNED=true',
      '({toLocaleString:123}).toLocaleString("en-US")', '[1,2].toLocaleString("en-US")', '"123".toLocaleString("en-US")',
      '(1).toLocaleString("ru_RU")', '(1).toLocaleString("https://private.invalid")', '(1).toLocaleString({})',
      '(1).toLocaleString("en-US",{maximumFractionDigits:1001})', '(1).toLocaleString("en-US",{unknownOption:"PRIVATE"})',
      '(1).toLocaleString("en-US",{useGrouping:{value:true}})', '(1).toLocaleString("en-US",{},3)',
      '(1).toLocaleString("en-US").toLocaleString("en-US")', '(1).constructor', '(1)["__proto__"]'
    ];
    for (const source of expressions) assert.throws(() => f.normalize('<text>{' + source + '}</text>'), /unsupported/);
    const values = JSON.stringify(Array.from({ length: 33 }, (_, i) => i));
    assert.throws(() => f.normalize(`<box>{#each ${values} as n}<text>{n.toLocaleString("en-US",{minimumIntegerDigits:n%21+1,useGrouping:n<21})}</text>{/each}</box>`), error => error.sourceDiagnostic?.code === 'NUMBER_FORMAT_UNSUPPORTED');
    assert.equal(f.w.PWNED, false);
    assert.doesNotThrow(() => f.normalize('<text>{(123).toLocaleString("en-US")}</text>'));
  } finally { f.close(); }
});

test('grid-item and title source stays literal in code and user messages and rejects unsupported sizing', () => {
  const f = fixture(); try {
    for (const source of ['`<grid-item><title>Example</title></grid-item>`', '```jsx\n' + metrics + '\n```']) {
      inspect(f.normalize(source).messages[0].html, doc => { assert.match(doc.querySelector('code').textContent, /<grid-item/); assert.equal(doc.querySelector('[data-d-component]'), null); });
    }
    const user = raw(metrics); user.mapping.answer.message.author.role = 'user';
    const data = f.w.ChatArchiveApi.normalize(user, URL, { outputFormat: 'html' });
    assert.match(data.messages[0].html, /&lt;grid-item/);
    assert.throws(() => f.normalize('<title size="url(https://example.com)">Label</title>'), /unsupported/);
    assert.throws(() => f.normalize('<grid><grid-item-extra>Unknown</grid-item-extra></grid>'), /unsupported/);
  } finally { f.close(); }
});

test('AsyncImage accepts an exact saved image reference, never a guessed similar query', () => {
  const f = fixture(); try {
    const metadata = { content_references: [{ type: 'image_v2', query: 'Example screenshot', images: [{ content_url: 'https://images.example.com/exact.png' }] }] };
    const source = '<row><AsyncImage query="Example screenshot" maxWidth="136px"/><box>Details</box></row>';
    const data = f.normalize(source, {}, metadata);
    assert.equal(data.messages[0].media.length, 1); assert.equal(data.messages[0].media[0].source.url, 'https://images.example.com/exact.png');
    assert.throws(() => f.normalize(source), /unsupported/);
    assert.throws(() => f.normalize(source.replace('Example screenshot', 'Example screenshots'), {}, metadata), /unsupported/);
    assert.doesNotThrow(() => f.normalize(source, { includeAssistantImages: false }));
  } finally { f.close(); }
});

test('AsyncImage binds DIL results by exact query and resolution ID, independently of result order', () => {
  const f = fixture(); try {
    const { source, metadata, bundle, urls } = dilImages();
    for (const outputFormat of ['html', 'pdf']) for (const saved of [metadata, { model_dil_v2: bundle }]) {
      const result = f.normalize(source, { outputFormat }, saved);
      assert.deepEqual(Array.from(result.messages[0].media, image => image.source.url), urls);
      assert.match(result.messages[0].html, /Before illustrations[\s\S]*After illustrations/);
    }
    assert.equal(f.normalize(source, { includeAssistantImages: false }, metadata).messages[0].media, undefined);
    assert.throws(() => f.normalize(source, {}, { safe_urls: metadata.safe_urls }), /unsupported/);
    assert.throws(() => f.normalize(source.replace('MS Paint illustration', 'Similar illustration'), {}, metadata), /unsupported/);
  } finally { f.close(); }
});

test('DIL image binding rejects missing, ambiguous, loading and non-image results without executing code', () => {
  const f = fixture(); try {
    const invalid = [
      b => { delete b.appData.opGenui.componentResults['image-0']; },
      b => { b.appData.opGenui.componentResults['image-0'].componentName = 'AsyncImageGroup'; },
      b => { b.appData.opGenui.componentResults['image-0'].state.is_loading = true; },
      b => { b.appData.opGenui.componentResults['image-0'].state.images = [{ url: 'https://example.com/page' }]; },
      b => { b.appData.opGenui.componentResults['image-0'].state.images[0].content_url = 'javascript:alert(1)'; delete b.appData.opGenui.componentResults['image-0'].state.images[0].original_content_url; },
      b => { b.code = b.code.replace('__dilConstants["0"]', '(globalThis.PRIVATE_EXECUTED = true)'); },
      b => { b.code = b.code.replace('"query":__dilConstants["0"]', '...unknown,"query":__dilConstants["0"]'); },
      b => { b.code = b.code.replace('"query":__dilConstants["0"]', '"query":"Wrong","query":__dilConstants["0"]'); },
      b => { b.code += '__dil.jsx(AsyncImage,{"query":__dilConstants["0"],"__resolutionId":"image-1"});'; },
      b => { b.code += '__dil.jsx(AsyncImage,{"query":__dilConstants["0"],"__resolutionId":"missing-image"});'; },
      b => { b.appData.opGenui.componentResults['image-0'].state.images.push({ content_url: 'https://example.com/second.jpg' }); },
      b => { b.code = JSON.stringify(b.code); },
      b => { b.code = '/*' + b.code + '*/'; },
      b => { b.code = '`' + b.code + '`'; },
      b => { b.code = '/' + b.code + '/'; },
      b => { b.code = ' '.repeat(2 * 1024 * 1024) + b.code; }
    ];
    for (const change of invalid) {
      const { source, metadata, bundle } = dilImages(); change(bundle);
      assert.throws(() => f.normalize(source, {}, metadata), /unsupported/);
      assert.equal(f.w.PRIVATE_EXECUTED, undefined);
    }
    const { source, metadata, bundle, urls } = dilImages();
    bundle.code = 'globalThis.PRIVATE_EXECUTED = true; /* discarded fake call */\n' + bundle.code;
    bundle.constants['1'] = '["image-0"]';
    assert.deepEqual(Array.from(f.normalize(source, {}, metadata).messages[0].media, image => image.source.url), urls);
    assert.equal(f.w.PRIVATE_EXECUTED, undefined);
  } finally { f.close(); }
});

test('AsyncImage resolves exact nested image-group results and rejects ambiguous or page-only references', () => {
  const f = fixture(); try {
    const source = '<card><AsyncImage query="Example device"/><text>Details</text></card>';
    const entry = { image_search_query: 'Example device', image_result: { content_url: 'https://images.example.com/device.png', url: 'https://example.com/product' } };
    const metadata = images => ({ content_references: [{ type: 'image_group', images, safe_urls: ['https://example.com/product'] }] });
    assert.equal(f.normalize(source, {}, metadata([entry])).messages[0].media[0].source.url, entry.image_result.content_url);
    for (const images of [[{ ...entry, image_search_query: 'Different device' }], [{ ...entry, image_result: { url: 'https://example.com/product' } }], [entry, { ...entry, image_result: { content_url: 'https://images.example.com/other.png' } }]]) {
      assert.throws(() => f.normalize(source, {}, metadata(images)), /unsupported/);
    }
    const off = f.normalize(source, { includeAssistantImages: false }, metadata([entry]));
    assert.equal(off.messages[0].media, undefined); assert.match(off.messages[0].html, /Details/);
  } finally { f.close(); }
});

test('observed explicit URL markers preserve their destinations, switches and literal code', () => {
  const f = fixture(); try {
    const marker = '\uE200url\uE202Example tool\uE202https://example.com/tool?q=(1)&a=2\uE201';
    for (const outputFormat of ['html', 'pdf']) {
      const data = f.normalize('Before ' + marker + ' after', { outputFormat });
      inspect(data.messages[0].html, doc => {
        assert.equal(doc.querySelector('a').href, 'https://example.com/tool?q=(1)&a=2');
        assert.equal(doc.querySelector('a').textContent, 'Example tool');
        assert.match(doc.body.textContent, /Before.*Example tool.*after/);
      });
      const off = f.normalize(marker, { outputFormat, includeLinks: false });
      assert.doesNotMatch(off.messages[0].html, /<a |https:/); assert.match(off.messages[0].html, /Example tool/);
    }
    assert.match(f.normalize(marker, { outputFormat: 'md' }).messages[0].markdown, /\[Example tool\]\(<https:/);
    assert.match(f.normalize(marker, { outputFormat: 'txt' }).messages[0].text, /Example tool \(https:/);
    inspect(f.normalize('```text\n' + marker + '\n```').messages[0].html, doc => assert.equal(doc.querySelector('code').textContent, marker + '\n'));
    for (const target of ['javascript:alert(1)', 'data:text/html,x', 'https://name:password@example.com/x', 'https://example.com/ malformed', 'https://example.com/\uE202extra']) {
      assert.throws(() => f.normalize('\uE200url\uE202Label\uE202' + target + '\uE201'), /rich content/);
    }
  } finally { f.close(); }
});
