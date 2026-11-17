(function (root) {
  // Temporary local disk staging. Never load all part payloads into memory.
  const ttl = 60 * 60 * 1000;
  const locks = new Map();
  let opening;
  function database() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('dialogue-export-parts', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('jobs', { keyPath: 'id' });
        request.result.createObjectStore('parts', { keyPath: ['id', 'index'] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { opening = null; reject(new Error('Temporary local export storage is unavailable. No files were saved.')); };
    });
    return opening;
  }
  async function transaction(stores, mode, run) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(new Error('Could not write or read temporary local export storage. Check available disk space.'));
      run(tx, result => { value = result; });
    });
  }
  const read = (store, key) => transaction([store], 'readonly', (tx, result) => {
    tx.objectStore(store).get(key).onsuccess = event => result(event.target.result);
  });
  function locked(id, run) {
    const next = (locks.get(id) || Promise.resolve()).catch(() => {}).then(run);
    locks.set(id, next);
    return next.finally(() => { if (locks.get(id) === next) locks.delete(id); });
  }
  const range = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  async function erase(id) {
    await transaction(['jobs', 'parts'], 'readwrite', tx => {
      tx.objectStore('jobs').delete(id);
      tx.objectStore('parts').delete(range(id));
    });
  }
  async function job(id, owner) {
    const value = await read('jobs', id);
    if (!value || Date.now() - value.updatedAt > ttl) {
      if (value) await erase(id);
      throw new Error('The temporary export expired. Export the conversation again.');
    }
    if (owner !== undefined && value.owner !== owner) throw new Error('This export belongs to another tab.');
    return value;
  }
  const allJobs = () => transaction(['jobs'], 'readonly', (tx, result) => {
    tx.objectStore('jobs').getAll().onsuccess = event => result(event.target.result);
  });
  const remove = id => locked(id, () => erase(id));
  async function cleanup() {
    for (const item of await allJobs()) if (Date.now() - item.updatedAt > ttl) await remove(item.id);
  }
  function filename(value, index, total) {
    const dot = value.lastIndexOf('.');
    const stem = dot < 0 ? value : value.slice(0, dot), ext = dot < 0 ? '' : value.slice(dot);
    return `${stem}-part-${String(index).padStart(3, '0')}-of-${String(total).padStart(3, '0')}${ext}`;
  }
  root.ChatArchiveParts = {
    filename, job, remove, cleanup, allJobs,
    async start(exportJob, owner) {
      await cleanup();
      if (!['html', 'pdf'].includes(exportJob.format)) throw new Error('Multipart export supports HTML and PDF.');
      const entry = { id: crypto.randomUUID(), owner, job: exportJob, updatedAt: Date.now(), count: 0, messages: 0, saved: 0, state: 'preparing' };
      await transaction(['jobs'], 'readwrite', tx => tx.objectStore('jobs').put(entry));
      return entry.id;
    },
    stage(id, owner, data) {
      return locked(id, async () => {
        const entry = await job(id, owner);
        if (entry.state !== 'preparing' || !data.messages?.length) throw new Error('Invalid export part sequence.');
        const first = entry.messages + 1;
        for (let i = 0; i < data.messages.length; i++) {
          if (data.messages[i].order !== entry.messages + i) throw new Error('Export parts are not in message order.');
        }
        entry.count++; entry.messages += data.messages.length; entry.updatedAt = Date.now();
        await transaction(['jobs', 'parts'], 'readwrite', tx => {
          tx.objectStore('parts').put({ id, index: entry.count, first, last: entry.messages, data });
          tx.objectStore('jobs').put(entry);
        });
        return entry.count;
      });
    },
    seal(id, owner, summary) {
      return locked(id, async () => {
        const entry = await job(id, owner);
        if (entry.state !== 'preparing' || entry.count !== summary.parts || entry.messages !== summary.messages || entry.count < 2) {
          throw new Error('The multipart export is incomplete. No files were saved.');
        }
        entry.state = 'ready'; entry.updatedAt = Date.now();
        await transaction(['jobs'], 'readwrite', tx => tx.objectStore('jobs').put(entry));
        return entry.count;
      });
    },
    async part(id, index, owner) {
      const entry = await job(id, owner);
      if (entry.state !== 'ready' || !Number.isInteger(index) || index < 1 || index > entry.count) throw new Error('Invalid export part.');
      const part = await read('parts', [id, index]);
      if (!part) throw new Error('This export part is no longer available.');
      part.data.exportPart = { index, total: entry.count, first: part.first, last: part.last, messages: entry.messages };
      return { ...part, job: { ...entry.job, filename: filename(entry.job.filename, index, entry.count) } };
    },
    saved(id, owner, index) {
      return locked(id, async () => {
        const entry = await job(id, owner);
        if (index !== entry.saved + 1) throw new Error('Invalid saved-part sequence.');
        entry.saved = index; entry.updatedAt = Date.now();
        await transaction(['jobs', 'parts'], 'readwrite', tx => {
          tx.objectStore('parts').delete([id, index]);
          tx.objectStore('jobs').put(entry);
        });
      });
    },
    printing(id, owner, tabId) {
      return locked(id, async () => {
        const entry = await job(id, owner);
        entry.printTabId = tabId; entry.updatedAt = Date.now();
        await transaction(['jobs'], 'readwrite', tx => tx.objectStore('jobs').put(entry));
      });
    }
  };
})(globalThis);
