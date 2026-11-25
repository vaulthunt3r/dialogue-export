const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');
const source = fs.readFileSync(require('node:path').join(__dirname, '../shared/parts-store.js'), 'utf8');
function fixture() {
  let now = 1000, id = 0;
  const context = vm.createContext({ indexedDB: new IDBFactory(), IDBKeyRange, crypto: { randomUUID: () => `job-${++id}` },
    Date: class extends Date { static now() { return now; } } });
  vm.runInContext(source, context);
  return { store: context.ChatArchiveParts, advance: ms => { now += ms; } };
}
const exportJob = { format: 'html', filename: 'Conversation.html', options: {} };
const data = (first, count = 1) => ({ title: 'Fixture', messages: Array.from({ length: count }, (_, i) => ({ id: `m${first + i}`, order: first + i, role: 'user', html: `<p>Message ${first + i}</p>` })) });

test('explicit partial sealing validates the prefix and labels even a single retained part', async () => {
  for (const reason of ['stopped', 'image-error']) {
    const { store } = fixture(), id = await store.start(exportJob, '1:0');
    await store.stage(id, '1:0', data(0, 2));
    for (const partialExport of [{ reason, messages: 1, totalMessages: 5 }, { reason, messages: 2, totalMessages: 2 }, { reason: 'unknown', messages: 2, totalMessages: 5 }]) {
      await assert.rejects(store.seal(id, '1:0', { parts: 1, messages: 2, partialExport }), /partial export/);
    }
    const partialExport = { reason, messages: 2, totalMessages: 5 };
    await store.seal(id, '1:0', { parts: 1, messages: 2, partialExport });
    const result = await store.part(id, 1, '1:0');
    assert.deepEqual(JSON.parse(JSON.stringify(result.data.partialExport)), partialExport);
    assert.equal(result.job.filename, 'Conversation-partial-part-001-of-001.html');
    assert.equal(result.data.exportPart.last, 2);
    await store.remove(id);
  }
});

test('disk parts are ordered, owned by their tab and unavailable until the full export is sealed', async () => {
  const { store } = fixture(), id = await store.start(exportJob, '1:0');
  await store.stage(id, '1:0', data(0, 2));
  await assert.rejects(store.stage(id, '2:0', data(2)), /another tab/);
  await assert.rejects(store.stage(id, '1:0', data(3)), /message order/);
  await assert.rejects(store.part(id, 1, '1:0'), /Invalid export part/);
  await store.stage(id, '1:0', data(2));
  await assert.rejects(store.seal(id, '1:0', { parts: 2, messages: 4 }), /incomplete/);
  await store.seal(id, '1:0', { parts: 2, messages: 3 });
  const a = await store.part(id, 1, '1:0'), b = await store.part(id, 2, '1:0');
  assert.equal(a.job.filename, 'Conversation-part-001-of-002.html');
  assert.equal(b.data.messages[0].id, 'm2');
  assert.deepEqual(JSON.parse(JSON.stringify(b.data.exportPart)), { index: 2, total: 2, first: 3, last: 3, messages: 3 });
  await store.saved(id, '1:0', 1);
  await assert.rejects(store.part(id, 1, '1:0'), /no longer available/);
  await store.remove(id);
  assert.equal((await store.allJobs()).length, 0);
  await assert.rejects(store.part(id, 2), /expired/);
});

test('abort serializes after an in-flight stage, and expired sessions remove their parts', async () => {
  const { store, advance } = fixture(), id = await store.start(exportJob, '1:0');
  const staging = store.stage(id, '1:0', data(0));
  const removing = store.remove(id);
  await Promise.all([staging, removing]);
  await assert.rejects(store.stage(id, '1:0', data(1)), /expired/);
  const next = await store.start(exportJob, '1:0');
  await store.stage(next, '1:0', data(0));
  advance(3600001); await store.cleanup();
  assert.equal((await store.allJobs()).length, 0);
});

test('PDF parts can be revisited and renewing the print view extends their expiry', async () => {
  const { store, advance } = fixture(), id = await store.start({ ...exportJob, format: 'pdf', filename: 'Conversation.pdf' }, '1:0');
  await store.stage(id, '1:0', data(0)); await store.stage(id, '1:0', data(1));
  await store.seal(id, '1:0', { parts: 2, messages: 2 });
  await store.printing(id, '1:0', 10); advance(3500000);
  await store.part(id, 2); await store.part(id, 1); await store.printing(id, '1:0', 10);
  advance(3500000); await store.cleanup();
  assert.equal((await store.job(id)).printTabId, 10);
  await store.remove(id);
});
