const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const FakeTimers = require('@sinonjs/fake-timers');
function fixture(options = {}) {
  let receive, next = 0, automatic = true; const changes = new Set(), removed = new Set(), files = [], revoked = [], states = new Map();
  const notifications = [], badges = [], colors = [], relays = [];
  const context = vm.createContext({ indexedDB: new IDBFactory(), IDBKeyRange, Date, setTimeout, clearTimeout, AbortController,
    crypto: { randomUUID: () => `job-${++next}` }, Blob, URL: { createObjectURL: () => `blob:${++next}`, revokeObjectURL: url => revoked.push(url) },
    ChatArchiveRenderers: { html: data => data.messages.map(m => m.html).join('') },
    browser: { runtime: { getURL: file => `moz-extension://fixture/${file}`, onMessage: { addListener: fn => { receive = fn; } } },
      action: { setBadgeText: async value => badges.push(value.text), setBadgeBackgroundColor: async value => colors.push(value.color) },
      permissions: { contains: async () => options.permission === true },
      notifications: { create: async (id, details) => { if (options.notificationFailure) throw Error('OS unavailable'); notifications.push({ id, ...details }); } },
      tabs: { sendMessage: async (tabId, message, options) => { relays.push({tabId,message,options});return {ok:true}; }, create: async () => ({ id: 10 }), onRemoved: { addListener: fn => removed.add(fn) } },
      downloads: { onChanged: { addListener: fn => changes.add(fn), removeListener: fn => changes.delete(fn) },
        download: async options => { const id = ++next; files.push(options); states.set(id, automatic ? 'complete' : 'in_progress'); return id; },
        search: async ({ id }) => [{ id, state: states.get(id) }],
        cancel: async id => { states.set(id, 'interrupted'); for (const fn of [...changes]) fn({ id, state: { current: 'interrupted' } }); }
      } } });
  const clock = FakeTimers.withGlobal(context).install({ toFake: ['setTimeout', 'clearTimeout'] });
  for (const file of ['shared/parts-store.js', 'background.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { send: (req, sender = { tab: { id: 1 }, frameId: 0 }) => receive(req, sender), store: context.ChatArchiveParts, files, revoked,
    notifications, badges, colors, clock, relays,
    pending: () => { automatic = false; }, removeTab: async id => { for (const fn of removed) await fn(id); }, close: () => clock.uninstall() };
}

test('panel commands require the extension iframe, bind to its sender tab and reject arbitrary relay messages',async()=>{
  const f=fixture({permission:true});
  const sender={url:'moz-extension://fixture/popup/popup.html?panel=1',tab:{id:42},frameId:3};
  try {
    assert.equal((await f.send({type:'PANEL_CONTEXT'})).ok,false);
    assert.equal((await f.send({type:'PANEL_CONTEXT'},sender)).tabId,42);
    assert.equal((await f.send({type:'PANEL_SEND',message:{type:'EXPORT_READY'}},sender)).ok,false);
    await f.send({type:'PANEL_SEND',message:{type:'PING'},tabId:99},sender);
    assert.equal(f.relays[0].tabId,42);assert.equal(f.relays[0].options.frameId,0);
    assert.equal((await f.send({type:'PANEL_SIZE',height:Infinity},sender)).ok,false);
    await f.send({type:'PANEL_SIZE',height:9000},sender);assert.equal(f.relays[1].message.height,1600);
  } finally {f.close();}
});

test('completion and errors notify only with opt-in plus permission and use privacy-safe, accurate status', async () => {
  for (const permission of [false, true]) for (const notify of [false, true]) {
    const f = fixture({ permission });
    try {
      const requests = [
        { type: 'EXPORT_COMPLETE', format: 'html', parts: 3 },
        { type: 'EXPORT_COMPLETE', format: 'pdf', parts: 3 },
        { type: 'EXPORT_COMPLETE', format: 'md', parts: 1 },
        { type: 'EXPORT_FAILED' }
      ];
      for (const request of requests) assert.equal((await f.send({ ...request, notify, title: 'PRIVATE TITLE', filename: 'PRIVATE.html', error: 'PRIVATE URL', data: 'PRIVATE TEXT' })).ok, true);
      assert.equal(f.notifications.length, permission && notify ? 4 : 0);
      if (permission && notify) {
        assert.match(f.notifications[0].message, /3 HTML parts saved to Downloads/);
        assert.match(f.notifications[1].message, /PDF layout ready: 3 parts.*Save from the print page/);
        assert.match(f.notifications[2].message, /File sent to Firefox.*save dialog or Downloads/);
        assert.match(f.notifications[3].message, /Export stopped/);
        assert.ok(f.notifications.every(n => n.title === 'Dialogue Export' && n.iconUrl.endsWith('/icons/icon-96.png')));
        assert.doesNotMatch(JSON.stringify(f.notifications), /PRIVATE/);
      }
    } finally { f.close(); }
  }
});

test('notification delivery failure cannot change a successful export and result badges persist until dismissal or new progress', async () => {
  const f = fixture({ permission: true, notificationFailure: true });
  try {
    assert.equal((await f.send({ type: 'EXPORT_COMPLETE', format: 'html', notify: true })).ok, true);
    f.clock.tick(60000); assert.equal(f.badges.at(-1), '✓');
    await f.send({ type: 'EXPORT_DISMISSED' }); assert.equal(f.badges.at(-1), '');
    assert.equal((await f.send({ type: 'EXPORT_FAILED', notify: true })).ok, true);
    f.clock.tick(60000); assert.equal(f.badges.at(-1), '!');
    await f.send({ type: 'EXPORT_PROGRESS', stage: 'LOAD' }); assert.equal(f.badges.at(-1), 'LOAD');
    assert.equal(f.notifications.length, 0);
  } finally { f.close(); }
});
async function stage(f, format = 'html') {
  const { id } = await f.send({ type: 'EXPORT_PARTS_START', job: { format, filename: `test.${format}`, options: {} } });
  for (let order = 0; order < 2; order++) assert.equal((await f.send({ type: 'EXPORT_PARTS_STAGE', id, data: { messages: [{ order, html: '<p>Test</p>' }] } })).ok, true);
  assert.equal((await f.send({ type: 'EXPORT_PARTS_SEAL', id, summary: { parts: 2, messages: 2 } })).ok, true);
  return id;
}
test('HTML parts wait for completion, use numbered Downloads filenames and release disk/Blob data', async () => {
  const f = fixture();
  try {
    const id = await stage(f);
    for (let index = 1; index <= 2; index++) assert.equal((await f.send({ type: 'EXPORT_PARTS_SAVE', id, index })).ok, true);
    assert.deepEqual(f.files.map(file => file.filename), ['test-part-001-of-002.html', 'test-part-002-of-002.html']);
    assert.ok(f.files.every(file => file.saveAs === false)); assert.equal(f.revoked.length, 2);
    assert.equal((await f.store.allJobs()).length, 0);
  } finally { f.close(); }
});
test('Stop cancels an unfinished part and removes remaining staged data', async () => {
  const f = fixture();
  try {
    const id = await stage(f); f.pending();
    const saving = f.send({ type: 'EXPORT_PARTS_SAVE', id, index: 1 });
    for (let i = 0; i < 100 && !f.files.length; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.files.length, 1);
    await f.send({ type: 'EXPORT_PARTS_ABORT', id });
    assert.equal((await saving).ok, false); assert.equal(f.revoked.length, 1);
    assert.equal((await f.store.allJobs()).length, 0);
  } finally { f.close(); }
});
test('PDF parts are restricted to the print page and removed when that tab closes', async () => {
  const f = fixture();
  try {
    const id = await stage(f, 'pdf');
    assert.equal((await f.send({ type: 'GET_PRINT_PART', id, index: 1 })).ok, false);
    assert.equal((await f.send({ type: 'EXPORT_PARTS_PRINT', id })).ok, true);
    const result = await f.send({ type: 'GET_PRINT_PART', id, index: 2 }, { url: 'moz-extension://fixture/print/print.html?parts=test', tab: { id: 10 } });
    assert.equal(result.ok, true); assert.equal(result.filename, 'test-part-002-of-002.pdf');
    await f.removeTab(1); assert.equal((await f.store.allJobs()).length, 1);
    await f.removeTab(10); assert.equal((await f.store.allJobs()).length, 0);
  } finally { f.close(); }
});
