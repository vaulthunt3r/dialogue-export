const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc', URL = `https://chatgpt.com/c/${ID}`;
const card = read('tests/fixtures/static-card.txt');
const diagram = read('tests/fixtures/static-diagram.txt');
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
