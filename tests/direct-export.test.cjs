const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const ID = '12345678-1234-1234-1234-123456789abc', URL = `https://chatgpt.com/c/${ID}`;
const card = read('tests/fixtures/static-card.txt');
const textMessage = (id, role, text, more = {}) => ({ id, author: { role }, status: 'finished_successfully', create_time: 1700000000,
  content: { content_type: 'text', parts: [text] }, ...more });
function conversation() {
  const result = { conversation_id: ID, title: 'Direct fixture', current_node: 'root', mapping: { root: { id: 'root', parent: null, message: null } } };
  const append = message => { result.mapping[message.id] = { id: message.id, parent: result.current_node, message }; result.current_node = message.id; };
  for (let i = 0; i < 40; i++) {
    if (i === 1) {
      append(textMessage('thoughts', 'assistant', '', { channel: 'analysis', content: { content_type: 'thoughts', thoughts: [{ summary: 'Comparing plans', content: 'Checking **rates**.\n\n```js\nif (rate) {\n    compare();\n}\n```' }] } }));
      append(textMessage('working', 'assistant', 'Reviewing [source](https://example.com)', { channel: 'commentary' }));
      append(textMessage('hidden', 'assistant', 'HIDDEN RECORD', { channel: 'commentary', metadata: { is_visually_hidden_from_conversation: true } }));
      append(textMessage('raw-analysis', 'assistant', 'RAW ANALYSIS', { channel: 'analysis' }));
      append(textMessage('recap', 'assistant', '', { content: { content_type: 'reasoning_recap', content: 'SERVICE RECAP' } }));
      append(textMessage('tool', 'tool', 'RAW TOOL OUTPUT', { channel: 'commentary' }));
    }
    append(textMessage(`m${i}`, i % 2 ? 'assistant' : 'user', i === 1 ? card : `Message ${i}`));
  }
  result.mapping.old = { id: 'old', parent: 'm0', message: textMessage('old', 'assistant', 'OLD ALTERNATIVE') };
  return result;
}
function fixture(raw) {
  const d = new JSDOM('<main><div data-chatgpt-selection-message-id="m39"><p>Message 39</p></div></main>', { url: URL, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = d.window, clock = FakeTimers.withGlobal(w).install({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }), sent = [], requests = [];
  w.TextDecoder = TextDecoder; w.matchMedia = () => ({ matches: false });
  w.browser = { runtime: { onMessage: { addListener(fn) { w.receive = fn; } }, sendMessage: async request => { sent.push(request); return { ok: true }; } } };
  let scrollWrites = 0;
  for (const host of [w.document.documentElement, w.document.body, w.document.querySelector('main')]) {
    host.style.overflowY = 'auto';
    Object.defineProperties(host, { clientHeight: { value: 600 }, scrollHeight: { value: 50000 }, scrollTop: { get: () => 49400, set: () => { scrollWrites++; } } });
  }
  w.scrollTo = () => { scrollWrites++; };
  w.fetch = async (url, init) => { requests.push({ url, init }); return new Response(JSON.stringify(url.endsWith('/session') ? { accessToken: 'PRIVATE_TOKEN' } : raw), { headers: { 'content-type': 'application/json' } }); };
  for (const file of JSON.parse(read('manifest.json')).content_scripts[0].js.filter(file => !['content/panel.js', 'content/history.js'].includes(file))) w.eval(read(file));
  w.eval(read('shared/renderers.js'));
  return { w, clock, requests, sent, get scrollWrites() { return scrollWrites; }, async collect(options) {
    const pending = w.receive({ type: 'COLLECT', options });
    const settled = pending.then(value => ({ value }), error => ({ error })); await clock.runAllAsync(); return settled;
  }, close() { w.dispatchEvent(new w.Event('pagehide')); clock.uninstall(); w.close(); } };
}

test('all five formats collect forty messages and saved activity with only the final answer mounted and zero scrolling', async () => {
  for (const outputFormat of ['txt', 'md', 'json', 'html', 'pdf']) {
    const f = fixture(conversation()); try {
      const { value: data, error } = await f.collect({ outputFormat, includeActivity: true, includeTimestamps: true });
      assert.ifError(error); assert.equal(data.messages.length, 40); assert.equal(data.collectionMethod, 'chatgpt-api');
      assert.deepEqual(Array.from(data.messages, m => m.id), Array.from({ length: 40 }, (_, i) => `m${i}`));
      assert.equal(data.messages[1].activities.length, 2); assert.equal(data.messages[3].activities, undefined);
      assert.equal(data.messages[1].activities[0].title, 'Comparing plans'); assert.match(data.messages[1].activities[1].text, /Reviewing source/);
      assert.ok(data.messages.every(m => m.createdAt));
      const format = outputFormat === 'pdf' ? 'html' : outputFormat;
      const output = f.w.ChatArchiveRenderers[format](data, { includeActivity: true, includeTimestamps: true });
      assert.match(output, /Message 0/); assert.match(output, /Message 20/); assert.match(output, /Message 39/);
      assert.match(output, /Comparing plans/);
      assert.doesNotMatch(output, /PRIVATE_TOKEN|HIDDEN RECORD|RAW ANALYSIS|SERVICE RECAP|RAW TOOL OUTPUT|OLD ALTERNATIVE/);
      if (['html', 'pdf', 'json'].includes(outputFormat)) { assert.equal(data.componentMessages, 1); assert.match(data.messages[1].html, /width:10%/); assert.doesNotMatch(data.messages[1].html, /\{#each|&lt;card/); }
      if (outputFormat === 'json') { assert.match(data.messages[1].markdown, /<card/); assert.equal(typeof data.messages[1].text, 'string'); }
      assert.equal(f.scrollWrites, 0); assert.equal(f.requests.length, 2); assert.equal(f.clock.countTimers(), 0);
    } finally { f.close(); }
  }
});

test('activity off excludes summaries; consecutive turns and standalone activity retain correct ownership', async () => {
  const raw = conversation();
  raw.mapping.nextThought = { id: 'nextThought', parent: 'm2', message: textMessage('nextThought', 'assistant', '', { channel: 'analysis', content: { content_type: 'thoughts', thoughts: [{ summary: 'Second turn', content: 'Second activity' }] } }) };
  raw.mapping.m3.parent = 'nextThought';
  raw.mapping.last = { id: 'last', parent: raw.current_node, message: textMessage('last', 'assistant', 'Final update', { channel: 'commentary' }) };
  raw.current_node = 'last';
  const f = fixture(raw); try {
    const on = (await f.collect({ outputFormat: 'html', includeActivity: true })).value;
    assert.equal(on.messages[1].activities[0].title, 'Comparing plans');
    assert.equal(on.messages[3].activities[0].title, 'Second turn');
    assert.equal(on.messages[39].activities[0].text, 'Final update');
    const off = (await f.collect({ outputFormat: 'html', includeActivity: false })).value;
    assert.ok(off.messages.every(message => !message.activities));
    assert.doesNotMatch(JSON.stringify(off), /Comparing plans|Second activity|Final update/);
    assert.equal(f.scrollWrites, 0);
  } finally { f.close(); }
  const only = { conversation_id: ID, current_node: 'm39', mapping: {
    root: { id: 'root', parent: null, message: null }, m39: { id: 'm39', parent: 'root', message: textMessage('m39', 'assistant', '', { content: { content_type: 'thoughts', thoughts: [{ summary: 'Summary only', content: '' }] } }) }
  } };
  const g = fixture(only); try { const { value, error } = await g.collect({ outputFormat: 'json', includeActivity: true }); assert.ifError(error); assert.equal(value.messages[0].activities[0].title, 'Summary only'); assert.equal(value.messages[0].html, ''); } finally { g.close(); }
});

test('a singular source citation in an unmounted answer exports directly with all messages and no page scrolling', async () => {
  for (const outputFormat of ['html', 'pdf', 'json']) {
    const raw = conversation();
    raw.mapping.m1.message.content.parts = ['Before\n\n- **Install** the file. <Cite ref="turn7search0"/>\n\nAfter'];
    raw.mapping.m1.message.metadata = { content_references: [{ type: 'grouped_webpages', items: [
      { title: 'Documentation', url: 'https://example.com/docs', refs: ['turn7search0'] }
    ] }] };
    const f = fixture(raw); try {
      const { value, error } = await f.collect({ outputFormat, includeLinks: true });
      assert.ifError(error); assert.equal(value.collectionMethod, 'chatgpt-api');
      assert.equal(value.renderedMessages, undefined); assert.equal(value.messages.length, 40);
      assert.deepEqual(Array.from(value.messages, message => message.id), Array.from({ length: 40 }, (_, i) => `m${i}`));
      assert.match(value.messages[1].html, /https:\/\/example.com\/docs/); assert.match(value.messages[1].html, /Documentation/);
      assert.match(value.messages[1].html, /Before[\s\S]*After/); assert.doesNotMatch(value.messages[1].html, /Cite|Source link unavailable/);
      assert.equal(f.scrollWrites, 0); assert.equal(f.requests.length, 2);
    } finally { f.close(); }
  }
});

test('unsupported unmounted cards and server failures stop without DOM scrolling or partial handoff', async () => {
  for (const reason of ['card', 'server', 'branch']) {
    const raw = conversation(); if (reason === 'card') raw.mapping.m1.message.content.parts = ['<AsyncImage query="Unmapped reference"/>'];
    if (reason === 'branch') raw.mapping.m20.parent = 'missing';
    const f = fixture(raw); try {
      if (reason === 'server') f.w.fetch = async () => new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } });
      const { error, value } = await f.collect({ outputFormat: 'html', includeActivity: true });
      assert.equal(value, undefined); assert.match(error.message, /Automatic page scrolling is disabled/);
      assert.equal(f.scrollWrites, 0); assert.equal(f.sent.filter(request => request.type === 'EXPORT_READY').length, 0);
    } finally { f.close(); }
  }
});

test('failed direct exports expose copyable structural diagnostics without saving or scrolling', async () => {
  for (const clipboardAvailable of [true, false]) {
    const raw = conversation(); raw.mapping.m1.message.content.parts = ['PRIVATE_TEXT \uE200entity\uE202PRIVATE_ID\uE201'];
    const f = fixture(raw); try {
      let copied;
      if (clipboardAvailable) Object.defineProperty(f.w.navigator, 'clipboard', { value: { writeText: async value => { copied = value; } } });
      await f.w.receive({ type: 'BEGIN_EXPORT', job: { format: 'html', filename: 'fixture.html', options: { includeActivity: true } } });
      await f.clock.tickAsync(100);
      const status = (await f.w.receive({ type: 'PING' })).exportStatus;
      assert.equal(status.state, 'error'); assert.match(status.label, /Automatic page scrolling is disabled/);
      const details = f.w.document.querySelector('.chat-archive-source-diagnostic'); assert.ok(details);
      const reportText = details.querySelector('pre').textContent;
      assert.equal(JSON.parse(reportText).context, 'assistant'); assert.doesNotMatch(reportText, /PRIVATE|https:/);
      assert.equal(copied, undefined);
      details.open = true; details.querySelector('button').click(); await f.clock.tickAsync(0);
      if (clipboardAvailable) { assert.equal(copied, reportText); assert.match(details.querySelector('button').textContent, /Copied/); }
      else { assert.equal(f.w.getSelection().toString(), reportText); assert.match(details.querySelector('button').textContent, /Ctrl\+C/); }
      assert.equal(f.scrollWrites, 0); assert.equal(f.sent.some(request => request.type === 'EXPORT_READY'), false);
      assert.equal(f.sent.some(request => request.type === 'EXPORT_PARTS_START'), false);
      assert.equal(f.requests.length, 2);
      await f.clock.tickAsync(status.finishedAt + 5000 - f.w.Date.now());
      assert.equal(f.w.document.querySelector('.chat-archive-progress'), null);
      assert.equal(JSON.stringify((await f.w.receive({ type: 'PING' })).exportStatus.sourceDiagnostic), JSON.stringify(status.sourceDiagnostic));
    } finally { f.close(); }
  }
});

test('missing citation destinations in saved activity and answers preserve text in all five formats without scrolling', async () => {
  for (const outputFormat of ['txt', 'md', 'html', 'pdf', 'json']) {
    const raw = conversation();
    raw.mapping.working.message.content.parts = ['Working before \uE200cite\uE202PRIVATE_WORKING_REF\uE201 after.'];
    raw.mapping.m1.message.content.parts = ['Answer before \uE200cite\uE202PRIVATE_ANSWER_REF\uE201 after.\n\n`\uE200cite\uE202CODE_LITERAL\uE201`'];
    const f = fixture(raw); try {
      const { value, error } = await f.collect({ outputFormat, includeActivity: true });
      assert.ifError(error); assert.equal(value.messages.length, 40); assert.equal(value.unavailableCitations, 2);
      const answer = value.messages[1], field = ['html', 'pdf', 'json'].includes(outputFormat) ? 'html' : outputFormat === 'md' ? 'markdown' : 'text';
      assert.match(answer[field], /Answer before \[Source link unavailable\] after/);
      assert.match(answer[field], /CODE_LITERAL/);
      assert.match(answer.activities[1][field], /Working before \[Source link unavailable\] after/);
      assert.doesNotMatch(JSON.stringify(value), /PRIVATE_WORKING_REF|PRIVATE_ANSWER_REF/);
      assert.equal(f.scrollWrites, 0); assert.equal(f.requests.length, 2);
    } finally { f.close(); }
  }
});

test('an unresolved image can be excluded without losing the rest of an unmounted card', async () => {
  const raw = conversation(); raw.mapping.m1.message.content.parts = ['<card><AsyncImage query="Unmapped"/><text>Keep the full text</text></card>'];
  const f = fixture(raw); try {
    const { value, error } = await f.collect({ outputFormat: 'html', includeAssistantImages: false, includeActivity: true });
    assert.ifError(error); assert.equal(value.messages.length, 40); assert.match(value.messages[1].html, /Keep the full text/); assert.equal(f.scrollWrites, 0);
  } finally { f.close(); }
});

test('an unmounted six-image group exports with saved activity and zero scrolling', async () => {
  const raw = conversation(), marker = '\uE200image_group\uE202{"query":["example"]}\uE201';
  raw.mapping.m1.message.content.parts = [`Before\n\n${marker}\n\nAfter`];
  raw.mapping.m1.message.metadata = { content_references: [{ type: 'image_group', matched_text: marker,
    images: Array.from({ length: 6 }, (_, index) => ({ image_result: { content_url: `https://images.example.com/${index}.png`, title: `Image ${index}` } })) }] };
  const f = fixture(raw);
  try {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
    f.w.URL.createObjectURL = () => 'blob:fixture'; f.w.URL.revokeObjectURL = () => {}; f.w.Image = class { async decode() {} };
    const originalFetch = f.w.fetch, imageCalls = [];
    f.w.fetch = async (url, init) => {
      if (!url.startsWith('https://images.example.com/')) return originalFetch(url, init);
      imageCalls.push(url); return new Response(png, { headers: { 'content-type': 'image/png' } });
    };
    const { value, error } = await f.collect({ outputFormat: 'html', includeActivity: true });
    assert.ifError(error); assert.equal(value.messages.length, 40); assert.equal(value.embeddedImages, 6);
    assert.equal(value.messages[1].activities.length, 2); assert.equal(imageCalls.length, 6);
    assert.equal(f.scrollWrites, 0); assert.equal(f.requests.length, 2);
    const doc = new JSDOM(value.messages[1].html).window.document;
    assert.equal(doc.images.length, 6); assert.match(doc.body.textContent, /Before[\s\S]*After/);
    for (const img of doc.images) assert.deepEqual(Buffer.from(img.src.split(',')[1], 'base64'), png);
  } finally { f.close(); }
});

test('the real direct pipeline keeps a verified prefix on HTTP failure and saves only after a choice', async () => {
  const raw = conversation(); raw.mapping.m1.message.content.parts = ['Ready ![one](https://images.example.com/ready.png)'];
  raw.mapping.m3.message.content.parts = ['Unfinished ![two](https://images.example.com/broken.png)'];
  const f = fixture(raw);
  try {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
    f.w.URL.createObjectURL = () => 'blob:fixture'; f.w.URL.revokeObjectURL = () => {}; f.w.Image = class { async decode() {} };
    const originalFetch = f.w.fetch; const images = [];
    f.w.fetch = async (url, init) => {
      if (!url.startsWith('https://images.example.com/')) return originalFetch(url, init);
      images.push(url); return url.endsWith('/broken.png') ? new Response('PRIVATE_SERVER_ERROR', { status: 503 }) : new Response(png);
    };
    await f.w.receive({ type: 'BEGIN_EXPORT', job: { format: 'html', filename: 'prefix.html', options: { includeActivity: true } } });
    await f.clock.tickAsync(100);
    assert.equal((await f.w.receive({ type: 'PING' })).exportStatus.state, 'running');
    assert.equal(f.sent.some(request => request.type === 'EXPORT_READY'), false);
    await f.clock.tickAsync(2100);
    const status = (await f.w.receive({ type: 'PING' })).exportStatus;
    assert.equal(status.state, 'decision'); assert.equal(status.processed, 3); assert.equal(status.mediaDiagnostic.download.httpStatus, 503);
    assert.equal(status.mediaDiagnostic.attempts, 3);
    assert.equal(f.sent.some(request => request.type === 'EXPORT_READY'), false);
    await f.w.receive({ type: 'RESOLVE_STOP', action: 'save' }); await f.clock.tickAsync(10);
    const data = f.sent.find(request => request.type === 'EXPORT_READY').data;
    assert.deepEqual(Array.from(data.messages, message => message.id), ['m0', 'm1', 'm2']);
    assert.equal(data.messages[1].activities.length, 2); assert.equal(data.partialExport.totalMessages, 40);
    assert.equal(data.partialExport.reason, 'image-error'); assert.equal(data.embeddedImages, 1);
    assert.doesNotMatch(JSON.stringify(data), /Unfinished|PRIVATE_SERVER_ERROR|export-image-placeholder/);
    assert.equal(images.length, 4); assert.equal(images.filter(url => url.endsWith('/ready.png')).length, 1); assert.equal(f.scrollWrites, 0);
  } finally { f.close(); }
});

test('missing preview permission stops the export before prefix downloads and shows a working repair action', async () => {
  const raw = conversation(); raw.mapping.m1.message.content.parts = ['![First](https://images.example.com/ready.png)'];
  raw.mapping.m3.message.content.parts = ['![Preview](https://images.openai.com/static-rsc-4/synthetic)'];
  const f = fixture(raw);
  try {
    const png = fs.readFileSync(path.join(__dirname, 'fixtures/api-color-fixture.png'));
    f.w.URL.createObjectURL = () => 'blob:fixture'; f.w.URL.revokeObjectURL = () => {}; f.w.Image = class { async decode() {} };
    let granted = false, imageRequests = 0;
    f.w.browser.runtime.sendMessage = async request => {
      f.sent.push(request);
      if (request.type === 'IMAGE_ACCESS_CHECK') return { ok: true, granted };
      if (request.type === 'PAGE_IMAGE_READ') return { ok: true, image: { src: `data:image/png;base64,${png.toString('base64')}`, type: 'image/png', width: 320, height: 180 } };
      return { ok: true };
    };
    const originalFetch = f.w.fetch;
    f.w.fetch = async (url, init) => {
      if (url.startsWith('https://images.example.com/')) { imageRequests++; return new Response(png); }
      return originalFetch(url, init);
    };
    const job = { format: 'html', filename: 'fixture.html', options: {} };
    await f.w.receive({ type: 'BEGIN_EXPORT', job }); await f.clock.tickAsync(100);
    const status = (await f.w.receive({ type: 'PING' })).exportStatus;
    assert.equal(status.state, 'error'); assert.equal(status.processed, 0); assert.equal(status.mediaDiagnostic.phase, 'permission');
    assert.equal(status.mediaDiagnostic.image, 2); assert.equal(status.mediaDiagnostic.messagePosition, 4);
    assert.equal(status.canSaveCollected, undefined); assert.match(status.label, /No images were downloaded/);
    assert.equal(imageRequests, 0); assert.equal(f.sent.some(r => ['PAGE_IMAGE_READ', 'EXPORT_READY', 'EXPORT_PARTS_START', 'EXPORT_PARTS_STAGE'].includes(r.type)), false);
    f.w.document.querySelector('.chat-archive-image-access').click(); await f.clock.tickAsync(0);
    assert.equal(f.sent.filter(r => r.type === 'IMAGE_ACCESS_OPEN').length, 1);
    await f.clock.tickAsync(5100);
    assert.equal((await f.w.receive({ type: 'PING' })).exportStatus.mediaDiagnostic.download.code, 'IMAGE_PERMISSION_REQUIRED');
    granted = true;
    await f.w.receive({ type: 'BEGIN_EXPORT', job }); await f.clock.tickAsync(100);
    assert.equal((await f.w.receive({ type: 'PING' })).exportStatus.state, 'done');
    const data = f.sent.find(r => r.type === 'EXPORT_READY').data;
    assert.equal(data.messages.length, 40); assert.equal(data.embeddedImages, 2); assert.equal(imageRequests, 1);
    assert.equal(f.sent.filter(r => r.type === 'PAGE_IMAGE_READ').length, 1); assert.equal(f.scrollWrites, 0);
  } finally { f.close(); }
});

test('generated tool images and a statically rendered card no longer require DOM grouping', () => {
  const raw = conversation(); raw.mapping.image = { id: 'image', parent: 'm1', message: textMessage('image', 'tool', '', { channel: 'final', content: { content_type: 'multimodal_text', parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'file-service://fixture-image' }] } }) }; raw.mapping.m2.parent = 'image';
  const f = fixture(raw); try {
    const data = f.w.ChatArchiveApi.normalize(raw, URL, { outputFormat: 'html', includeActivity: true });
    assert.equal(data.messages.length, 41); assert.equal(data.messages[2].id, 'image'); assert.equal(data.messages[2].media[0].source.pointer, 'file-service://fixture-image');
    assert.equal(data.componentMessages, 1); assert.equal(data.messages[1].activities.length, 2);
  } finally { f.close(); }
});
