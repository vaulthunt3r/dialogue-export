const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const id = n => `12345678-1234-1234-1234-${String(n).padStart(12, '0')}`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
function history() {
  const dom = new JSDOM('<main></main>', { url: 'https://chatgpt.com/c/' + id(1), runScripts: 'outside-only' });
  const w = dom.window; w.TextDecoder = TextDecoder; w.AbortController = AbortController;
  const calls = []; let response = () => json({ accessToken: 'PRIVATE_TOKEN' });
  w.fetch = async (url, options) => { calls.push({ url: String(url), ...options }); return response(url, options); };
  w.eval(read('content/chatgpt-api.js')); w.eval(read('content/history.js'));
  return { w, calls, set: value => { response = value; }, send: (type, extra = {}) => w.ChatArchiveHistory.handle({ type, session: id(99), ...extra }), close: () => { w.dispatchEvent(new w.Event('pagehide')); w.close(); } };
}
test('history is opt-in, uses fixed read-only URLs and never returns credentials', async () => {
  const f = history();
  try {
    assert.equal(f.calls.length, 0); assert.equal((await f.send('HISTORY_START')).ok, true);
    assert.equal((await f.send('HISTORY_START')).code, 'BUSY');
    f.set(() => json({ total: 1, offset: 0, items: [{ id: id(1), title: 'A', secret: 'PRIVATE_TOKEN' }] }));
    const result = await f.send('HISTORY_LIST', { offset: 0, archived: true });
    assert.equal(result.items[0].archived, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_TOKEN|secret/);
    assert.match(f.calls[1].url, /^https:\/\/chatgpt.com\/backend-api\/conversations\?/);
    assert.match(f.calls[1].url, /is_archived=true/); assert.equal(f.calls[1].headers.authorization, 'Bearer PRIVATE_TOKEN');
    assert.ok(f.calls.every(c => c.method === 'GET' && c.redirect === 'error' && c.cache === 'no-store'));
    assert.equal((await f.send('HISTORY_CHAT', { id: '../../secret', format: 'md' })).code, 'INVALID_REQUEST');
    assert.equal(f.calls.length, 2); await f.send('HISTORY_END'); assert.equal(f.w.ChatArchiveHistory.active, false);
    assert.equal((await f.send('HISTORY_LIST', { offset: 0, archived: false })).code, 'SESSION_ENDED');
  } finally { f.close(); }
});
test('history rejects malformed list pages and wrong conversation IDs', async () => {
  const f = history();
  try {
    await f.send('HISTORY_START');
    for (const data of [{ items: [], total: '4' }, { items: [{ id: 'unsafe' }], total: 1 }, { offset: 3, items: [], total: 0 }]) {
      f.set(() => json(data)); assert.equal((await f.send('HISTORY_LIST', { offset: 0, archived: false })).code, 'LIST_CHANGED');
    }
    f.set(() => json({ conversation_id: id(2), title: 'PRIVATE', current_node: 'm', mapping: {} }));
    const result = await f.send('HISTORY_CHAT', { id: id(1), format: 'md' });
    assert.equal(result.code, 'CHAT_ID_MISMATCH'); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  } finally { f.close(); }
});
test('history distinguishes unsupported content, references and unfinished replies without exposing their data', async () => {
  const f = history();
  try {
    await f.send('HISTORY_START');
    const base = { id: 'm', author: { role: 'assistant' }, status: 'finished_successfully', content: { content_type: 'text', parts: ['PRIVATE_TEXT'] } };
    for (const [patch, code] of [
      [{ content: { content_type: 'audio', parts: ['PRIVATE_TEXT'] } }, 'MESSAGE_TYPE'],
      [{ content: { content_type: 'multimodal_text', parts: [{ content_type: 'unknown', url: 'PRIVATE_URL' }] } }, 'ATTACHMENT_TYPE'],
      [{ content: { content_type: 'text', parts: ['\uE200PRIVATE_REFERENCE\uE201'] } }, 'RICH_REFERENCE'],
      [{ status: 'in_progress' }, 'RESPONSE_UNFINISHED']
    ]) {
      f.set(() => json({ conversation_id: id(1), title: 'PRIVATE_TITLE', current_node: 'm', mapping: { m: { id: 'm', parent: null, message: { ...base, ...patch } } } }));
      const result = await f.send('HISTORY_CHAT', { id: id(1), format: 'md' });
      assert.equal(result.code, code); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
    }
    f.w.ChatArchiveApi.normalize = () => { throw Error('PRIVATE_TOKEN PRIVATE_URL'); };
    assert.deepEqual(JSON.parse(JSON.stringify(await f.send('HISTORY_CHAT', { id: id(1), format: 'md' }))), { ok: false, code: 'UNSUPPORTED_CHAT' });
  } finally { f.close(); }
});

test('history separates network errors, invalid JSON and timeout without leaking exception details', async () => {
  const f=history();const clock=FakeTimers.withGlobal(f.w).install({toFake:['setTimeout','clearTimeout']});
  try {
    await f.send('HISTORY_START');
    f.set(()=>{throw Error('PRIVATE_TOKEN PRIVATE_URL');});
    assert.deepEqual(JSON.parse(JSON.stringify(await f.send('HISTORY_CHAT',{id:id(1),format:'md'}))),{ok:false,code:'NETWORK_ERROR'});
    for(const type of ['application/json','text/html']) {
      f.set(()=>new Response('PRIVATE_INVALID_JSON',{headers:{'content-type':type}}));
      assert.deepEqual(JSON.parse(JSON.stringify(await f.send('HISTORY_CHAT',{id:id(1),format:'md'}))),{ok:false,code:'INVALID_RESPONSE'});
    }
    f.set((_,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('PRIVATE_URL')),{once:true})));
    const pending=f.send('HISTORY_CHAT',{id:id(1),format:'md'});await clock.tickAsync(30001);
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{ok:false,code:'REQUEST_TIMEOUT'});
  }finally{clock.uninstall();f.close();}
});

test('ending a history session aborts an in-flight fetch and releases the lock', async () => {
  const f = history();
  try {
    await f.send('HISTORY_START');
    f.set((_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Error('PRIVATE_URL')), { once: true })));
    const pending = f.send('HISTORY_LIST', { offset: 0, archived: false });
    await f.send('HISTORY_END'); assert.equal((await pending).code, 'STOPPED'); assert.equal(f.w.ChatArchiveHistory.active, false);
  } finally { f.close(); }
});
function bulk(config = {}) {
  const downloads = [], blobs = new Map(), calls = [], removed = [], sourceTabs = []; let locked = false, counter = 20;
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, Uint32Array, DataView, Blob, URL: { createObjectURL: b => { const url = `blob:${++counter}`; blobs.set(url, b); return url; }, revokeObjectURL: url => blobs.delete(url) },
    setTimeout, clearTimeout, Date, Promise, AbortController, crypto: { randomUUID: () => id(++counter) },
    browser: { runtime: { getURL: file => `moz-extension://test/${file}` },
      tabs: { get: async tabId => { sourceTabs.push(tabId); return { url: 'https://chatgpt.com/c/' + id(1) }; }, create: async ({ url }) => { context.uiUrl = url; return { id: 8 }; }, onRemoved: { addListener: fn => removed.push(fn) },
        sendMessage: async (tab, msg) => { calls.push(msg); if (config.rpc) { const value = await config.rpc(msg); if (value) return value; }
          if (msg.type === 'HISTORY_LIST') return { ok: true, total: msg.archived ? 1 : 2, items: (msg.archived ? [3] : [1, 2]).map(n => ({ id: id(n), title: n === 1 ? '<script>#%' : 'Chat ' + n, archived: msg.archived })) };
          if (msg.type === 'HISTORY_CHAT') return { ok: true, data: { title: 'T', url: 'https://chatgpt.com/c/' + msg.id, exportedAt: '2026-11-17T00:00:00Z', provider: 'ChatGPT', messages: [{ role: 'assistant', text: config.text || 'Some text', markdown: config.text || 'Some text', html: '<pre>  code</pre>' }] } };
          return { ok: true }; } },
      downloads: { download: async options => { downloads.push({ ...options, blob: blobs.get(options.url) }); return downloads.length; } } } });
  const clock = FakeTimers.withGlobal(context).install({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const file of ['shared/timestamps.js', 'shared/renderers.js', 'shared/zip.js', 'archive/background.js']) {
    let source = read(file);
    if (config.small && file === 'archive/background.js') source = source.replace('32 * 1024 * 1024, RESERVE_BYTES = 2 * 1024 * 1024', '8192, RESERVE_BYTES = 2048');
    vm.runInContext(source, context);
  }
  const deps = { acquire: () => { if (locked) return false; locked = true; return true; }, release: () => { locked = false; }, waitForDownload: async id => { if (typeof config.downloadFailure === 'function' ? config.downloadFailure(downloads[id-1]) : config.downloadFailure) throw Error('interrupted'); } };
  let archiveId;
  const send = (type, extra = {}, sender) => context.ChatArchiveBulk.handle({ type, id: archiveId, ...extra }, sender || { url: context.uiUrl, tab: { id: 8 }, frameId: 0 }, deps);
  return { context, calls, downloads, clock, blobs, sourceTabs, send, locked: () => locked, closeTab:tabId=>removed.forEach(fn=>fn(tabId)),
    open: async () => { await send('ARCHIVE_OPEN', { tabId: 1 }, { url: 'moz-extension://test/popup/popup.html' }); archiveId = new URL(context.uiUrl).searchParams.get('id'); },
    settle: async () => { for (let i = 0; i < 60; i++) { await clock.tickAsync(1000); if (!(await send('ARCHIVE_STATE')).running) return; } throw Error('Job did not settle'); },
    close: () => clock.uninstall() };
}
async function scan(f) { await f.open(); assert.equal((await f.send('ARCHIVE_LIST', { archived: true })).ok, true); await f.settle(); }
test('page archive shortcut binds to its own top-level ChatGPT tab and does not read history', async () => {
  const f = bulk();
  try {
    for (const sender of [{ url:'https://evil.invalid/', tab:{id:1}, frameId:0 }, { url:'https://chatgpt.com/c/'+id(1), tab:{id:1}, frameId:2 }, { url:'https://chatgpt.com.evil.invalid/', tab:{id:1}, frameId:0 }]) {
      assert.equal((await f.send('ARCHIVE_OPEN', {tabId:99}, sender)).ok, false);
    }
    assert.equal((await f.send('ARCHIVE_OPEN', {tabId:99}, {url:'https://chatgpt.com/c/'+id(1),tab:{id:1},frameId:0})).ok, true);
    assert.deepEqual(f.sourceTabs, [1]); assert.equal(f.calls.length, 0); assert.equal(f.downloads.length, 0);
  } finally { f.close(); }
});
test('bulk archives active and archived chats, verifies downloads, and reports exact scope', async () => {
  const f = bulk();
  try {
    await scan(f); assert.equal((await f.send('ARCHIVE_ITEMS')).items.length, 3);
    assert.equal((await f.send('ARCHIVE_STATE', {}, { url: 'https://evil.invalid', tab: { id: 8 }, frameId: 0 })).ok, false);
    assert.equal((await f.send('ARCHIVE_RUN', { ids: [id(99)], format: 'md' })).ok, false);
    await f.send('ARCHIVE_RUN', { ids: [id(1), id(3)], format: 'md' }); await f.settle();
    const state = await f.send('ARCHIVE_STATE'); assert.equal(state.state, 'done'); assert.equal(state.saved, 2);
    assert.equal(f.downloads.length, 2); assert.equal(f.blobs.size, 0); assert.equal(f.locked(), false);
    const report = JSON.parse(await f.downloads[1].blob.text()); assert.equal(report.saved, 2); assert.equal(report.imagesIncluded, false);
    assert.deepEqual(report.chats.map(row => row.id), [id(1), id(3)]); assert.ok(report.chats.every(row => row.status === 'saved'));
    assert.equal(f.calls.filter(c => c.type === 'HISTORY_CHAT').length, 2);
  } finally { f.close(); }
});
test('a failed chat is reported while other chats complete; no successful-all claim', async () => {
  const f = bulk({ rpc: m => m.type === 'HISTORY_CHAT' && m.id === id(2) ? { ok: false, code: 'HTTP_404' } : null });
  try {
    await scan(f); await f.send('ARCHIVE_RUN', { ids: [id(1), id(2), id(3)], format: 'html' }); await f.settle();
    const state = await f.send('ARCHIVE_STATE'); assert.equal(state.state, 'partial'); assert.equal(state.saved, 2); assert.equal(state.failed, 1);
    const report = JSON.parse(await f.downloads.at(-1).blob.text()); assert.equal(report.chats[1].status, 'failed');
    assert.equal(report.chats[1].code, 'HTTP_404');
  } finally { f.close(); }
});
test('numbered ZIP parts have bounded size and no repeated conversation requests', async () => {
  const f = bulk({ small: true, text: 'long '.repeat(700) });
  try {
    await scan(f); await f.send('ARCHIVE_RUN', { ids: [id(1), id(2), id(3)], format: 'txt' }); await f.settle();
    assert.equal((await f.send('ARCHIVE_STATE')).parts, 3);
    assert.ok(f.downloads.slice(0, 3).every(file => file.blob.size <= 8192));
    assert.match(f.downloads[2].filename, /part-003.zip$/); assert.equal(f.calls.filter(c => c.type === 'HISTORY_CHAT').length, 3);
  } finally { f.close(); }
});
test('changing/repeated pagination fails closed and disables export', async () => {
  const f = bulk({ rpc: m => m.type === 'HISTORY_LIST' ? { ok: true, total: 2, items: [{ id: id(1), title: 'A' }] } : null });
  try { await scan(f); const state = await f.send('ARCHIVE_STATE'); assert.equal(state.state, 'error'); assert.equal(state.listReady, false); assert.equal(f.downloads.length, 0); }
  finally { f.close(); }
});
test('reloading immediately invalidates the previous list while authentication is pending', async () => {
  let starts = 0, finish;
  const f = bulk({ rpc: m => m.type === 'HISTORY_START' && ++starts === 2 ? new Promise(resolve => {finish=resolve;}) : null });
  try {
    await scan(f); assert.equal((await f.send('ARCHIVE_STATE')).listReady, true);
    await f.send('ARCHIVE_LIST', {archived:true}); const pending=await f.send('ARCHIVE_STATE');
    assert.equal(pending.running,true); assert.equal(pending.listReady,false); assert.equal(pending.count,0);
    finish({ok:true}); await f.settle(); assert.equal((await f.send('ARCHIVE_STATE')).listReady,true);
  } finally { f.close(); }
});
test('Stop interrupts rate-limit waiting without saving an incomplete ZIP', async () => {
  const f = bulk({ rpc: m => m.type === 'HISTORY_CHAT' ? { ok: false, code: 'HTTP_429', retryAfter: 60 } : null });
  try {
    await scan(f); await f.send('ARCHIVE_RUN', { ids: [id(1)], format: 'md' }); await f.clock.tickAsync(1);
    assert.match((await f.send('ARCHIVE_STATE')).label, /Retrying/);
    await f.send('ARCHIVE_STOP'); await f.settle(); assert.equal((await f.send('ARCHIVE_STATE')).state, 'stopped');
    assert.equal(f.downloads.length, 0); assert.equal(f.locked(), false);
    await f.send('ARCHIVE_REPORT'); const report = JSON.parse(await f.downloads[0].blob.text()); assert.equal(report.saved, 0); assert.equal(report.notSaved, 1);
  } finally { f.close(); }
});
test('interrupted ZIP download is not counted as saved and resources are released', async () => {
  const f = bulk({ downloadFailure: true });
  try {
    await scan(f); await f.send('ARCHIVE_RUN', { ids: [id(1)], format: 'json' }); await f.settle();
    const state = await f.send('ARCHIVE_STATE'); assert.equal(state.state, 'error'); assert.equal(state.saved, 0); assert.equal(f.blobs.size, 0); assert.equal(f.locked(), false);
  } finally { f.close(); }
});
test('network failure stops the queue instead of retrying every remaining chat', async () => {
  const f = bulk({ rpc: m => m.type === 'HISTORY_CHAT' ? { ok: false, code: 'READ_FAILED' } : null });
  try {
    await scan(f); await f.send('ARCHIVE_RUN', { ids: [id(1), id(2), id(3)], format: 'md' }); await f.settle();
    assert.equal((await f.send('ARCHIVE_STATE')).state, 'error'); assert.equal(f.calls.filter(c => c.type === 'HISTORY_CHAT').length, 1);
    assert.equal(f.downloads.length, 1); assert.match(f.downloads[0].filename, /-report\.json$/); assert.equal(f.locked(), false);
  } finally { f.close(); }
});

test('a terminal HTTP failure saves all prepared chats and identifies the failing request', async () => {
  const f = bulk({ rpc: m => {
    if (m.type === 'HISTORY_LIST') return {ok:true,total:m.archived?0:42,items:m.archived?[]:Array.from({length:42},(_,i)=>({id:id(i+1),title:'Chat '+(i+1)}))};
    if (m.type === 'HISTORY_CHAT') {
      const n=Number(m.id.slice(-12));
      if(n===26)return {ok:false,code:'RESPONSE_UNFINISHED'};
      if([30,31].includes(n))return {ok:false,code:'RICH_REFERENCE'};
      if(n===40)return {ok:false,code:'HTTP_502'};
    }
  } });
  try {
    await scan(f);await f.send('ARCHIVE_RUN',{ids:Array.from({length:42},(_,i)=>id(i+1)),format:'md'});await f.settle();
    const state=await f.send('ARCHIVE_STATE');
    assert.equal(state.state,'error');assert.equal(state.saved,36);assert.equal(state.failed,4);assert.equal(state.processed,40);
    assert.equal(state.errorCode,'HTTP_502');assert.match(state.error,/502/);
    assert.equal(f.downloads.length,2);assert.match(f.downloads[0].filename,/\.zip$/);
    const report=JSON.parse(await f.downloads[1].blob.text());
    assert.equal(report.saved,36);assert.equal(report.notAttempted,2);assert.equal(report.errorCode,'HTTP_502');
    assert.equal(report.chats[39].code,'HTTP_502');assert.equal(report.chats[40].status,'not_attempted');
    assert.equal(f.calls.filter(c=>c.type==='HISTORY_CHAT').length,40);assert.equal(f.locked(),false);assert.equal(f.blobs.size,0);
  }finally{f.close();}
});

test('progress distinguishes prepared files from confirmed downloads before a later network failure', async () => {
  let release;
  const f=bulk({rpc:m=>m.type==='HISTORY_CHAT'&&m.id===id(2)?new Promise(resolve=>{release=resolve;}):null});
  try {
    await scan(f);await f.send('ARCHIVE_RUN',{ids:[id(1),id(2),id(3)],format:'md'});await f.clock.tickAsync(500);
    const state=await f.send('ARCHIVE_STATE');assert.equal(state.ready,1);assert.equal(state.saved,0);
    release({ok:false,code:'READ_FAILED'});await f.settle();
    const done=await f.send('ARCHIVE_STATE');assert.equal(done.saved,1);assert.equal(done.ready,0);assert.equal(done.failed,1);
    assert.equal(f.downloads.length,2);
  }finally{f.close();}
});
test('ZIP validates names, size, duplicates and the standard CRC-32 vector', () => {
  const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob }); vm.runInContext(read('shared/zip.js'), context);
  assert.equal(context.ChatArchiveZip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const writer = new context.ChatArchiveZip.Writer(300);
  for (const name of ['../escape', '/absolute', 'folder/../bad', 'bad\\file', 'C:file']) assert.throws(() => writer.add(name, 'text'));
  writer.add('тест.txt', 'Привет'); assert.throws(() => writer.add('тест.txt', 'again')); assert.throws(() => writer.add('large.txt', 'x'.repeat(301)));
  assert.ok(writer.blob().size <= 300);
});

test('oversize chats are failed individually and never enter the ZIP buffer', async () => {
  const f=bulk({small:true,text:'x'.repeat(9000)});try {
    await scan(f);await f.send('ARCHIVE_RUN',{ids:[id(1),id(2)],format:'md'});await f.settle();
    const state=await f.send('ARCHIVE_STATE');assert.equal(state.saved,0);assert.equal(state.failed,2);assert.equal(state.state,'partial');
    assert.equal(f.downloads.length,1);assert.match(f.downloads[0].filename,/-report\.json$/);
    assert.ok(JSON.parse(await f.downloads[0].blob.text()).chats.every(row=>row.code==='ZIP_LIMIT'));
  }finally{f.close();}
});

test('source-tab loss salvages ready files; explicit Stop cancels further downloads', async () => {
  for(const stop of [false,true]) {
    let release;
    const f=bulk({rpc:m=>m.type==='HISTORY_CHAT'&&m.id===id(2)?new Promise(resolve=>{release=resolve;}):null});try {
      await scan(f);await f.send('ARCHIVE_RUN',{ids:[id(1),id(2),id(3)],format:'md'});await f.clock.tickAsync(500);
      if(stop)await f.send('ARCHIVE_STOP');else f.closeTab(1);
      release({ok:false,code:'SESSION_ENDED'});await f.settle();
      const state=await f.send('ARCHIVE_STATE');assert.equal(state.state,stop?'stopped':'error');assert.equal(state.saved,stop?0:1);
      assert.equal(state.errorCode,stop?'STOPPED':'SOURCE_CLOSED');assert.equal(f.downloads.length,stop?0:2);assert.equal(f.locked(),false);
    }finally{f.close();}
  }
});

test('salvage download failure preserves the read error and never retries an unconfirmed ZIP', async () => {
  const f=bulk({rpc:m=>m.type==='HISTORY_CHAT'&&m.id===id(2)?{ok:false,code:'HTTP_500'}:null,downloadFailure:file=>file.filename.endsWith('.zip')});try {
    await scan(f);await f.send('ARCHIVE_RUN',{ids:[id(1),id(2),id(3)],format:'md'});await f.settle();
    const state=await f.send('ARCHIVE_STATE');assert.equal(state.saved,0);assert.equal(state.errorCode,'HTTP_500');assert.match(state.error,/Saving prepared chats also failed/);
    assert.equal(f.downloads.filter(file=>file.filename.endsWith('.zip')).length,1);
    const report=JSON.parse(await f.downloads.at(-1).blob.text());
    assert.equal(report.stopError.code,'HTTP_500');assert.equal(report.saveError.code,'DOWNLOAD_FAILED');assert.equal(report.chats[0].status,'download_unconfirmed');
    assert.equal(f.blobs.size,0);
  }finally{f.close();}
});

test('closing the source between requests retains its cause and saves the ready buffer', async () => {
  const f=bulk();try {
    await scan(f);await f.send('ARCHIVE_RUN',{ids:[id(1),id(2)],format:'md'});await f.clock.tickAsync(1);
    assert.equal((await f.send('ARCHIVE_STATE')).ready,1);f.closeTab(1);await f.settle();
    const state=await f.send('ARCHIVE_STATE');assert.equal(state.saved,1);assert.equal(state.errorCode,'SOURCE_CLOSED');assert.equal(state.notAttempted,1);
  }finally{f.close();}
});
