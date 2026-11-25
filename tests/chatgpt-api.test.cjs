const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc';
const URL = `https://chatgpt.com/c/${ID}`;
const clone = value => JSON.parse(JSON.stringify(value));
function node(id, parent, role, text, extra = {}) {
  return { id, parent, message: role ? { id, author: { role }, content: { content_type: 'text', parts: [text] },
    status: 'finished_successfully', create_time: 1700000000, ...extra } : null };
}
function conversation() {
  return { conversation_id: ID, title: 'Synthetic conversation', current_node: 'answer', mapping: {
    root: node('root', null), question: node('question', 'root', 'user', 'Question'),
    old: node('old', 'question', 'assistant', 'OLD ALTERNATIVE'),
    answer: node('answer', 'question', 'assistant', 'Answer')
  } };
}
function fixture(url = URL, runtime = false) {
  const dom = new JSDOM('<main></main>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, sent = [];
  const clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  w.TextDecoder = TextDecoder;
  w.matchMedia = () => ({ matches: false });
  w.browser = { runtime: { onMessage: { addListener: fn => { w.receive = fn; } }, sendMessage: async request => { sent.push(request); return { ok: true }; } } };
  w.eval(read('content/chatgpt-api.js'));
  if (runtime) for (const file of ['shared/timestamps.js', 'content/timestamps.js', 'content/extract.js', 'content/content.js', 'shared/renderers.js']) w.eval(read(file));
  return { w, api: w.ChatArchiveApi, clock, sent, close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const options = { outputFormat: 'md', includeLinks: true };

test('direct reader supports all five ChatGPT formats and excludes selected-only collection', () => {
  const f = fixture();
  try {
    assert.equal(f.api.eligible(options), true);
    for (const outputFormat of ['html', 'pdf']) assert.equal(f.api.eligible({ outputFormat }), true);
    assert.equal(f.api.eligible({ outputFormat: 'json' }), true);
    assert.equal(f.api.eligible({ ...options, selectedOnly: true }), false);
    assert.equal(f.api.conversationId(`https://chatgpt.com/g/g-p-project/c/${ID}`), ID);
    for (const url of ['https://chatgpt.com/', 'https://chatgpt.com/?temporary-chat=true', `${URL}?temporary-chat=true`,
      `https://chatgpt.com/g/g-p-${ID}`, `https://example.com/c/${ID}`, `https://gemini.google.com/c/${ID}`]) assert.equal(f.api.conversationId(url), null);
  } finally { f.close(); }
});

test('active branch has exact original Markdown, code whitespace and timestamps; old alternatives are excluded', () => {
  const f = fixture();
  try {
    const raw = conversation();
    const code = 'Before\n\n````python\nif x < 3:\n    print("```", "[x](https://code.invalid)")\n\nnext()\n````\n\nAfter';
    raw.mapping.answer.message.content.parts = [code];
    const result = f.api.normalize(raw, URL, { ...options, includeTimestamps: true }, ['answer']);
    assert.deepEqual(clone(result.messages.map(m => m.id)), ['question', 'answer']);
    assert.equal(result.messages[1].markdown, code);
    assert.equal(result.messages[1].createdAt, '2023-11-14T22:13:20.000Z');
    assert.equal(result.messages[1].text, undefined);
  } finally { f.close(); }
});

test('links option and TXT conversion never rewrite links, indentation or blank lines inside code', () => {
  const f = fixture();
  try {
    const raw = conversation();
    raw.mapping.answer.message.content.parts = ['# Heading\n\n**Bold** [site](https://example.com) and `[inline](https://code.invalid)`\n\n~~~js\n    const x = "[x](https://code.invalid)";\n\n~~~\n\nDone'];
    const md = f.api.normalize(raw, URL, { ...options, includeLinks: false }).messages[1].markdown;
    assert.match(md, /\*\*Bold\*\* site and `\[inline\]\(https:\/\/code.invalid\)`/);
    assert.match(md, /~~~js\n    const x = "\[x\]\(https:\/\/code.invalid\)";\n\n~~~/);
    const txt = f.api.normalize(raw, URL, { outputFormat: 'txt', includeLinks: false }).messages[1].text;
    assert.equal(txt, 'Heading\n\nBold site and [inline](https://code.invalid)\n\n    const x = "[x](https://code.invalid)";\n\n\nDone');
  } finally { f.close(); }
});

test('broken, cyclic or unidentified conversation branches never become a successful partial export', () => {
  const f = fixture();
  try {
    const changes = [r => { delete r.mapping.question; }, r => { r.mapping.question.parent = 'answer'; },
      r => { delete r.current_node; }, r => { r.current_node = 'missing'; }, r => { delete r.conversation_id; },
      r => { r.mapping.question.message.id = 'answer'; }, r => { delete r.mapping.root.parent; }];
    for (const change of changes) { const r = conversation(); change(r); assert.throws(() => f.api.normalize(r, URL, options)); }
    assert.throws(() => f.api.normalize(conversation(), URL, options, ['old']), /displayed branch/);
    const wrong = conversation(); wrong.conversation_id = 'aaaaaaaa-1234-1234-1234-123456789abc';
    assert.throws(() => f.api.normalize(wrong, URL, options), /different conversation/);
  } finally { f.close(); }
});

test('separate inline code spans do not swallow prose links between them', () => {
  const f = fixture();
  try {
    const raw = conversation();
    raw.mapping.answer.message.content.parts = ['`first` [site](https://example.com) `last` and ``a`b [literal](https://code.invalid)``'];
    const md = f.api.normalize(raw, URL, { ...options, includeLinks: false }).messages[1].markdown;
    assert.equal(md, '`first` site `last` and ``a`b [literal](https://code.invalid)``');
    const txt = f.api.normalize(raw, URL, { outputFormat: 'txt', includeLinks: false }).messages[1].text;
    assert.equal(txt, 'first site last and a`b [literal](https://code.invalid)');
  } finally { f.close(); }
});

test('tool, hidden and activity messages do not leak into ordinary text export', () => {
  const f = fixture();
  try {
    const r = conversation();
    r.mapping.hidden = node('hidden', 'question', 'assistant', 'HIDDEN', { metadata: { is_visually_hidden_from_conversation: true } });
    r.mapping.thought = node('thought', 'hidden', 'assistant', 'THOUGHT', { channel: 'analysis' });
    r.mapping.tool = node('tool', 'thought', 'tool', 'TOOL');
    r.mapping.answer.parent = 'tool';
    assert.deepEqual(clone(f.api.normalize(r, URL, options).messages.map(m => m.markdown)), ['Question', 'Answer']);
    r.mapping.answer.message.status = 'in_progress';
    assert.throws(() => f.api.normalize(r, URL, options), /finish/);
  } finally { f.close(); }
});

test('image and file placeholders are explicit, citations retain source URLs, unknown rich data requests DOM fallback', () => {
  const f = fixture();
  try {
    const r = conversation(), a = r.mapping.answer.message;
    const token = '\uE200cite\uE202turn0search0\uE201';
    a.content = { content_type: 'multimodal_text', parts: [`Result ${token}`, { content_type: 'image_asset_pointer', asset_pointer: 'PRIVATE_INTERNAL_POINTER' }] };
    a.metadata = { content_references: [{ type: 'grouped_webpages', matched_text: token, items: [{ url: 'https://example.com/source', title: 'Source' }] }], attachments: [{ name: 'input.csv' }] };
    const value = f.api.normalize(r, URL, options).messages[1].markdown;
    assert.match(value, /\[Source\]\(<https:\/\/example.com\/source>\)/);
    assert.match(value, /image data is not included/);
    assert.match(value, /input.csv/);
    assert.doesNotMatch(value, /PRIVATE_INTERNAL_POINTER|\uE200/);
    a.metadata.content_references = [];
    assert.match(f.api.normalize(r, URL, options).messages[1].markdown, /Source link unavailable/);
    a.content.parts[0] = 'Result \uE200unknown\uE202private\uE201';
    assert.throws(() => f.api.normalize(r, URL, options), /rich content/);
    a.content = { content_type: 'audio', parts: [] };
    assert.throws(() => f.api.normalize(r, URL, options), /message type/);
  } finally { f.close(); }
});

test('direct collection uses only same-origin GETs, no token in output, no DOM scrolling, no stale response cache', async () => {
  const f = fixture(URL, true);
  try {
    const calls = []; let exportNumber = 0;
    f.w.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/session')) return json({ accessToken: 'SECRET_TOKEN' });
      const r = conversation(); r.mapping.answer.message.content.parts = [`Fresh ${++exportNumber}`]; return json(r);
    };
    Object.defineProperty(f.w.document.documentElement, 'scrollTop', { set() { throw Error('Direct export must not scroll'); }, get() { return 0; } });
    for (let i = 1; i <= 2; i++) {
      const result = await f.api.collect(options, () => {});
      assert.equal(result.data.messages[1].markdown, `Fresh ${i}`);
      assert.doesNotMatch(JSON.stringify(result), /SECRET_TOKEN/);
    }
    assert.equal(calls.length, 4);
    assert.ok(calls.every(c => c.url.startsWith('https://chatgpt.com/') && c.init.method === 'GET' && c.init.credentials === 'include' && c.init.cache === 'no-store' && c.init.redirect === 'error'));
    assert.equal(calls[1].init.headers.authorization, 'Bearer SECRET_TOKEN');
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('HTTP errors, missing auth and unsupported responses fall back without copying private server errors', async () => {
  const f = fixture();
  try {
    for (const response of [json({ secret: 'PRIVATE_ERROR' }, 403), new Response('PRIVATE_ERROR', { headers: { 'content-type': 'text/html' } }),
      new Response('{invalid PRIVATE_ERROR', { headers: { 'content-type': 'application/json' } })]) {
      f.w.fetch = async url => url.endsWith('/session') ? json({ error: 'not authenticated' }, 401) : response;
      const result = await f.api.collect(options, () => {});
      assert.ok(result.fallback);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR/);
    }
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('response declared oversized is stopped before reading or making a partial file', async () => {
  const f = fixture();
  try {
    f.w.fetch = async url => url.endsWith('/session') ? json({}) : new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': 40 * 1024 * 1024 } });
    await assert.rejects(f.api.collect(options, () => {}), /memory limit/);
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('route change and Stop abort an in-flight request without initiating page fallback', async () => {
  for (const reason of ['route', 'stop']) {
    const f = fixture();
    try {
      let stopped = false, aborted = false;
      f.w.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(Error('aborted')); }));
      const result = f.api.collect(options, () => { if (stopped) throw Error('Export stopped'); });
      const rejected = assert.rejects(result, reason === 'route' ? /conversation changed/ : /Export stopped/);
      if (reason === 'route') f.w.history.pushState({}, '', '/c/aaaaaaaa-1234-1234-1234-123456789abc');
      else stopped = true;
      await f.clock.tickAsync(100);
      await rejected;
      assert.equal(aborted, true);
      assert.equal(f.clock.countTimers(), 0);
    } finally { f.close(); }
  }
});

test('stalled request has a finite timeout and no lingering monitor', async () => {
  const f = fixture();
  try {
    f.w.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
    const pending = f.api.collect(options, () => {});
    await f.clock.tickAsync(25000);
    assert.match((await pending).fallback, /timed out/);
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('1200-message runtime export bypasses missing DOM IDs, includes first/middle/last and reaches existing MD renderer', async () => {
  const f = fixture(URL, true);
  try {
    const r = conversation(); r.mapping = { root: node('root', null) };
    for (let i = 0; i < 1200; i++) r.mapping[`m${i}`] = node(`m${i}`, i ? `m${i - 1}` : 'root', i % 2 ? 'assistant' : 'user', `Message ${i}\n\n\`\`\`python\n    print(${i})\n\`\`\``);
    r.current_node = 'm1199';
    f.w.document.querySelector('main').innerHTML = '<div data-user-message-bubble>Message without stable DOM ID</div>';
    f.w.fetch = async url => json(url.endsWith('/session') ? { accessToken: 'SECRET' } : r);
    const result = await f.w.receive({ type: 'COLLECT', options });
    assert.equal(result.collectionMethod, 'chatgpt-api');
    assert.equal(result.messages.length, 1200);
    for (const i of [0, 600, 1199]) assert.equal(result.messages[i].id, `m${i}`);
    const output = f.w.ChatArchiveRenderers.md(result, {});
    assert.equal((output.match(/```python/g) || []).length, 1200);
    assert.doesNotMatch(output, /SECRET/);
    assert.equal(f.clock.now, 0, 'no scroll delay is scheduled');
  } finally { f.close(); }
});

test('network failure stops saved-chat export without scrolling or saving an incomplete page', async () => {
  const f = fixture(URL, true);
  try {
    f.w.document.querySelector('main').innerHTML = '<article data-testid="conversation-turn-0" data-message-author-role="user">Page question</article>';
    f.w.fetch = async () => { throw Error('private network error'); };
    const pending = f.w.receive({ type: 'COLLECT', options });
    const rejected = assert.rejects(pending, /Automatic page scrolling is disabled/);
    await f.clock.runAllAsync();
    await rejected;
  } finally { f.close(); }
});

test('HTML visual-component fallback collects rendered card content instead of raw API component source', async () => {
  const f = fixture(URL, true);
  try {
    for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js']) f.w.eval(read(file));
    const html = read('tests/fixtures/rich-cards.html');
    f.w.document.querySelector('main').outerHTML = html.slice(html.indexOf('<main>'));
    f.w.document.querySelector('main').insertAdjacentHTML('afterbegin', '<div data-message-author-role="user" data-message-id="question">Page question</div>');
    const r = conversation(); r.mapping.answer.message.content.parts = ['<box gap={3}><AsyncImage query="browser"/><Entity value="Example browser"/></box>'];
    f.w.fetch = async url => json(url.endsWith('/session') ? { accessToken: 'SECRET' } : r);
    const pending = f.w.receive({ type: 'COLLECT', options: { outputFormat: 'html', includeLinks: true } });
    await f.clock.runAllAsync();
    const result = await pending;
    assert.equal(result.collectionMethod, 'chatgpt-api-rendered');
    assert.equal(result.messages.length, 2);
    assert.match(result.messages[1].html, /A description that should wrap beside the image/);
    assert.doesNotMatch(result.messages[1].html, /AsyncImage|SECRET/);
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

function eightVisualMessages(f, mutate = () => {}) {
  for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js']) f.w.eval(read(file));
  const raw = { conversation_id: ID, current_node: 'm7', mapping: { root: node('root', null) } };
  const dom = [];
  for (let i = 0; i < 8; i++) {
    const role = i % 2 ? 'assistant' : 'user';
    raw.mapping[`m${i}`] = node(`m${i}`, i ? `m${i-1}` : 'root', role, i === 1 ? '<box gap={3}><AsyncImage query="Unmapped image"/><Entity value="Card"/></box>' : `Message ${i}`);
    dom.push(i % 2 ? `<div data-chatgpt-selection-message-id="m${i}"><p>Rendered message ${i}</p></div>`
      : `<div data-turn-key="turn-${i}" data-chatgpt-search-message-ids='["m${i}"]'><div data-user-message-bubble>Rendered message ${i}</div></div>`);
  }
  f.w.document.querySelector('main').innerHTML = dom.join('');
  f.w.fetch = async url => json(url.endsWith('/session') ? { accessToken: 'SECRET' } : raw);
  mutate(f.w.document.querySelector('main'), raw);
  return raw;
}

test('all eight rendered messages verified against the API branch export without a single scroll write', async () => {
  const f = fixture(URL, true);
  try {
    eightVisualMessages(f);
    const host = f.w.document.querySelector('main'); host.style.overflowY = 'auto';
    let scrollWrites = 0;
    Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 5000 },
      scrollTop: { get: () => 4400, set: () => { scrollWrites++; } } });
    let imageChecks = 0;
    f.w.ChatArchiveMedia = { beginExport() {}, endExport() {}, preserve() {}, waitForImages: async () => { imageChecks++; } };
    const pending = f.w.receive({ type: 'COLLECT', options: { outputFormat: 'html', waitForImages: true } });
    const resultPromise = pending.then(value => ({ value }), error => ({ error }));
    await f.clock.runAllAsync();
    const { value: result, error } = await resultPromise;
    assert.ifError(error);
    assert.equal(scrollWrites, 0);
    assert.equal(imageChecks, 1);
    assert.equal(result.messages.length, 8);
    assert.equal(result.collectionMethod, 'chatgpt-api-rendered');
    assert.deepEqual(clone(result.messages.map(m => new JSDOM(m.html).window.document.body.textContent.trim())), Array.from({ length: 8 }, (_, i) => i === 1 ? 'Rendered message 1' : `Message ${i}`));
    assert.ok(result.messages.every(m => !('sourceMessageId' in m)));
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('rendered branch verification rejects missing, duplicated and reordered messages', async () => {
  for (const change of ['missing', 'duplicate', 'reordered', 'changed-during-images']) {
    const f = fixture(URL, true);
    try {
      eightVisualMessages(f);
      const main = f.w.document.querySelector('main');
      const mutate = () => {
        if (change === 'missing') main.querySelector('[data-chatgpt-selection-message-id="m1"]').remove();
        else if (change === 'duplicate') main.lastElementChild.setAttribute('data-chatgpt-selection-message-id', 'm5');
        else if (change === 'reordered') main.prepend(main.lastElementChild);
        else main.lastElementChild.setAttribute('data-chatgpt-selection-message-id', 'foreign-after-image-load');
      };
      if (change !== 'changed-during-images') mutate();
      else f.w.ChatArchiveMedia = { beginExport() {}, endExport() {}, preserve() {}, waitForImages: async () => { mutate(); } };
      const pending = f.w.receive({ type: 'COLLECT', options: { outputFormat: 'html', waitForImages: true } });
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await f.clock.runAllAsync();
      const result = await settled;
      assert.ok(result.error, change + ': must not return incomplete or different rendered data');
      assert.match(result.error.message, /Automatic page scrolling is disabled|identifier is shared by multiple messages/, change);
      assert.equal(f.clock.countTimers(), 0);
    } finally { f.close(); }
  }
});

test('a mounted rich answer uses API messages outside the viewport without scrolling', async () => {
  const f = fixture(URL, true);
  try {
    const raw=eightVisualMessages(f);
    raw.mapping.m1.message.content.parts=['<card>Chart</card>\uE200unknown-reference\uE201'];
    raw.mapping.m1.message.metadata={content_references:[{type:'new-widget-reference',matched_text:'\uE200unknown-reference\uE201'}]};
    const main=f.w.document.querySelector('main');
    [...main.children].forEach((child,index)=>{if(![1,6,7].includes(index))child.remove();});
    const rich=main.firstElementChild;
    rich.removeAttribute('data-chatgpt-selection-message-id');rich.setAttribute('data-message-author-role','assistant');
    rich.innerHTML='<div data-dil-source-message-id="m1"><div data-dil-message-id="m1"><p>Rendered message 1</p></div></div>';
    let writes=0;
    main.style.overflowY='auto';
    Object.defineProperties(main,{clientHeight:{value:600},scrollHeight:{value:5000},scrollTop:{get:()=>4400,set:()=>writes++}});
    const pending=f.w.receive({type:'COLLECT',options:{outputFormat:'html',includeTimestamps:true}});
    const settled=pending.then(value=>({value}),error=>({error}));await f.clock.runAllAsync();
    const {value:result,error}=await settled;assert.ifError(error);
    assert.equal(writes,0);assert.equal(result.collectionMethod,'chatgpt-api-rendered');
    assert.deepEqual(clone(result.messages.map(m=>m.id)),Array.from({length:8},(_,i)=>`m${i}`));
    assert.match(result.messages[0].html,/Message 0/);assert.match(result.messages[1].html,/Rendered message 1/);
    assert.match(result.messages[4].html,/Message 4/);assert.match(result.messages[7].html,/Message 7/);
    assert.ok(result.messages[1].createdAt);assert.doesNotMatch(JSON.stringify(result),/unknown-reference|SECRET/);
  }finally{f.close();}
});

test('a rich answer mixed with generated tool images does not guess their DOM grouping',async()=>{
  const f=fixture(URL,true);try{
    const raw=eightVisualMessages(f);
    raw.mapping.generated=node('generated','m7','tool','',{
      content:{content_type:'multimodal_text',parts:[{content_type:'image_asset_pointer',asset_pointer:'file-service://image-1'}]}
    });raw.current_node='generated';
    let calls=0;
    const result=await f.api.collect({outputFormat:'html'},()=>{},()=>{},undefined,async()=>{calls++;return new Map();});
    assert.equal(result.data,undefined);assert.equal(result.pageMessages,null);assert.equal(calls,0);
    assert.match(result.fallback,/unsupported layout, expression or reference/);
  }finally{f.close();}
});

test('an exactly identified rendered answer does not require page identifiers for API-only neighbours', async () => {
  for (const outputFormat of ['html', 'pdf']) {
    const f = fixture(URL, true);
    try {
      for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js']) f.w.eval(read(file));
      const raw = conversation();
      raw.mapping.answer.message.content.parts = ['<card><AsyncImage query="Unmapped image"/></card>'];
      f.w.fetch = async url => json(url.endsWith('/session') ? {} : raw);
      const main = f.w.document.querySelector('main');
      // This bubble has neither an API ID nor a stable page key. It must not be
      // snapshotted or prepared: its authoritative text is already in the API.
      main.innerHTML = '<div data-user-message-bubble>PAGE_ONLY_NEIGHBOUR</div><div data-chatgpt-selection-message-id="answer"><section data-d-component="card"><p>Rendered card answer</p></section></div>';
      let writes = 0, imageChecks = 0;
      main.style.overflowY = 'auto';
      Object.defineProperties(main, { clientHeight: { value: 600 }, scrollHeight: { value: 5000 }, scrollTop: { get: () => 4400, set: () => { writes++; } } });
      f.w.ChatArchiveMedia = { beginExport() {}, endExport() {}, preserve() {}, waitForImages: async getRoots => {
        const roots = getRoots(); imageChecks++;
        assert.equal(roots.length, 1); assert.equal(roots[0].node.getAttribute('data-chatgpt-selection-message-id'), 'answer');
      } };
      const pending = f.w.receive({ type: 'COLLECT', options: { outputFormat, waitForImages: true } });
      const settled = pending.then(value => ({ value }), error => ({ error }));
      await f.clock.runAllAsync();
      const { value, error } = await settled;
      assert.ifError(error);
      assert.equal(value.collectionMethod, 'chatgpt-api-rendered');
      assert.deepEqual(clone(value.messages.map(message => message.id)), ['question', 'answer']);
      assert.match(value.messages[0].html, /Question/);
      assert.match(value.messages[1].html, /Rendered card answer/);
      assert.doesNotMatch(JSON.stringify(value), /PAGE_ONLY_NEIGHBOUR|AsyncImage|Unmapped/);
      assert.equal(imageChecks, 1); assert.equal(writes, 0);
    } finally { f.close(); }
  }
});

test('unmatched rendered answers report fixed reasons and counts without conversation data', async () => {
  for (const failure of ['missing', 'ambiguous', 'role', 'changed-during-images']) {
    const f = fixture(URL, true);
    try {
      eightVisualMessages(f);
      const main = f.w.document.querySelector('main');
      const card = main.querySelector('[data-chatgpt-selection-message-id="m1"]');
      if (failure === 'missing') card.remove();
      if (failure === 'ambiguous') main.firstElementChild.setAttribute('data-chatgpt-search-message-ids', '["m0","PRIVATE_ID"]');
      if (failure === 'role') card.setAttribute('data-message-author-role', 'user');
      if (failure === 'changed-during-images') f.w.ChatArchiveMedia = { beginExport() {}, endExport() {}, preserve() {}, waitForImages: async () => { card.remove(); } };
      await f.w.receive({ type: 'BEGIN_EXPORT', job: { format: 'html', filename: 'test.html', options: {} } });
      await f.clock.tickAsync(100);
      const status = (await f.w.receive({ type: 'PING' })).exportStatus;
      assert.equal(status.state, 'error');
      const diagnostic = clone(status.sourceDiagnostic);
      assert.equal(diagnostic.reason, 'rendered-message-match-failed');
      assert.equal(diagnostic.code, { missing: 'RENDERED_MESSAGE_NOT_LOADED', ambiguous: 'RENDERED_ID_AMBIGUOUS', role: 'RENDERED_ROLE_MISMATCH', 'changed-during-images': 'RENDERED_MESSAGE_NOT_LOADED' }[failure]);
      assert.equal(diagnostic.phase, failure === 'changed-during-images' ? 'after-images' : 'before-images');
      assert.equal(diagnostic.expectedMessages, 8); assert.equal(diagnostic.requiredRenderedMessages, 1);
      if (failure === 'missing' || failure === 'changed-during-images') assert.deepEqual(diagnostic.missingMessagePositions, [2]);
      const report = f.w.document.querySelector('.chat-archive-source-diagnostic pre').textContent;
      assert.deepEqual(JSON.parse(report), diagnostic);
      assert.doesNotMatch(report, /PRIVATE|SECRET|Unmapped|https:|Message |\bm[0-7]\b/);
      assert.equal(f.sent.some(request => ['EXPORT_READY', 'EXPORT_PARTS_START'].includes(request.type)), false);
    } finally { f.close(); }
  }
});

test('temporary chat never makes a backend request', async () => {
  const f = fixture('https://chatgpt.com/?temporary-chat=true');
  try {
    f.w.fetch = () => { throw Error('No request expected'); };
    assert.match((await f.api.collect(options, () => {})).fallback, /page/);
  } finally { f.close(); }
});

test('activity option no longer bypasses direct reading', async () => {
  const f = fixture();
  try {
    const calls = [];
    f.w.fetch = async url => { calls.push(url); return json(url.endsWith('/session') ? {} : conversation()); };
    const result = await f.api.collect({ ...options, includeActivity: true }, () => {});
    assert.equal(result.data.messages.length, 2); assert.equal(calls.length, 2);
  } finally { f.close(); }
});

test('interrupted response stream is discarded and requests a full page collection', async () => {
  const f = fixture();
  try {
    f.w.fetch = async url => url.endsWith('/session') ? json({}) : new Response(new ReadableStream({ start(controller) { controller.error(Error('private stream error')); } }), { headers: { 'content-type': 'application/json' } });
    const result = await f.api.collect(options, () => {});
    assert.match(result.fallback, /interrupted/);
    assert.doesNotMatch(JSON.stringify(result), /private/);
    assert.equal(f.clock.countTimers(), 0);
  } finally { f.close(); }
});

test('BEGIN_EXPORT reaches existing download handoff once with direct status and no tokens', async () => {
  const f = fixture(URL, true);
  try {
    f.w.fetch = async url => json(url.endsWith('/session') ? { accessToken: 'SECRET' } : conversation());
    await f.w.receive({ type: 'BEGIN_EXPORT', job: { format: 'md', filename: 'test.md', options: {} } });
    // Native Response streams use native microtasks; do not advance the 25s timeout.
    for (let i = 0; i < 20 && !f.sent.some(r => r.type === 'EXPORT_READY'); i++) await new Promise(resolve => setImmediate(resolve));
    const ready = f.sent.filter(r => r.type === 'EXPORT_READY');
    assert.equal(ready.length, 1);
    assert.equal(ready[0].data.collectionMethod, 'chatgpt-api');
    assert.doesNotMatch(JSON.stringify(f.sent), /SECRET/);
    const status = await f.w.receive({ type: 'PING' });
    assert.equal(status.activeExport, false);
    assert.equal(status.exportStatus.state, 'done');
    assert.equal(status.exportStatus.collectionNotice, 'Direct MD export · no scrolling');
    assert.match(f.w.document.querySelector('.chat-archive-progress-detail').textContent, /Direct MD export/);
  } finally { f.close(); }
});
