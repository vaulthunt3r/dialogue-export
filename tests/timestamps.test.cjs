const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const stamp = '2026-09-07T10:42:00.000Z';
const later = '2026-09-07T10:43:00.000Z';
const seconds = Date.parse(stamp) / 1000;
const baseMessage = (id, role, create_time = seconds) => ({ id, author: { role }, create_time });

function fixture(url = 'https://chatgpt.com/c/example') {
  const dom = new JSDOM('<!doctype html><title>Test conversation</title><section data-turn-id="turn-a"><div data-message-id="question" data-message-author-role="user"><p>Question</p></div><div data-message-id="answer" data-message-author-role="assistant"><p>Answer</p></div></section>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  ['shared/timestamps.js', 'content/timestamps.js', 'content/extract.js', 'shared/renderers.js'].forEach(file => w.eval(read(file)));
  return { w, close: () => w.close(), node: id => w.document.querySelector(`[data-message-id="${id}"]`) };
}

test('timestamps normalize Unix seconds, milliseconds and explicit offsets into the same UTC instant', () => {
  const f = fixture();
  for (const value of [seconds, String(seconds), seconds * 1000, stamp, '2026-09-07T13:42:00+03:00']) assert.equal(f.w.ChatArchiveTimestamps.normalize(value), stamp);
  assert.equal(f.w.ChatArchiveTimestamps.normalize(seconds + .25), '2026-09-07T10:42:00.250Z');
  assert.match(f.w.ChatArchiveTimestamps.display(stamp), /2026/);
  f.close();
});

test('missing, ambiguous, corrupt and impossible dates are never replaced by the export time', () => {
  const f = fixture();
  for (const value of [null, undefined, '', false, true, 0, -1, NaN, Infinity, {}, 'today', '10:42', '2026-09-07', '2026-09-07T10:42:00', '2026-02-30T10:42:00Z', '<script>', seconds * 1000000]) {
    assert.equal(f.w.ChatArchiveTimestamps.normalize(value), null, String(value));
    assert.equal(f.w.ChatArchiveTimestamps.display(value), '', String(value));
  }
  f.close();
});

test('Firefox unwrapped React data is matched by exact id and role even with several answer variants', () => {
  const f = fixture();
  const props = { messages: [baseMessage('other-answer', 'assistant', seconds - 600), baseMessage('question', 'user'), baseMessage('answer', 'assistant', seconds + 60)] };
  f.node('question').wrappedJSObject = { __reactFiber$fixture: { memoizedProps: {}, return: { memoizedProps: props } } };
  f.node('answer').wrappedJSObject = f.node('question').wrappedJSObject;
  const data = f.w.ChatArchiveExtractor.collect({ includeTimestamps: true });
  assert.equal(data.messages[0].createdAt, stamp);
  assert.equal(data.messages[1].createdAt, later);
  assert.equal(data.messages[1].messageId, 'answer');
  f.close();
});

test('direct message props and wrapped message records work on the nearest turn', () => {
  const f = fixture();
  f.node('question').__reactProps$fixture = { message: baseMessage('question', 'user') };
  f.w.document.querySelector('section').__reactFiber$fixture = { memoizedProps: { messages: [{ message: baseMessage('answer', 'assistant', seconds + 60) }] } };
  const data = f.w.ChatArchiveExtractor.collect({ includeTimestamps: true });
  assert.equal(data.messages[0].createdAt, stamp);assert.equal(data.messages[1].createdAt, later);
  f.close();
});

test('unrelated message time, mismatched role and update_time cannot become creation time', () => {
  const f = fixture();const node = f.node('answer');
  for (const message of [baseMessage('question', 'user'), baseMessage('answer', 'user'), {id:'answer', author:{role:'assistant'}, update_time:seconds}]) {
    node.__reactFiber$fixture = {memoizedProps:{message}};
    assert.equal(f.w.ChatArchiveMessageTimestamps.read(node, 'assistant'), null);
  }
  node.removeAttribute('data-message-id');
  node.__reactFiber$fixture = {memoizedProps:{messages:[baseMessage('answer','assistant')]}};
  assert.equal(f.w.ChatArchiveMessageTimestamps.read(node, 'assistant'), null);
  f.close();
});

test('page getters are not invoked, cyclic fibers terminate and inaccessible objects do not break extraction', () => {
  const f=fixture();let calls=0;
  const message=baseMessage('answer','assistant');Object.defineProperty(message,'create_time',{get(){calls++;throw Error('page getter');}});
  const fiber={memoizedProps:{message}};fiber.return=fiber;f.node('answer').wrappedJSObject={__reactFiber$fixture:fiber};
  assert.equal(f.w.ChatArchiveMessageTimestamps.read(f.node('answer'),'assistant'),null);assert.equal(calls,0);
  f.node('answer').wrappedJSObject=new Proxy({}, {ownKeys(){throw Error('inaccessible');}});
  assert.equal(f.w.ChatArchiveExtractor.collect({includeTimestamps:true}).messages.length,2);
  f.close();
});

test('explicit DOM message metadata is read but dates inside the message body are ignored', () => {
  const f=fixture();f.node('question').setAttribute('data-message-created-at',stamp);
  const bodyTime=f.w.document.createElement('time');bodyTime.dateTime=later;bodyTime.textContent='An example date';f.node('answer').append(bodyTime);
  const data=f.w.ChatArchiveExtractor.collect({includeTimestamps:true});
  assert.equal(data.messages[0].createdAt,stamp);assert.equal(data.messages[1].createdAt,null);assert.match(data.messages[1].text,/example date/);
  f.close();
});

test('disabling timestamps skips React reads and retains the previous message schema', () => {
  const f=fixture();let reads=0;
  for(const node of [f.node('question'),f.node('answer')])Object.defineProperty(node,'wrappedJSObject',{get(){reads++;throw Error('must not read');}});
  const data=f.w.ChatArchiveExtractor.collect();
  assert.equal(reads,0);assert.equal(data.messages.length,2);
  for(const message of data.messages){assert.equal('createdAt' in message,false);assert.equal('messageId' in message,false);}
  f.close();
});

test('Gemini is exported normally without inferring dates from unrelated internal data', () => {
  const f=fixture('https://gemini.google.com/app/example');
  f.node('question').__reactProps$fixture={message:baseMessage('question','user')};
  const data=f.w.ChatArchiveExtractor.collect({includeTimestamps:true});
  assert.equal(data.provider,'Gemini');assert.equal(data.messages[0].createdAt,null);f.close();
});

function documentData() {
  return {title:'Example',provider:'ChatGPT',url:'https://chatgpt.com/c/example',exportedAt:'2026-09-10T12:00:00.000Z',messages:[
    {id:'turn-0',role:'user',text:'Question',markdown:'Question',html:'<p>Question</p>',createdAt:stamp},
    {id:'turn-1',role:'assistant',text:'Answer',markdown:'Answer',html:'<p>Answer</p>',createdAt:null}
  ]};
}

test('TXT and Markdown show per-message local time plus an honest missing-date note without a document header', () => {
  const f=fixture(),data=documentData(),api=f.w.ChatArchiveRenderers,time=f.w.ChatArchiveTimestamps.display(stamp);
  const options={includeTitle:false,includeTimestamps:true};
  assert.ok(api.txt(data,options).includes(`User:\n${time}\nQuestion`));
  assert.ok(api.md(data,options).includes(`## User\n\n*${time}*\n\nQuestion`));
  for(const result of [api.txt(data,options),api.md(data,options)]){
    assert.match(result,/Message timestamps: 1 of 2/);assert.doesNotMatch(result,/Saved:|Invalid Date|1970/);assert.match(result,/Answer/);
  }
  f.close();
});

test('HTML and PDF layout contain one semantic time element and preserve all content', () => {
  const f=fixture(),data=documentData(),api=f.w.ChatArchiveRenderers;
  for(const print of [false,true]){
    const html=api.html(data,{includeTitle:true,includeTimestamps:true},print),dom=new JSDOM(html),doc=dom.window.document;
    assert.equal(doc.querySelectorAll('time').length,1);assert.equal(doc.querySelector('time').dateTime,stamp);
    assert.equal(doc.querySelectorAll('article').length,2);assert.match(doc.querySelector('.timestamp-note').textContent,/1 of 2/);
    assert.equal(Boolean(doc.querySelector('.print-toolbar')),print);dom.window.close();
  }
  f.close();
});

test('JSON uses UTC ISO dates, null for missing dates and counts actual messages without mutating its input', () => {
  const f=fixture(),data=documentData();data.messages[0].createdAt='2026-09-07T13:42:00+03:00';const before=JSON.stringify(data);
  const result=JSON.parse(f.w.ChatArchiveRenderers.json(data,{includeTimestamps:true}));
  assert.equal(result.messages[0].createdAt,stamp);assert.equal(result.messages[1].createdAt,null);
  assert.equal(result.messageTimestamps.available,1);assert.equal(result.messageTimestamps.total,2);assert.equal(typeof result.messageTimestamps.timeZone,'string');
  assert.equal(JSON.stringify(data),before);f.close();
});

test('all export formats hide optional timestamps when switched off and complete dates need no warning', () => {
  const f=fixture(),data=documentData(),api=f.w.ChatArchiveRenderers;
  for(const format of ['txt','md','html','json']) {
    const output=api[format](data,{includeTitle:false,includeTimestamps:false});
    assert.doesNotMatch(output,/2026-09-07|Message timestamps:|datetime=|"createdAt"|"messageTimestamps"/);
  }
  data.messages[1].createdAt=later;
  assert.doesNotMatch(api.md(data,{includeTimestamps:true}),/Missing times|Message timestamps:/);
  assert.equal(JSON.parse(api.json(data,{includeTimestamps:true})).messageTimestamps.available,2);
  f.close();
});
