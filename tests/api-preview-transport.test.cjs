const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const FakeTimers = require('@sinonjs/fake-timers');
const ID = '12345678-1234-1234-1234-123456789abc';
const preview = 'https://images.openai.com/static-rsc-4/synthetic-preview?purpose=inline';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC9sAAAAASUVORK5CYII=', 'base64');
const image = { src: `data:image/png;base64,${png.toString('base64')}`, width: 1, height: 1, type: 'image/png' };
const json = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function fixture() {
  const dom = new JSDOM('<main/>', {url:`https://chatgpt.com/c/${ID}`,runScripts:'outside-only'}), w=dom.window;
  w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;
  w.URL.createObjectURL=()=> 'blob:synthetic';w.URL.revokeObjectURL=()=>{};w.Image=class{async decode(){}};
  for(const file of ['shared/vendor/markdown-it.js','content/components.js','content/markdown.js','content/api-media.js','content/chatgpt-api.js'])w.eval(read(file));
  return {w,close:()=>w.close()};
}
function rawGallery(images) {
  return {conversation_id:ID,current_node:'answer',mapping:{answer:{id:'answer',parent:null,message:{
    id:'answer',author:{role:'assistant'},status:'finished_successfully',content:{content_type:'text',parts:['Before. \uE200images\uE202gallery\uE201 After.']},
    metadata:{content_references:[{type:'image_group',matched_text:'\uE200images\uE202gallery\uE201',images:images.map(image_result=>({image_result}))}]}
  }}}};
}

test('direct gallery export reads the exact saved OpenAI preview through the extension bridge, not a CORS-limited page request',async()=>{
  const f=fixture();try{
    const sent=[],fetches=[];
    const raw=rawGallery([{content_url:'https://original.example/first.jpg',thumbnail_url:preview,title:'First'},{content_url:preview+'2',title:'Second'}]);
    f.w.browser={runtime:{sendMessage:async request=>{sent.push(request);return request.type==='IMAGE_ACCESS_CHECK'?{ok:true,granted:true}:{ok:true,image};}}};
    f.w.fetch=async url=>{fetches.push(url);if(url.endsWith('/session'))return json({accessToken:'PRIVATE_TOKEN'});if(url.endsWith(`/conversation/${ID}`))return json(raw);throw new TypeError('CORS: PRIVATE_URL');};
    const result=await f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{});
    assert.ok(result.data,result.fallback);assert.equal(result.data.embeddedImages,2);
    assert.deepEqual(sent.map(r=>[r.type,r.url]),[['IMAGE_ACCESS_CHECK',undefined],['PAGE_IMAGE_READ',preview],['PAGE_IMAGE_READ',preview+'2']]);
    assert.equal(fetches.length,2);assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_TOKEN|authorization|cookie|original.example/);
    assert.equal((result.data.messages[0].html.match(/data:image\/png;base64,/g)||[]).length,2);
    assert.match(result.data.messages[0].html,/Before\./);assert.match(result.data.messages[0].html,/After\./);
  }finally{f.close();}
});

test('the direct bridge cannot proxy arbitrary hosts, paths, credentials or protocols',async()=>{
  const f=fixture();try{
    const sent=[],fetched=[];
    f.w.browser={runtime:{sendMessage:async r=>{sent.push(r);return {ok:true,image};}}};
    f.w.fetch=async url=>{fetched.push(url);return new Response(png);};
    for(const url of ['https://original.example/image.png','https://images.openai.com/account','https://images.openai.com.evil.example/static-rsc-4/x'])await f.w.ChatArchiveApiMedia.loadImage(url,{signal:new f.w.AbortController().signal,token:'PRIVATE'});
    for(const url of ['http://images.openai.com/static-rsc-4/x','https://PRIVATE@images.openai.com/static-rsc-4/x'])await assert.rejects(f.w.ChatArchiveApiMedia.loadImage(url,{signal:new f.w.AbortController().signal}));
    assert.equal(sent.length,0);assert.equal(fetched.length,3);
  }finally{f.close();}
});

test('Stop and the bridge deadline cancel the owning image request and clear their timers',async()=>{
  for(const stop of [true,false]){
    const f=fixture(),clock=FakeTimers.withGlobal(f.w).install({toFake:['setTimeout','clearTimeout']});
    try{
      const sent=[],controller=new f.w.AbortController();
      f.w.fetch=async()=>{throw Error('Page fetch must not run');};
      f.w.browser={runtime:{sendMessage:r=>{sent.push(r);return r.type==='PAGE_IMAGE_READ'?new Promise(()=>{}):Promise.resolve({ok:true});}}};
      const task=f.w.ChatArchiveApiMedia.loadImage(preview,{signal:controller.signal});
      const rejected=assert.rejects(task,e=>{assert.equal(e.imageDiagnostic.code,stop?'IMAGE_ABORTED':'IMAGE_TIMEOUT');return true;});
      await clock.tickAsync(0);
      if(stop)controller.abort();else await clock.tickAsync(71000);
      await rejected;
      assert.deepEqual(sent.map(r=>r.type),['PAGE_IMAGE_READ','PAGE_IMAGE_CANCEL']);
      assert.equal(sent[0].id,sent[1].id);assert.equal(clock.countTimers(),0);
    }finally{clock.uninstall();f.close();}
  }
});

test('bridge errors and invalid responses are bounded and retain useful diagnostic categories',async()=>{
  for(const response of [
    {ok:false,code:'IMAGE_PERMISSION_REQUIRED'},
    {ok:false,code:'IMAGE_HTTP_ERROR',diagnostic:{httpStatus:403,requestStage:'headers',receivedBytes:0,url:'PRIVATE_URL'}},
    {ok:false,code:'PRIVATE_ERROR'},
    {ok:true,image:{...image,src:'javascript:PRIVATE'}}
  ]){
    const f=fixture();try{
      f.w.browser={runtime:{sendMessage:async()=>response}};f.w.fetch=async()=>{throw Error('Page fetch must not run');};
      await assert.rejects(f.w.ChatArchiveApiMedia.loadImage(preview,{signal:new f.w.AbortController().signal}),error=>{
        assert.equal(error.imageDiagnostic.code,['IMAGE_PERMISSION_REQUIRED','IMAGE_HTTP_ERROR'].includes(response.code)?response.code:'IMAGE_RESPONSE_INVALID');
        if(response.code==='IMAGE_HTTP_ERROR'){assert.equal(error.imageDiagnostic.httpStatus,403);assert.equal(error.imageDiagnostic.requestStage,'headers');}
        assert.doesNotMatch(JSON.stringify(error.imageDiagnostic)+error.message,/PRIVATE|https:/);return true;
      });
    }finally{f.close();}
  }
});

test('an exact AsyncImage search result uses its own saved preview; ambiguous results still fail',()=>{
  const f=fixture();try{
    const refs=[{type:'image_group',images:[{image_search_query:'fox',image_result:{content_url:'https://original.example/fox.jpg',thumbnail_url:preview}}]}];
    const result=f.w.ChatArchiveMarkdown.render('<AsyncImage query="fox" />',{allowComponents:true,references:refs});
    assert.equal(result.images[0].source.url,preview);
    refs[0].images.push({image_search_query:'fox',image_result:{thumbnail_url:preview+'different'}});
    assert.throws(()=>f.w.ChatArchiveMarkdown.render('<AsyncImage query="fox" />',{allowComponents:true,references:refs}),/unsupported|could not|safely/i);
  }finally{f.close();}
});

test('image 156 is checked before the first of 478 downloads; granting access permits the full export',async()=>{
  const f=fixture();try{
    const raw={conversation_id:ID,current_node:null,mapping:{}};
    // Same reported image/message boundary, synthetic surrounding conversation.
    for(let i=1;i<=670;i++){
      const n=i>=127&&i<=604?i-126:null;
      const parts=n===156?[`![Kitsune reference](${preview})`]:n?[{content_type:'image_asset_pointer',asset_pointer:`sediment://file${n}`}]:['Text'];
      raw.mapping['m'+i]={id:'m'+i,parent:raw.current_node,message:{id:'m'+i,author:{role:i%2?'user':'assistant'},status:'finished_successfully',content:{content_type:'multimodal_text',parts}}};
      raw.current_node='m'+i;
    }
    const reads=new Map(),sent=[],parts=[],references=[];
    let granted=false;
    f.w.browser={runtime:{sendMessage:async r=>{sent.push(r);return r.type==='IMAGE_ACCESS_CHECK'?{ok:true,granted}:{ok:true,image};}}};
    f.w.fetch=async(url,init)=>{
      if(url.endsWith('/session'))return json({accessToken:'PRIVATE'});
      if(url.endsWith(`/conversation/${ID}`))return json(raw);
      const ref=url.match(/\/attachment\/file(\d+)\/download$/);if(ref){references.push(url);return json({download_url:`https://fixture.example/${ref[1]}.png`});}
      if(url.startsWith('https://images.openai.com/'))throw TypeError('Blocked by CORS');
      assert.equal(init.credentials,'omit');assert.equal(init.headers.authorization,undefined);
      reads.set(url,(reads.get(url)||0)+1);return new Response(png);
    };
    await assert.rejects(f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{},()=>{},async p=>parts.push(p)),error=>{
      assert.equal(error.mediaDiagnostic.phase,'permission');assert.equal(error.mediaDiagnostic.image,156);
      assert.equal(error.mediaDiagnostic.messagePosition,282);assert.equal(error.mediaDiagnostic.total,478);
      assert.equal(error.mediaDiagnostic.attempts,0);assert.equal(error.mediaDiagnostic.download.code,'IMAGE_PERMISSION_REQUIRED');
      assert.equal(error.partialData,undefined);assert.equal(error.imageEmbedFailed,undefined);return true;
    });
    assert.equal(reads.size,0);assert.equal(references.length,0);assert.equal(parts.length,0);
    assert.deepEqual(sent.map(r=>r.type),['IMAGE_ACCESS_CHECK']);
    granted=true;sent.length=0;
    const result=await f.w.ChatArchiveApi.collect({outputFormat:'html'},()=>{},()=>{},async p=>parts.push(p));
    assert.equal(result.data.multipart.messages,670);assert.equal(result.data.embeddedImages,478);
    assert.deepEqual(parts.flatMap(p=>Array.from(p.messages,m=>m.id)),Array.from({length:670},(_,i)=>'m'+(i+1)));
    assert.equal(sent.length,2);assert.equal(sent[0].type,'IMAGE_ACCESS_CHECK');assert.equal(sent[1].type,'PAGE_IMAGE_READ');assert.equal(sent[1].url,preview);
    assert.equal(reads.size,477);assert.ok([...reads.values()].every(n=>n===1));
    assert.equal(parts.flatMap(p=>Array.from(p.messages,m=>(m.html.match(/data:image\/png;base64,/g)||[]).length)).reduce((a,b)=>a+b,0),478);
  }finally{f.close();}
});

test('permission preflight is cancellable, bounded and rejects unavailable or malformed replies without downloads',async()=>{
  for(const mode of ['stop','timeout','rejected','malformed']){
    const f=fixture(),clock=FakeTimers.withGlobal(f.w).install({toFake:['setTimeout','clearTimeout']});
    try{
      const controller=new f.w.AbortController(),sent=[];
      f.w.browser={runtime:{sendMessage:r=>{
        sent.push(r);if(mode==='rejected')return Promise.reject(Error('PRIVATE_TOKEN PRIVATE_URL'));
        if(mode==='malformed')return Promise.resolve({ok:true,granted:'yes'});
        return new Promise(()=>{});
      }}};
      f.w.fetch=async()=>{throw Error('No downloads before permission');};
      const data=f.w.ChatArchiveApi.normalize(rawGallery([{thumbnail_url:preview}]),`https://chatgpt.com/c/${ID}`,{outputFormat:'html'});
      const before=JSON.stringify(data);
      const task=f.w.ChatArchiveApiMedia.embed(data,{signal:controller.signal,check:()=>{},onProgress:()=>{}});
      const rejected=assert.rejects(task,error=>{
        if(mode==='stop')assert.equal(error.imageDiagnostic.code,'IMAGE_ABORTED');
        else {assert.equal(error.mediaDiagnostic.phase,'permission');assert.equal(error.mediaDiagnostic.download.code,'IMAGE_RESPONSE_INVALID');}
        assert.doesNotMatch(error.message+JSON.stringify(error.mediaDiagnostic),/PRIVATE/);return true;
      });
      await clock.tickAsync(0);if(mode==='stop')controller.abort();else if(mode==='timeout')await clock.tickAsync(5001);
      await rejected;assert.equal(clock.countTimers(),0);assert.equal(JSON.stringify(data),before);
      assert.deepEqual(sent.map(r=>r.type),['IMAGE_ACCESS_CHECK']);
    }finally{clock.uninstall();f.close();}
  }
});

test('text formats and excluded previews do not check or require image permission',async()=>{
  const f=fixture();try{
    const sent=[];f.w.browser={runtime:{sendMessage:async r=>{sent.push(r);return{ok:true,granted:false};}}};
    f.w.fetch=async url=>url.endsWith('/session')?json({accessToken:'PRIVATE'}):json(rawGallery([{thumbnail_url:preview}]));
    for(const options of [{outputFormat:'txt'},{outputFormat:'md'},{outputFormat:'json'},{outputFormat:'html',includeAssistantImages:false}]){
      const result=await f.w.ChatArchiveApi.collect(options,()=>{});assert.ok(result.data,result.fallback);
    }
    assert.equal(sent.length,0);
  }finally{f.close();}
});

test('gallery URL preference preserves image switches and never invents an OpenAI preview',()=>{
  const f=fixture();try{
    const source={content_url:'https://original.example/first.jpg',thumbnail_url:preview};
    assert.equal(f.w.ChatArchiveApi.normalize(rawGallery([source]),`https://chatgpt.com/c/${ID}`,{outputFormat:'html',includeAssistantImages:false}).messages[0].media,undefined);
    delete source.thumbnail_url;
    assert.equal(f.w.ChatArchiveApi.normalize(rawGallery([source]),`https://chatgpt.com/c/${ID}`,{outputFormat:'html'}).messages[0].media[0].source.url,source.content_url);
    const refs=[{type:'image_group',images:[{image_search_query:'fox',image_result:{content_url:'invalid',thumbnail_url:'https://original.example/thumb.jpg'}}]}];
    assert.equal(f.w.ChatArchiveMarkdown.render('<AsyncImage query="fox" />',{allowComponents:true,references:refs}).images[0].source.url,'https://original.example/thumb.jpg');
  }finally{f.close();}
});
