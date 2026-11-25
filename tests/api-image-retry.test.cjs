const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const ID = '12345678-1234-1234-1234-123456789abc', URL = `https://chatgpt.com/c/${ID}`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=', 'base64');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const dom = new JSDOM('<main/>', { url: URL, runScripts: 'outside-only' }), w = dom.window;
  w.TextDecoder = TextDecoder; w.TextEncoder = TextEncoder;
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.Image = class { async decode() {} };
  for (const file of ['shared/vendor/markdown-it.js', 'content/components.js', 'content/markdown.js', 'content/api-media.js', 'content/chatgpt-api.js']) w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  return { w, close: () => w.close() };
}
// Reproduces only the reported counts/index, using synthetic text and image bytes.
function largeChat() {
  const raw = { conversation_id: ID, current_node: null, mapping: {} };
  for (let index = 0; index < 672; index++) {
    const id = `m${index + 1}`, image = index >= 127 && index < 605 ? index - 126 : null;
    raw.mapping[id] = { id, parent: raw.current_node, message: { id, author: { role: index % 2 ? 'assistant' : 'user' }, status: 'finished_successfully', content: { content_type: 'multimodal_text', parts: image ? [{ content_type: 'image_asset_pointer', asset_pointer: `sediment://image${image}` }] : ['Text'] } } };
    raw.current_node = id;
  }
  return raw;
}
function mockLarge(f, permanent) {
  const attempts = new Map(), reads = new Map(), stages = [], progress = [];
  f.w.fetch = async (url, init) => {
    if (url.endsWith('/session')) return json({ accessToken: 'PRIVATE_TOKEN' });
    if (url.endsWith(`/conversation/${ID}`)) return json(largeChat());
    const reference = url.match(/\/attachment\/image(\d+)\/download$/);
    if (reference) {
      const number = Number(reference[1]), attempt = (attempts.get(number) || 0) + 1;
      attempts.set(number, attempt);
      return json({ download_url: `https://images.example.com/${number}?version=${attempt}` });
    }
    assert.equal(init.credentials, 'omit'); assert.equal(init.headers.authorization, undefined);
    const image = Number(new global.URL(url).pathname.slice(1));
    reads.set(image, (reads.get(image) || 0) + 1);
    if (image === 156 && (permanent || attempts.get(image) === 1)) throw new TypeError('PRIVATE_URL PRIVATE_TOKEN');
    return new Response(png);
  };
  return { attempts, reads, stages, progress, run: check => f.w.ChatArchiveApi.collect({ outputFormat: 'html' }, check || (() => {}), (percent, label) => progress.push(label), async part => stages.push(part)) };
}

test('a transient failure at image 156 resumes all 478 images and 672 messages without redownloading the prefix', { timeout: 15000 }, async () => {
  const f = fixture(); try {
    const state = mockLarge(f, false), result = await state.run();
    assert.ok(result.data, result.fallback); assert.equal(result.data.embeddedImages, 478);
    assert.equal(result.data.multipart.messages, 672);
    assert.deepEqual(state.stages.flatMap(part => Array.from(part.messages, m => m.id)), Array.from({length:672},(_,i)=>`m${i+1}`));
    const images = state.stages.flatMap(part => Array.from(part.messages, m => m.html.match(/data:image\/png;base64,/g) || []).flat());
    assert.equal(images.length, 478);
    assert.equal(state.attempts.get(156), 2); assert.equal(state.reads.get(156), 2);
    for (const [image, count] of state.reads) if (image !== 156) assert.equal(count, 1);
    assert.ok(state.progress.some(label => /Retrying image 156\/478.*2\/3/.test(label)));
    assert.equal(result.data.partialExport, undefined);
  } finally { f.close(); }
});

test('a permanent failure at image 156 stops after three attempts and retains exactly 282 messages and 155 images', { timeout: 15000 }, async () => {
  const f = fixture(); try {
    const state = mockLarge(f, true);
    await assert.rejects(state.run(), error => {
      assert.equal(error.imageEmbedFailed, true);
      assert.equal(error.partialData.partialExport.messages, 282); assert.equal(error.partialData.partialExport.totalMessages, 672);
      assert.equal(error.partialData.embeddedImages, 155);
      assert.equal(error.mediaDiagnostic.image, 156); assert.equal(error.mediaDiagnostic.total, 478);
      assert.equal(error.mediaDiagnostic.messagePosition, 283); assert.equal(error.mediaDiagnostic.attempts, 3);
      assert.equal(error.mediaDiagnostic.referenceKind, 'sediment'); assert.equal(error.mediaDiagnostic.phase, 'download');
      assert.equal(error.mediaDiagnostic.download.code, 'IMAGE_NETWORK_ERROR'); assert.equal(error.mediaDiagnostic.download.requestStage, 'request');
      assert.doesNotMatch(JSON.stringify(error.mediaDiagnostic), /PRIVATE|https:|image156|m283/);
      return true;
    });
    assert.equal(state.reads.get(156), 3); assert.equal(state.reads.has(157), false);
    assert.deepEqual(state.stages.flatMap(part => Array.from(part.messages, m => m.id)), Array.from({length:282},(_,i)=>`m${i+1}`));
  } finally { f.close(); }
});

test('Stop during retry backoff cancels the wait and preserves completed messages', { timeout: 3000 }, async () => {
  const f = fixture(); try {
    let stopped = false, failures = 0;
    f.w.fetch = async url => {
      if (url.endsWith('/session')) return json({});
      if (url.endsWith(`/conversation/${ID}`)) return json(largeChat());
      if (url.endsWith('/download')) return json({ download_url: 'https://images.example.com/failure.png' });
      failures++; throw TypeError('Unavailable');
    };
    await assert.rejects(f.w.ChatArchiveApi.collect({ outputFormat:'html' }, () => { if (stopped) { const e=Error('Stopped');e.exportStopped=true;throw e; } }, (percent,label) => { if (/Retrying image/.test(label)) f.w.setTimeout(()=>{stopped=true;},10); }, async()=>{}), error => {
      assert.equal(error.exportStopped,true); assert.equal(error.partialData.partialExport.messages,127); return true;
    });
    assert.equal(failures,1);
  } finally { f.close(); }
});

test('an expired signed image URL is refreshed, while a missing reference fails without repeated requests', async () => {
  for (const status of [403,404]) {
    const f=fixture();try {
      let references=0,downloads=0;
      const raw=largeChat();raw.current_node='m128';
      f.w.fetch=async(url,init)=>{
        if(url.endsWith('/session'))return json({accessToken:'PRIVATE_TOKEN'});
        if(url.endsWith(`/conversation/${ID}`))return json(raw);
        if(url.endsWith('/download')){
          references++;assert.equal(init.headers.authorization,'Bearer PRIVATE_TOKEN');
          return status===404?json({},404):json({download_url:`https://images.example.com/file?v=${references}`});
        }
        downloads++;assert.equal(init.headers.authorization,undefined);assert.equal(init.credentials,'omit');
        return downloads===1?new Response('Expired private signature',{status}):new Response(png);
      };
      if(status===403){const result=await f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{});assert.equal(result.data.embeddedImages,1);assert.equal(references,2);assert.equal(downloads,2);}
      else {
        await assert.rejects(f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{}),error=>{assert.equal(error.mediaDiagnostic.attempts,1);assert.equal(error.mediaDiagnostic.download.httpStatus,404);assert.equal(error.mediaDiagnostic.phase,'reference');return true;});
        assert.equal(references,1);assert.equal(downloads,0);
      }
    }finally{f.close();}
  }
});

test('reference timeouts are isolated so a later attempt can obtain a fresh download link', { timeout: 5000 }, async () => {
  const f = fixture(), clock = FakeTimers.withGlobal(f.w).install({toFake:['setTimeout','clearTimeout']});
  try {
    let references=0, firstSignal;
    const raw=largeChat(); raw.current_node='m128';
    f.w.fetch = async (url, init) => {
      if (url.endsWith('/session')) return json({});
      if (url.endsWith(`/conversation/${ID}`)) return json(raw);
      if (url.endsWith('/download')) {
        references++;
        if (references===1) { firstSignal=init.signal; return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true})); }
        assert.equal(init.signal.aborted,false);return json({download_url:'https://images.example.com/refreshed.png'});
      }
      return new Response(png);
    };
    const pending = f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{});
    const completed = pending.then(result=>{assert.ok(result.data,result.fallback);return result;});
    completed.catch(()=>{});
    await clock.tickAsync(0);
    assert.equal(references,1);
    await clock.tickAsync(61000);
    const result=await completed;
    assert.equal(firstSignal.aborted,true);assert.equal(references,2);assert.equal(result.data.embeddedImages,1);
    assert.equal(clock.countTimers(),0);
  } finally { clock.uninstall(); f.close(); }
});

test('unsupported URLs and broken response streams have distinct bounded diagnostics', async () => {
  const f=fixture();try {
    let requests=0;f.w.fetch=async()=>{requests++;return new Response(png);};
    for(const url of ['http://example.com/x','https://127.0.0.1/private','data:image/png;base64,!invalid']) {
      await assert.rejects(f.w.ChatArchiveApiMedia.loadImage(url,{signal:new f.w.AbortController().signal}),error=>{
        assert.equal(error.imageDiagnostic.code,url.startsWith('data:')?'IMAGE_DATA_INVALID':'IMAGE_URL_UNSUPPORTED');return true;
      });
    }
    assert.equal(requests,0);
    f.w.fetch=async()=>({ok:true,headers:new Headers(),body:{getReader:()=>({read:async()=>{throw Error('PRIVATE_URL');},cancel:async()=>{},releaseLock(){}})}});
    await assert.rejects(f.w.ChatArchiveApiMedia.loadImage('https://images.example.com/stream',{signal:new f.w.AbortController().signal}),error=>{
      assert.equal(error.imageDiagnostic.code,'IMAGE_NETWORK_ERROR');assert.equal(error.imageDiagnostic.requestStage,'body');assert.equal(error.imageDiagnostic.receivedBytes,0);assert.doesNotMatch(JSON.stringify(error.imageDiagnostic),/PRIVATE/);return true;
    });
  } finally {f.close();}
});
