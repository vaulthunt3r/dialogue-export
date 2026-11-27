const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const dilImages = require('./fixtures/dil-images.cjs');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc', URL = `https://chatgpt.com/c/${ID}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=', 'base64');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="160" viewBox="0 0 640 160"><rect x="10" y="10" width="620" height="140" fill="#e0f2fe"/><text x="40" y="90" font-size="24">Input → Output</text></svg>';
function raw(parts = ['Answer']) { return { conversation_id: ID, title: 'HTML fixture', current_node: 'answer', mapping: {
  root: { id: 'root', parent: null, message: null },
  answer: { id: 'answer', parent: 'root', message: { id: 'answer', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'multimodal_text', parts } } }
} }; }
function chain(messages) {
  const result = { conversation_id: ID, current_node: 'root', mapping: { root: { id: 'root', parent: null, message: null } } };
  for (const message of messages) {
    result.mapping[message.id] = { id: message.id, parent: result.current_node, message };
    result.current_node = message.id;
  }
  return result;
}
function imageMessage(id, role, pointer, changes = {}) {
  return { id, author: { role, name: role === 'tool' ? 'unrecognized_image_tool' : undefined }, status: 'finished_successfully',
    content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: pointer }] }, ...changes };
}
function fixture() {
  const dom = new JSDOM('<main></main>', { url: URL, runScripts: 'outside-only' });
  const w = dom.window;
  w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
  w.URL.createObjectURL = () => 'blob:synthetic'; w.URL.revokeObjectURL = () => {};
  w.Image = class { async decode() {} }; // Decode is verified with real images in isolated Firefox.
  for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js', 'content/chatgpt-api.js', 'shared/renderers.js']) w.eval(read(file));
  return { w, close: () => w.close() };
}
function options(format = 'html') { return { outputFormat: format, includeLinks: true }; }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

test('DIL search illustrations and 21 generated images export together, including an unmounted answer', async () => {
  for (const outputFormat of ['html', 'pdf']) for (const renderedFallback of [false, true]) {
    const f = fixture(); try {
      const { source, metadata, urls } = dilImages();
      const textMessage = (id, role, text, extra = {}) => ({ id, author: { role }, status: 'finished_successfully', content: { content_type: 'text', parts: [text] }, ...extra });
      const messages = [imageMessage('question', 'user', 'file-service://user-image'),
        textMessage('illustrations', 'assistant', source + '\n\n' + read('tests/fixtures/static-prompt.txt'), { metadata: renderedFallback ? {} : metadata })];
      for (let i = 0; i < 21; i++) messages.push(textMessage(`q${i}`, 'user', `Generate image ${i}`),
        imageMessage(`g${i}`, 'tool', `file-service://generated-${i}`), textMessage(`a${i}`, 'assistant', `Image ${i} ready`));
      const saved = chain(messages), downloads = [];
      f.w.fetch = async (url, init) => {
        if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
        if (url.endsWith(`/conversation/${ID}`)) return json(saved);
        const pointer = url.match(/\/files\/([\w-]+)\/download$/);
        if (pointer) return json({ download_url: `https://images.example.com/${pointer[1]}.png` });
        assert.ok(urls.includes(url) || /^https:\/\/images.example.com\/(user-image|generated-\d+)\.png$/.test(url));
        assert.equal(init.headers.authorization, undefined); downloads.push(url);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      };
      let pageReads = 0;
      const result = await f.w.ChatArchiveApi.collect({ outputFormat }, () => {}, () => {}, undefined, async (expected, needed) => {
        pageReads++; assert.equal(renderedFallback, true);
        assert.deepEqual(Array.from(needed), ['illustrations']);
        assert.deepEqual(Array.from(expected, m => m.id), messages.map(m => m.id));
        return new Map([['illustrations', { html: '<p>Before illustrations</p>' + urls.map(() => `<img src="data:image/png;base64,${png.toString('base64')}">`).join('') + '<p>After illustrations</p>' }]]);
      });
      assert.ok(result.data, result.fallback);
      assert.equal(pageReads, Number(renderedFallback));
      assert.equal(result.data.collectionMethod, renderedFallback ? 'chatgpt-api-rendered' : 'chatgpt-api');
      assert.deepEqual(Array.from(result.data.messages, m => m.id), messages.map(m => m.id));
      const doc = new JSDOM(f.w.ChatArchiveRenderers.html(result.data, {}));
      try {
        const contentImages = doc.window.document.querySelectorAll('img:not([data-export-icon])');
        assert.equal(contentImages.length, 26);
        for (const image of contentImages) assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), png);
        assert.equal(doc.window.document.querySelectorAll('[data-export-icon]').length, renderedFallback ? 0 : 1);
        assert.match(doc.window.document.body.textContent, /Before illustrations[\s\S]*After illustrations[\s\S]*Image 20 ready/);
        if (!renderedFallback) {
          assert.match(doc.window.document.body.textContent, /First paragraph\.\n\nSecond paragraph with two  spaces\./);
          assert.equal(doc.window.document.querySelector('[style*="white-space:pre-wrap"]').style.whiteSpace, 'pre-wrap');
        }
        assert.doesNotMatch(doc.window.document.documentElement.outerHTML, /PRIVATE_TOKEN|AsyncImage|export-image-placeholder/);
      } finally { doc.window.close(); }
      assert.equal(downloads.length, renderedFallback ? 22 : 26);
      assert.deepEqual(downloads.filter(url => urls.includes(url)), renderedFallback ? [] : urls);
    } finally { f.close(); }
  }
});

test('mixed text, formatted cards, source links, SVG and user/assistant images export together without page content', async () => {
  for (const outputFormat of ['html', 'pdf']) for (const [includeUserImages, includeAssistantImages] of [[true, true], [false, true], [true, false], [false, false]]) {
    const f = fixture();
    try {
      const r = chain([
        imageMessage('question', 'user', 'file-service://mixed-user'),
        { id: 'answer', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: [
          'Before\n\n' + read('tests/fixtures/formatted-metrics.txt') + '\n\n' + read('tests/fixtures/static-diagram.txt') +
          '\n\n<AsyncImage src="https://images.example.com/answer.png" alt="Answer image"/>\n\n<Cite ref="turn7search0"/>\n\n|A|B|\n|-|-|\n|1|2|\n\nAfter'
        ] }, metadata: { content_references: [{ type: 'grouped_webpages', items: [{ title: 'Documentation', url: 'https://example.com/docs', refs: ['turn7search0'] }] }] } }
      ]);
      const calls = [];
      f.w.fetch = async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
        if (url.endsWith(`/conversation/${ID}`)) return json(r);
        if (url.endsWith('/files/mixed-user/download')) return json({ download_url: 'https://images.example.com/user.png' });
        assert.ok(['https://images.example.com/user.png', 'https://images.example.com/answer.png'].includes(url));
        assert.equal(init.credentials, 'omit'); assert.equal(init.headers.authorization, undefined);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      };
      let pageReads = 0;
      const { data, fallback } = await f.w.ChatArchiveApi.collect({ outputFormat, includeUserImages, includeAssistantImages }, () => {}, () => {}, undefined, async () => { pageReads++; throw Error('No rendered-page fallback expected'); });
      assert.ok(data, fallback); assert.equal(data.collectionMethod, 'chatgpt-api'); assert.equal(pageReads, 0);
      const doc = new JSDOM(f.w.ChatArchiveRenderers.html(data, {})).window.document;
      assert.equal(doc.images.length, Number(includeUserImages) + 2 * Number(includeAssistantImages));
      assert.equal(doc.querySelectorAll('[data-d-component="grid-item"]').length, 2);
      assert.equal(doc.querySelectorAll('table').length, 1);
      assert.match(doc.body.textContent.replace(/\u00a0/g, ' '), /12 500 units/);
      assert.match(doc.body.textContent, /Before[\s\S]*After/);
      assert.equal(doc.querySelector('a').href, 'https://example.com/docs');
      assert.equal(calls.some(call => call.url.endsWith('/user.png')), includeUserImages);
      assert.equal(calls.some(call => call.url.endsWith('/answer.png')), includeAssistantImages);
      for (const img of doc.images) {
        if (img.src.startsWith('data:image/svg+xml;')) {
          const xml = new f.w.DOMParser().parseFromString(Buffer.from(img.src.split(',')[1], 'base64').toString('utf8'), 'image/svg+xml');
          assert.equal(xml.querySelector('parsererror'), null); assert.equal(xml.querySelectorAll('rect').length, 4);
        } else assert.deepEqual(Buffer.from(img.src.split(',')[1], 'base64'), png);
      }
      assert.doesNotMatch(doc.body.textContent, /toLocaleString|\{#each|PRIVATE_TOKEN/);
    } finally { f.close(); }
  }
});

test('image loader distinguishes HTTP, network, size, format and decoding failures without private details', async () => {
  const cases = [
    ['IMAGE_HTTP_ERROR', w => { w.fetch = async () => new Response('Private error page', { status: 403 }); }],
    ['IMAGE_NETWORK_ERROR', w => { w.fetch = async () => { throw Error('https://private.invalid/?token=SECRET'); }; }],
    ['IMAGE_SIZE_LIMIT', w => { w.fetch = async () => new Response(png, { headers: { 'content-length': String(9 * 1024 * 1024) } }); }],
    ['IMAGE_FORMAT_UNSUPPORTED', w => { w.fetch = async () => new Response('not an image SECRET'); }],
    ['IMAGE_DECODE_FAILED', w => { w.fetch = async () => new Response(png); w.Image = class { async decode() { throw Error('private decode details'); } }; }]
  ];
  for (const [code, setup] of cases) {
    const f = fixture();
    try {
      setup(f.w);
      await assert.rejects(f.w.ChatArchiveApiMedia.loadImage('https://images.openai.com/static-rsc-4/fixture', { signal: new f.w.AbortController().signal }), error => {
        assert.equal(error.imageDiagnostic.code, code);
        if (code === 'IMAGE_HTTP_ERROR') assert.equal(error.imageDiagnostic.httpStatus, 403);
        assert.doesNotMatch(error.message + JSON.stringify(error.imageDiagnostic), /SECRET|private/);
        return true;
      });
    } finally { f.close(); }
  }
});

test('HTML/PDF normalizer renders headings, nested lists, tables, blockquotes and exact code', () => {
  const f = fixture();
  try {
    const source = '# Heading\n\n> Quote\n\n- One\n  - Child\n\n| Name | Value |\n| --- | --- |\n| A | 42 |\n\n```python\nif x < 3:\n    print("<script>")\n\nnext()\n```\n\n[Source](https://example.com)';
    for (const format of ['html', 'pdf']) {
      const result = f.w.ChatArchiveApi.normalize(raw([source]), URL, options(format));
      const doc = new JSDOM(result.messages[0].html).window.document;
      assert.equal(doc.querySelector('h1').textContent, 'Heading');
      assert.equal(doc.querySelector('li li').textContent, 'Child');
      assert.equal(doc.querySelectorAll('table td').length, 2);
      assert.equal(doc.querySelector('.chat-archive-code-label').textContent, 'python');
      assert.equal(doc.querySelector('pre code').textContent, 'if x < 3:\n    print("<script>")\n\nnext()\n');
      assert.equal(doc.querySelector('script'), null);
      assert.equal(doc.querySelector('a').getAttribute('href'), 'https://example.com');
      assert.equal(result.messages[0].markdown, undefined);
    }
  } finally { f.close(); }
});

test('conversation HTML cannot execute scripts, inject styles, events or javascript links', () => {
  const f = fixture();
  try {
    const value = '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<style>body{display:none}</style>\n\n[x](javascript:alert(1))\n\n[link](https://example.com/?x=%22onmouseover=alert(1))\n\n```"><img src=x>\ncode\n```';
    const result = f.w.ChatArchiveApi.normalize(raw([value]), URL, options());
    const doc = new JSDOM(result.messages[0].html).window.document;
    assert.equal(doc.querySelector('script,style,img,[onerror],[onmouseover]'), null);
    assert.ok([...doc.querySelectorAll('a')].every(a => a.href.startsWith('https:')));
    assert.match(doc.body.textContent, /<script>alert\(1\)<\/script>/);
  } finally { f.close(); }
});

test('unresolved card images are rejected instead of leaking their source into HTML/PDF', () => {
  const f = fixture();
  try {
    const source = '## Browsers\n\n<box gap={3}>\n<row align="start" gap={3}>\n<AsyncImage query="browser screenshot" aspectRatio="4:3" maxWidth="136px"/>\n<box flex="1" gap={1}>\n**<Entity category="software" value="Example browser"/>**\n\n    <badge color="success">First choice</badge>\n\n    A description.\n</box>\n</row>\n</box>';
    for (const format of ['html', 'pdf']) {
      assert.throws(() => f.w.ChatArchiveApi.normalize(raw([source]), URL, options(format)), /unsupported layout, expression or reference/);
      // Literal component examples remain code. They must not force a page scan.
      for (const literal of ['```jsx\n' + source + '\n```', '~~~jsx\n' + source + '\n~~~', '`<AsyncImage query="example"/>`', '    <AsyncImage query="example"/>']) {
        const result = f.w.ChatArchiveApi.normalize(raw([literal]), URL, options(format));
        assert.ok(result.messages[0].html.includes('&lt;AsyncImage'));
      }
    }
  } finally { f.close(); }
});

test('cards, bare layout components, reordered attributes and Cite render directly in HTML/PDF', () => {
  const f = fixture();
  try {
    const sources = ['<card gap={3}>**Plans** {#each [{gb:10},{gb:100}] as t}<row><text>{t.gb} GB</text><spacer/></row>{/each}</card>',
      '<box height={12} radius="sm" background="#16a34a" width="30%"/>',
      '<row>Plan and price</row>', '<text weight="medium">Value</text>', '<divider/>',
      '<Cite refs={["turn1view0","turn1view1"]}/>'];
    for (const outputFormat of ['html', 'pdf']) for (const source of sources) {
      assert.doesNotMatch(f.w.ChatArchiveApi.normalize(raw([source]), URL, options(outputFormat)).messages[0].html, /&lt;(?:card|box|row|text|divider|Cite)/);
      for (const literal of ['```jsx\n' + source + '\n```', '~~~jsx\n' + source + '\n~~~', '    ' + source]) {
        const result = f.w.ChatArchiveApi.normalize(raw([literal]), URL, options(outputFormat));
        assert.ok(result.messages[0].html.includes('&lt;'));
      }
    }
    const plain = '<cite>Ordinary citation</cite> and `<card gap={3}>` and <cardigan>word</cardigan>';
    assert.doesNotThrow(() => f.w.ChatArchiveApi.normalize(raw([plain]), URL, options()));
    for (const outputFormat of ['txt', 'md']) {
      assert.doesNotThrow(() => f.w.ChatArchiveApi.normalize(raw([sources[0]]), URL, options(outputFormat)));
    }
  } finally { f.close(); }
});

test('links off preserves image requests, inline code, code fences and reference-style link labels', () => {
  const f = fixture();
  try {
    const value = '[label][ref]\n\n[ref]: https://example.com\n\n![picture](https://example.com/image.png)\n\n`[literal](https://code.test)`';
    const result = f.w.ChatArchiveApi.normalize(raw([value]), URL, { ...options(), includeLinks: false });
    const doc = new JSDOM(result.messages[0].html).window.document;
    assert.equal(doc.querySelectorAll('a').length, 0);
    assert.equal(result.messages[0].media.length, 1);
    assert.equal(doc.querySelector('code').textContent, '[literal](https://code.test)');
  } finally { f.close(); }
});

test('image parts, metadata attachments and exact gallery references stay with their message', () => {
  const f = fixture();
  try {
    const r = raw(['Before', { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_1' }, 'After']);
    r.mapping.answer.message.metadata = { attachments: [{ id: 'file_1', mime_type: 'image/png', name: 'same.png' }, { id: 'file_2', mime_type: 'image/png', name: 'second.png' }] };
    const result = f.w.ChatArchiveApi.normalize(r, URL, options());
    assert.equal(result.messages[0].media.length, 2);
    assert.match(result.messages[0].media[0].source.pointer, /sediment/);
    assert.match(result.messages[0].media[1].source.pointer, /file-service/);
    assert.ok(result.messages[0].html.indexOf('Before') < result.messages[0].html.indexOf('data-export-image="0"'));
    assert.ok(result.messages[0].html.indexOf('After') > result.messages[0].html.indexOf('data-export-image="0"'));
  } finally { f.close(); }
});

test('HTML collection embeds bytes, deduplicates downloads and never sends the token to a remote image host', async () => {
  const f = fixture();
  try {
    const calls = [], r = raw([{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_1' }, '![Again](https://images.example.com/picture.png)', '![Again](https://images.example.com/picture.png)']);
    f.w.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/session')) return json({ accessToken: 'SECRET_TOKEN' });
      if (url.endsWith(`/conversation/${ID}`)) return json(r);
      if (url.endsWith('/attachment/file_1/download')) return json({ download_url: 'https://images.example.com/generated.png' });
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    };
    const result = await f.w.ChatArchiveApi.collect(options(), () => {});
    assert.ok(result.data, result.fallback);
    assert.equal(result.data.embeddedImages, 3);
    assert.equal(calls.filter(c => c.url.endsWith('/picture.png')).length, 1);
    for (const c of calls.filter(c => c.url.startsWith('https://images.example.com'))) {
      assert.equal(c.init.credentials, 'omit'); assert.equal(c.init.headers.authorization, undefined); assert.equal(c.init.referrerPolicy, 'no-referrer');
    }
    assert.doesNotMatch(JSON.stringify(result.data), /SECRET_TOKEN|sediment:|images.example.com|export-image-placeholder/);
    const doc = new JSDOM(f.w.ChatArchiveRenderers.html(result.data, { includeTitle: true })).window.document;
    assert.equal(doc.images.length, 3);
    for (const img of doc.images) assert.deepEqual(Buffer.from(img.src.split(',')[1], 'base64'), png);
  } finally { f.close(); }
});

test('image_group unwraps six saved results in order beside an entity and embeds every image in HTML/PDF', async () => {
  for (const format of ['html', 'pdf']) {
    const f = fixture();
    try {
      const marker = '\uE200image_group\uE202{"query":["PRIVATE_QUERY"]}\uE201';
      const entity = '\uE200entity\uE202PRIVATE_ENTITY_ID\uE201';
      const r = raw([`Before ${entity}\n\n${marker}\n\nAfter`]);
      r.mapping.answer.message.metadata = { content_references: [
        { type: 'image_group', matched_text: marker, safe_urls: ['https://private.invalid/DO_NOT_FETCH'], alt: 'Gallery',
          images: Array.from({ length: 6 }, (_, i) => ({ image_search_query: 'PRIVATE_QUERY', image_result: {
            content_url: `https://images.example.com/image-${i}.png`, thumbnail_url: `https://images.example.com/thumb-${i}.png`,
            url: `https://source.example.com/article-${i}`, title: `Image ${i}` } })) },
        { type: 'entity', matched_text: entity, safe_urls: [], name: 'Example', alt: 'Example', entity_data: { name: 'Example' } }
      ] };
      const calls = [];
      f.w.fetch = async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
        if (url.endsWith(`/conversation/${ID}`)) return json(r);
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      };
      const { data, fallback } = await f.w.ChatArchiveApi.collect({ ...options(format), includeActivity: true }, () => {});
      assert.ok(data, fallback); assert.equal(data.embeddedImages, 6);
      const html = data.messages[0].html, doc = new JSDOM(html).window.document;
      assert.equal(doc.images.length, 6); assert.match(doc.body.textContent, /Before Example[\s\S]*After/);
      assert.deepEqual(Array.from(doc.images, img => img.alt), Array.from({ length: 6 }, (_, i) => `Image ${i}`));
      for (const img of doc.images) assert.deepEqual(Buffer.from(img.src.split(',')[1], 'base64'), png);
      assert.deepEqual(calls.slice(2).map(call => call.url), Array.from({ length: 6 }, (_, i) => `https://images.example.com/image-${i}.png`));
      for (const call of calls.slice(2)) { assert.equal(call.init.credentials, 'omit'); assert.equal(call.init.headers.authorization, undefined); }
      assert.doesNotMatch(JSON.stringify(data), /PRIVATE|image_group|image_result|source.example.com|images.example.com/);
    } finally { f.close(); }
  }
});

test('image_group respects image switches and text-only formats without fetching or requiring image data', async () => {
  for (const format of ['txt', 'md', 'json', 'html', 'pdf']) for (const role of ['user', 'assistant']) {
    const f = fixture();
    try {
      const marker = '\uE200image_group\uE202PRIVATE_QUERY\uE201', r = raw([`Before\n\n${marker}\n\nAfter`]);
      r.mapping.answer.message.author.role = role;
      r.mapping.answer.message.metadata = { content_references: [{ type: 'image_group', matched_text: marker, images: [null], safe_urls: ['PRIVATE_URL'] }] };
      let calls = 0;
      f.w.fetch = async url => { calls++; return url.endsWith('/session') ? json({ accessToken: 'PRIVATE_TOKEN' }) : json(r); };
      const selected = role === 'user' ? { includeUserImages: false } : { includeAssistantImages: false };
      const { data, fallback } = await f.w.ChatArchiveApi.collect({ ...options(format), ...selected }, () => {});
      assert.ok(data, fallback); assert.equal(calls, 2); assert.equal(data.embeddedImages, undefined);
      assert.match(JSON.stringify(data.messages), /Before[\s\S]*After/);
      assert.doesNotMatch(JSON.stringify(data), /PRIVATE|image_group/);
      if (['txt', 'md', 'json'].includes(format)) assert.match(JSON.stringify(data), /image data is not included/);
      else assert.doesNotMatch(data.messages[0].html, /<img|Image gallery/);
    } finally { f.close(); }
  }
});

test('image_group uses explicit image fields and rejects missing results instead of using query or source-page URLs', () => {
  const f = fixture();
  try {
    const marker = '\uE200image_group\uE202PRIVATE_QUERY\uE201', r = raw([marker]);
    const ref = { type: 'image_group', matched_text: marker, images: [], safe_urls: ['https://source.example.com/page'] };
    r.mapping.answer.message.metadata = { content_references: [ref] };
    for (const bad of [null, 'https://source.example.com/page', { image_search_query: 'PRIVATE_QUERY' }, { image_result: { url: 'https://source.example.com/page', title: 'PRIVATE_TITLE' } }]) {
      ref.images = [bad];
      assert.throws(() => f.w.ChatArchiveApi.normalize(r, URL, options()), error => {
        assert.match(error.message, /downloadable reference/);
        assert.equal(error.sourceDiagnostic.references[0].images, 1);
        assert.doesNotMatch(JSON.stringify(error.sourceDiagnostic), /PRIVATE|https:|source.example/);
        return true;
      });
    }
    ref.images = [{ image_result: { thumbnail_url: 'https://images.example.com/thumb.png', title: 'Preview' } }];
    assert.equal(f.w.ChatArchiveApi.normalize(r, URL, options()).messages[0].media[0].source.url, 'https://images.example.com/thumb.png');
    ref.images = [{ content_url: 'https://images.example.com/flat.png', title: 'Flat result' }];
    assert.equal(f.w.ChatArchiveApi.normalize(r, URL, options()).messages[0].media[0].source.url, 'https://images.example.com/flat.png');
  } finally { f.close(); }
});

test('sandbox image resolution is tied to the conversation and message', async () => {
  const f = fixture();
  try {
    const calls = [];
    f.w.fetch = async (url, init) => {
      calls.push(url);
      if (url.endsWith('/session')) return json({ accessToken: 'SECRET' });
      if (url.endsWith(`/conversation/${ID}`)) return json(raw(['![Plot](sandbox:/mnt/data/plot.png)']));
      if (url.includes('/interpreter/download?')) return json({ download_url: 'https://images.example.com/plot.png' });
      return new Response(png);
    };
    const result = await f.w.ChatArchiveApi.collect(options('pdf'), () => {});
    assert.equal(result.data.embeddedImages, 1);
    const endpoint = new global.URL(calls.find(url => url.includes('interpreter')));
    assert.equal(endpoint.searchParams.get('message_id'), 'answer');
    assert.equal(endpoint.searchParams.get('sandbox_path'), '/mnt/data/plot.png');
  } finally { f.close(); }
});

test('failed downloads and oversized image dimensions stop rather than silently omit images', async () => {
  const f = fixture();
  try {
    const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20);
    for (const response of [() => new Response('private failure', { status: 403 }), () => new Response(huge), () => new Response('not an image')]) {
      f.w.fetch = async url => url.endsWith('/session') ? json({}) : url.endsWith(`/conversation/${ID}`) ? json(raw(['![Image](https://images.example.com/p.png)'])) : response();
      await assert.rejects(f.w.ChatArchiveApi.collect(options(), () => {}), /Image 1 of 1.*No file was saved/);
    }
  } finally { f.close(); }
});

test('basic SVG diagrams retain their vector bytes; scripts, styles and remote references are rejected', () => {
  const f = fixture();
  try {
    const inspect = text => f.w.ChatArchiveApiMedia.inspect(new TextEncoder().encode(text));
    const result = inspect(svg);
    assert.equal(result.width, 640); assert.equal(result.height, 160); assert.equal(result.type, 'image/svg+xml');
    for (const fragment of ['<script>alert(1)</script>', '<image href="https://example.com/a.png"/>', '<rect style="fill:red"/>', '<use href="https://example.com/a.svg#x"/>']) {
      assert.throws(() => inspect(svg.replace('</svg>', fragment + '</svg>')), /unsupported/);
    }
  } finally { f.close(); }
});

test('image URL policy rejects local-network targets, userinfo and unsupported schemes', () => {
  const f = fixture();
  try {
    for (const url of ['https://127.0.0.1/a.png', 'https://192.168.1.1/a.png', 'https://a.local/a.png', 'https://user:pass@example.com/a', 'http://example.com/a', 'file:///a', 'javascript:alert(1)']) assert.throws(() => f.w.ChatArchiveApiMedia.allowedUrl(url));
    assert.equal(f.w.ChatArchiveApiMedia.allowedUrl('https://images.example.com/a.png').hostname, 'images.example.com');
  } finally { f.close(); }
});

test('raw Markdown diagrams and HTML remain visible code instead of executable document content', () => {
  const f = fixture();
  try {
    const result = f.w.ChatArchiveApi.normalize(raw(['```mermaid\ngraph LR\n    A --> B\n```\n\n```svg\n<svg onload="alert(1)"></svg>\n```']), URL, options());
    const doc = new JSDOM(result.messages[0].html).window.document;
    assert.equal(doc.querySelectorAll('pre code').length, 2);
    assert.equal(doc.querySelector('svg'), null);
    assert.match(doc.querySelector('code').textContent, /A --> B/);
  } finally { f.close(); }
});

test('visible finished tool images export in order; a visible assistant reference in the same response takes precedence', () => {
  const f = fixture();
  try {
    const r = raw();
    r.mapping.tool = { id: 'tool', parent: 'root', message: imageMessage('tool', 'tool', 'sediment://tool_image', { channel: 'commentary' }) };
    r.mapping.answer.parent = 'tool';
    for (const format of ['html', 'pdf']) {
      const messages = f.w.ChatArchiveApi.normalize(r, URL, options(format)).messages;
      assert.deepEqual(Array.from(messages, m => m.id), ['tool', 'answer']);
      assert.equal(messages[0].role, 'assistant');
      assert.equal(messages[0].media[0].source.pointer, 'sediment://tool_image');
    }
    r.mapping.answer.message.content.parts.push({ content_type: 'image_asset_pointer', asset_pointer: 'sediment://tool_image' });
    const messages = f.w.ChatArchiveApi.normalize(r, URL, options()).messages;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 'answer');
    assert.equal(messages[0].media.length, 1);
  } finally { f.close(); }
});

test('reported visible commentary/final image structure embeds without scrolling or hidden tool data', async () => {
  const f = fixture();
  try {
    const roles = ['user', 'user', 'tool', 'user', 'user', 'user', 'user', 'tool', 'tool', 'user', 'tool', 'tool'];
    const r = chain(roles.map((role, i) => imageMessage(`m${i}`, role, `sediment://file_${i}`, {
      channel: role === 'tool' ? i === 7 || i === 10 ? 'final' : 'commentary' : undefined,
      metadata: { is_visually_hidden_from_conversation: [8, 11].includes(i) }, create_time: 1700000000 + i
    })));
    r.mapping.m2.message.content.parts.unshift('PRIVATE_TOOL_PROMPT');
    r.mapping.m2.message.metadata.attachments = [{ name: 'PRIVATE_TOOL_ATTACHMENT' }];
    r.mapping.offBranch = { id: 'offBranch', parent: 'root', message: imageMessage('PRIVATE_OTHER_BRANCH', 'tool', 'sediment://PRIVATE_OTHER_BRANCH') };
    Object.defineProperty(f.w.document.documentElement, 'scrollTop', { set() { throw Error('Must not scroll'); }, get() { return 0; } });
    const requests = [];
    f.w.fetch = async url => {
      requests.push(url);
      if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
      if (url.endsWith(`/conversation/${ID}`)) return json(r);
      if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
      return new Response(png);
    };
    const result = await f.w.ChatArchiveApi.collect({ ...options(), includeTimestamps: true }, () => {});
    assert.ok(result.data, result.fallback);
    assert.equal(result.data.collectionMethod, 'chatgpt-api');
    assert.equal(result.data.embeddedImages, 10);
    assert.deepEqual(Array.from(result.data.messages, m => m.id), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm9', 'm10']);
    assert.deepEqual(Array.from(result.data.messages, m => m.order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(result.data.messages[2].createdAt, new Date(1700000002 * 1000).toISOString());
    assert.doesNotMatch(JSON.stringify(result.data), /PRIVATE|export-image-placeholder/);
    assert.equal(requests.some(url => /file_(?:8|11)\//.test(url)), false);
    assert.equal(requests.some(url => url.includes('PRIVATE')), false);
    const images = new JSDOM(f.w.ChatArchiveRenderers.html(result.data, {})).window.document.images;
    assert.equal(images.length, 10);
    for (const image of images) assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), png);
  } finally { f.close(); }
});

test('tool-image repeats are scoped to a response, while user reattachments and later replies remain', () => {
  const f = fixture();
  try {
    const pointer = 'sediment://same_file';
    const r = chain([imageMessage('user1', 'user', pointer), imageMessage('tool1', 'tool', pointer),
      imageMessage('tool2', 'tool', pointer), imageMessage('user2', 'user', pointer), imageMessage('tool3', 'tool', pointer)]);
    const messages = f.w.ChatArchiveApi.normalize(r, URL, options()).messages;
    assert.deepEqual(Array.from(messages, m => m.id), ['user1', 'tool1', 'user2', 'tool3']);
    for (const format of ['txt', 'md']) {
      assert.deepEqual(Array.from(f.w.ChatArchiveApi.normalize(r, URL, options(format)).messages, m => m.id), ['user1', 'user2']);
    }
  } finally { f.close(); }
});

test('hidden and analysis tool images are ignored; unsupported or unfinished visible outputs keep explicit fallback', () => {
  const f = fixture();
  try {
    for (const changes of [{ metadata: { is_visually_hidden_from_conversation: true } }, { channel: 'analysis' }]) {
      const r = raw();
      r.mapping.tool = { id: 'tool', parent: 'root', message: imageMessage('tool', 'tool', 'sediment://hidden', changes) };
      r.mapping.answer.parent = 'tool';
      const messages = f.w.ChatArchiveApi.normalize(r, URL, options()).messages;
      assert.equal(messages.length, 1); assert.equal(messages[0].id, 'answer');
    }
    for (const changes of [{ status: 'in_progress' }, { channel: 'unknown' }, { content: { content_type: 'future_format', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://future' }] } }]) {
      assert.throws(() => f.w.ChatArchiveApi.normalize(chain([imageMessage('tool', 'tool', 'sediment://visible', changes)]), URL, options()), /generated-image response/);
    }
  } finally { f.close(); }
});

test('generated-image fallback reports only bounded structural data from the active branch', async () => {
  const f = fixture();
  try {
    const r = raw(['PRIVATE_ANSWER']);
    r.mapping.tool = { id: 'tool', parent: 'root', message: { id: 'PRIVATE_ID', author: { role: 'tool', name: 'PRIVATE_TOOL' },
      channel: 'PRIVATE_CHANNEL', status: 'finished_successfully', metadata: { private_value: 'PRIVATE_METADATA' },
      content: { content_type: 'multimodal_text', parts: Array.from({ length: 15 }, () => ({ content_type: 'image_asset_pointer',
        asset_pointer: 'sediment://PRIVATE_FILE', width: 1024, height: 1536, url: 'https://private.invalid/PRIVATE_TOKEN', name: 'PRIVATE_NAME' })) } } };
    r.mapping.answer.parent = 'tool';
    r.mapping.offBranch = { id: 'offBranch', parent: 'root', message: { author: { role: 'tool' }, content: { parts: [{ content_type: 'image_asset_pointer' }] } } };
    f.w.fetch = async url => url.endsWith('/session') ? json({ accessToken: 'PRIVATE_TOKEN' }) : json(r);
    const result = await f.w.ChatArchiveApi.collect(options(), () => {});
    assert.match(result.fallback, /generated-image/);
    assert.equal(result.sourceDiagnostic.imageParts, 15);
    assert.equal(result.sourceDiagnostic.images.length, 12);
    assert.equal(result.sourceDiagnostic.truncated, true);
    assert.equal(result.sourceDiagnostic.images[0].tool, 'other');
    assert.equal(result.sourceDiagnostic.images[0].channel, 'other');
    assert.equal(result.sourceDiagnostic.images[0].width, 1024);
    assert.equal(result.sourceDiagnostic.images[0].pointerKind, 'sediment');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private\.invalid|https:/);
  } finally { f.close(); }
});

test('rich-reference failures report bounded types and field presence without marker payloads or metadata values', async () => {
  const f = fixture();
  try {
    const token = '\uE200cite\uE202PRIVATE_REFERENCE_ID\uE201';
    const r = raw([`PRIVATE_TEXT ${token}`]);
    const refs = Array.from({ length: 20 }, () => ({ type: 'PRIVATE_TYPE', matched_text: '\uE200PRIVATE_MARKER\uE202PRIVATE_PAYLOAD\uE201',
      PRIVATE_KEY: 'PRIVATE_VALUE', title: 'PRIVATE_TITLE', url: 'https://private.invalid/PRIVATE_URL' }));
    refs.push({ type: 'image_v2', matched_text: token, images: [], items: [{ content_url: 'https://private.invalid/image', title: 'PRIVATE_IMAGE' }] });
    r.mapping.answer.message.metadata = { content_references: refs };
    f.w.fetch = async url => url.endsWith('/session') ? json({ accessToken: 'PRIVATE_TOKEN' }) : json(r);
    let result = await f.w.ChatArchiveApi.collect(options(), () => {});
    assert.match(result.fallback, /image gallery/);
    let report = result.sourceDiagnostic;
    assert.equal(report.marker, 'cite'); assert.equal(report.context, 'assistant');
    assert.equal(report.referenceCount, 21); assert.equal(report.matchingReferenceCount, 1);
    assert.equal(report.references[0].type, 'image_v2'); assert.equal(report.references[0].matches, true);
    assert.ok(report.references[0].firstItemFields.includes('content_url'));
    assert.ok(report.references.length <= 8); assert.equal(report.referencesTruncated, true);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private\.invalid|https:/);

    r.mapping.answer.message.metadata.content_references = [{ type: 'PRIVATE_TYPE', matched_text: token }];
    result = await f.w.ChatArchiveApi.collect(options(), () => {});
    assert.equal(result.sourceDiagnostic.matchingReferenceCount, 1);
    assert.equal(result.sourceDiagnostic.references[0].type, 'other');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);

    r.mapping.answer.message.content.parts = ['PRIVATE_TEXT \uE200PRIVATE_KIND\uE202PRIVATE_PAYLOAD\uE201'];
    result = await f.w.ChatArchiveApi.collect(options(), () => {});
    assert.equal(result.sourceDiagnostic.marker, 'other'); assert.equal(result.sourceDiagnostic.matchingReferenceCount, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  } finally { f.close(); }
});

test('missing saved-activity references are identified separately from response and image failures', async () => {
  const f = fixture();
  try {
    const r = raw(['PRIVATE_ACTIVITY \uE200entity\uE202PRIVATE_REFERENCE\uE201']);
    r.mapping.answer.message.channel = 'commentary';
    r.mapping.answer.message.content.content_type = 'text';
    f.w.fetch = async url => url.endsWith('/session') ? json({ accessToken: 'PRIVATE_TOKEN' }) : json(r);
    const result = await f.w.ChatArchiveApi.collect({ ...options(), includeActivity: true }, () => {});
    assert.match(result.fallback, /rich content/); assert.equal(result.sourceDiagnostic.context, 'activity');
    assert.equal(result.sourceDiagnostic.marker, 'entity'); assert.equal(result.sourceDiagnostic.referenceCount, 0);
    assert.equal(result.sourceDiagnostic.matchingReferenceCount, 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  } finally { f.close(); }
});

test('Stop aborts a pending image download instead of falling back or returning partial HTML', { timeout: 2000 }, async () => {
  const f = fixture();
  try {
    let started, stopped = false, aborted = false;
    const imageStarted = new Promise(resolve => { started = resolve; });
    f.w.fetch = async (url, init) => {
      if (url.endsWith('/session')) return json({});
      if (url.endsWith(`/conversation/${ID}`)) return json(raw(['![Image](https://images.example.com/wait.png)']));
      started();
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(Error('aborted')); }));
    };
    const pending = f.w.ChatArchiveApi.collect(options(), () => { if (stopped) throw Error('Export stopped'); });
    const rejected = assert.rejects(pending, /Export stopped/);
    await imageStarted; stopped = true;
    await rejected;
    assert.equal(aborted, true);
  } finally { f.close(); }
});

test('embedded images must decode successfully before a direct HTML result is returned', async () => {
  const f = fixture();
  try {
    f.w.Image = class { async decode() { throw Error('corrupt image'); } };
    f.w.fetch = async url => url.endsWith('/session') ? json({}) : url.endsWith(`/conversation/${ID}`) ? json(raw(['![Image](https://images.example.com/broken.png)'])) : new Response(png);
    await assert.rejects(f.w.ChatArchiveApi.collect(options(), () => {}), /Image 1 of 1.*No file was saved/);
  } finally { f.close(); }
});

test('more than 16 Mi characters of images split while preserving bytes without legacy technical captions', async () => {
  const f = fixture();
  try {
    const bytes = Buffer.alloc(4 * 1024 * 1024); png.copy(bytes);
    const r = chain([imageMessage('u', 'user', 'sediment://first'), imageMessage('g', 'tool', 'sediment://second'), imageMessage('last', 'user', 'sediment://third')]);
    let active = 0, maximum = 0;
    f.w.fetch = async url => {
      active++; maximum = Math.max(maximum, active);
      await Promise.resolve(); active--;
      if (url.endsWith('/session')) return json({});
      if (url.endsWith(`/conversation/${ID}`)) return json(r);
      if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
      return new Response(bytes);
    };
    const parts = [];
    const result = await f.w.ChatArchiveApi.collect({ ...options(), includeImageDetails: true }, () => {}, () => {}, async part => {
      const doc = new JSDOM(part.messages.map(m => m.html).join('')).window.document;
      for (const image of doc.images) assert.deepEqual(Buffer.from(image.src.split(',')[1], 'base64'), bytes);
      const captions = [...doc.querySelectorAll('figcaption')].map(n => n.textContent);
      parts.push({ ids: Array.from(part.messages, m => m.id), size: part.messages.reduce((sum, m) => sum + m.html.length, 0), captions });
    });
    assert.ok(result.data, result.fallback);
    assert.equal(result.data.multipart.parts, 2); assert.equal(result.data.multipart.messages, 3);
    assert.equal(result.data.messages.length, 0); assert.equal(result.data.embeddedImages, 3);
    assert.deepEqual(parts.map(p => p.ids), [['u', 'g'], ['last']]);
    assert.ok(parts.every(p => p.size < 12 * 1024 * 1024));
    assert.ok(parts.reduce((sum, p) => sum + p.size, 0) > 16 * 1024 * 1024);
    assert.ok(parts.every(part => part.captions.length === 0));
    assert.equal(maximum, 1);
  } finally { f.close(); }
});

test('staging failure stops without preparing subsequent messages or returning a partial success', async () => {
  const f = fixture();
  try {
    // Use the production pixel threshold; no large raster allocation is needed.
    const big = Buffer.from(png); big.writeUInt32BE(4000, 16); big.writeUInt32BE(4000, 20);
    const r = chain(['first', 'second', 'third'].map(id => imageMessage(id, 'user', `sediment://${id}`)));
    let images = 0;
    f.w.fetch = async url => {
      if (url.endsWith('/session')) return json({});
      if (url.endsWith(`/conversation/${ID}`)) return json(r);
      if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
      images++; return new Response(big);
    };
    await assert.rejects(f.w.ChatArchiveApi.collect(options(), () => {}, () => {}, async () => { throw Error('Disk quota fixture'); }), /Disk quota fixture/);
    assert.equal(images, 2);
  } finally { f.close(); }
});

test('Stop and image errors retain only complete messages, never a partially embedded answer', async () => {
  for (const reason of ['stop', 'http', 'reference']) {
    const f = fixture();
    try {
      const first = imageMessage('first', 'user', 'sediment://first');
      const second = imageMessage('second', 'assistant', 'sediment://second-a');
      second.content.parts.push({ content_type: 'image_asset_pointer', asset_pointer: 'sediment://second-b' });
      const r = chain([first, second, imageMessage('later', 'user', 'sediment://later')]);
      let stopped = false, fetchedImages = 0;
      const check = () => { if (stopped) { const error = Error('Stopped'); error.exportStopped = true; throw error; } };
      f.w.fetch = async url => {
        if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
        if (url.endsWith(`/conversation/${ID}`)) return json(r);
        if (url.includes('/second-b/download') && reason === 'reference') return json({}, 403);
        if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
        fetchedImages++;
        if (url.endsWith('/second-b/image')) {
          if (reason === 'stop') { stopped = true; throw Error('PRIVATE_ERROR'); }
          return new Response('PRIVATE_RESPONSE', { status: 503 });
        }
        return new Response(png);
      };
      await assert.rejects(f.w.ChatArchiveApi.collect(options(), check), error => {
        assert.equal(reason === 'stop' ? error.exportStopped : error.imageEmbedFailed, true);
        const partial = error.partialData;
        assert.deepEqual(Array.from(partial.messages, message => message.id), ['first']);
        assert.equal(partial.embeddedImages, 1);
        assert.deepEqual(JSON.parse(JSON.stringify(partial.partialExport)), { reason: reason === 'stop' ? 'stopped' : 'image-error', messages: 1, totalMessages: 3 });
        assert.doesNotMatch(JSON.stringify(partial), /second|later|PRIVATE|sediment:|export-image-placeholder/);
        const output = f.w.ChatArchiveRenderers.html(partial, { includeTitle: false });
        assert.match(output, /Partial export/); assert.match(output, /1 of 3 complete messages/);
        if (reason !== 'stop') {
          assert.equal(error.mediaDiagnostic.image, 3); assert.equal(error.mediaDiagnostic.total, 4);
          assert.equal(error.mediaDiagnostic.phase, reason === 'reference' ? 'reference' : 'download');
          assert.equal(error.mediaDiagnostic.download.httpStatus, reason === 'reference' ? 403 : 503);
          assert.doesNotMatch(JSON.stringify(error.mediaDiagnostic), /PRIVATE|https:|sediment:/);
        }
        return true;
      });
      assert.equal(fetchedImages, reason === 'reference' ? 2 : reason === 'http' ? 5 : 3);
    } finally { f.close(); }
  }
});

test('stopped multipart preparation keeps acknowledged parts once and flushes the completed tail', async () => {
  for (const point of ['during-stage', 'next-image', 'image-error', 'disk-error']) {
    const f = fixture();
    try {
      const big = Buffer.from(png); big.writeUInt32BE(4000, 16); big.writeUInt32BE(4000, 20);
      const r = chain(['first', 'second', 'third'].map(id => imageMessage(id, 'user', `sediment://${id}`)));
      let stopped = false, images = 0; const parts = [], flags = [];
      f.w.fetch = async url => {
        if (url.endsWith('/session')) return json({});
        if (url.endsWith(`/conversation/${ID}`)) return json(r);
        if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
        images++;
        if (url.endsWith('/third/image') && point !== 'during-stage') {
          if (point !== 'image-error') stopped = true;
          return new Response('Unavailable', { status: 403 });
        }
        return new Response(big);
      };
      const check = () => { if (stopped) { const error = Error('Stopped'); error.exportStopped = true; throw error; } };
      const onPart = async (data, options) => {
        if (options.stopped && point === 'disk-error') throw Error('Disk write failed');
        parts.push(Array.from(data.messages, message => message.id)); flags.push(options.stopped);
        if (point === 'during-stage') stopped = true;
      };
      await assert.rejects(f.w.ChatArchiveApi.collect(options(), check, () => {}, onPart), error => {
        if (point === 'disk-error') { assert.match(error.message, /Disk write failed/); assert.equal(error.partialData, undefined); return true; }
        const expected = 2;
        assert.equal(error.partialData.multipart.parts, expected); assert.equal(error.partialData.multipart.messages, expected);
        assert.equal(error.partialData.messages.length, 0); assert.equal(error.partialData.partialExport.totalMessages, 3);
        assert.deepEqual(parts, [['first'], ['second']]);
        assert.deepEqual(flags, [false, true]);
        return true;
      });
    } finally { f.close(); }
  }
});

test('image source switches prevent excluded downloads and stale details settings add no captions', async () => {
  for (const [includeUserImages, includeAssistantImages] of [[true, true], [true, false], [false, true], [false, false]]) {
    const f = fixture();
    try {
      const user = imageMessage('u', 'user', 'sediment://user_image'); user.content.parts.unshift('Question');
      const tool = imageMessage('g', 'tool', 'sediment://generated_image');
      const assistant = { id: 'a', author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Answer ![Example](https://images.example.com/answer.png)'] } };
      const r = chain([user, tool, assistant]), calls = [];
      f.w.fetch = async url => {
        calls.push(url);
        if (url.endsWith('/session')) return json({});
        if (url.endsWith(`/conversation/${ID}`)) return json(r);
        if (url.endsWith('/download')) return json({ download_url: url.replace('/download', '/image') });
        return new Response(png);
      };
      const result = await f.w.ChatArchiveApi.collect({ ...options(), includeUserImages, includeAssistantImages, includeImageDetails: true }, () => {});
      assert.ok(result.data, result.fallback);
      assert.equal(result.data.embeddedImages || 0, Number(includeUserImages) + Number(includeAssistantImages) * 2);
      assert.equal(calls.some(url => url.includes('user_image')), includeUserImages);
      assert.equal(calls.some(url => url.includes('generated_image')), includeAssistantImages);
      assert.equal(calls.some(url => url.includes('answer.png')), includeAssistantImages);
      assert.doesNotMatch(result.data.messages.map(m => m.html).join(''), /figcaption|original file not verified/);
    } finally { f.close(); }
  }
});
