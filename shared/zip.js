/* Bounded ZIP/STORE writer. UTF-8 names, CRC-32, no remote dependencies or ZIP64. */
(function (root) {
  const encoder = new TextEncoder();
  const table = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  function crc32(bytes) { let n = 0xffffffff; for (const b of bytes) n = table[(n ^ b) & 255] ^ (n >>> 8); return (n ^ 0xffffffff) >>> 0; }
  function header(length) {
    const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
    return { bytes, u16: (at, value) => view.setUint16(at, value, true), u32: (at, value) => view.setUint32(at, value, true) };
  }
  class Writer {
    constructor(limit = 32 * 1024 * 1024) { this.limit = limit; this.entries = []; this.names = new Set(); this.size = 22; }
    add(name, data) {
      if (typeof name !== 'string' || !name || name.startsWith('/') || name.split('/').some(p => !p || p === '.' || p === '..') || /[\\\x00-\x1f:]/.test(name) || this.names.has(name)) throw Error('Invalid or duplicate ZIP entry name.');
      const filename = encoder.encode(name), bytes = typeof data === 'string' ? encoder.encode(data) : data;
      if (!(bytes instanceof Uint8Array) || filename.length > 65535 || this.entries.length >= 60000) throw Error('ZIP entry limit exceeded.');
      const extra = bytes.length + 76 + 2 * filename.length;
      if (this.size + extra > this.limit) throw Error('ZIP part size limit exceeded.');
      this.entries.push({ filename, bytes, crc: crc32(bytes) }); this.names.add(name); this.size += extra;
    }
    blob() {
      const chunks = [], directory = []; let offset = 0, centralBytes = 0;
      for (const entry of this.entries) {
        const local = header(30); local.u32(0, 0x04034b50); local.u16(4, 20); local.u16(6, 0x800); local.u16(12, 0x21);
        local.u32(14, entry.crc); local.u32(18, entry.bytes.length); local.u32(22, entry.bytes.length); local.u16(26, entry.filename.length);
        chunks.push(local.bytes, entry.filename, entry.bytes);
        const central = header(46); central.u32(0, 0x02014b50); central.u16(4, 20); central.u16(6, 20); central.u16(8, 0x800); central.u16(14, 0x21);
        central.u32(16, entry.crc); central.u32(20, entry.bytes.length); central.u32(24, entry.bytes.length); central.u16(28, entry.filename.length); central.u32(42, offset);
        directory.push(central.bytes, entry.filename); centralBytes += 46 + entry.filename.length; offset += 30 + entry.filename.length + entry.bytes.length;
      }
      const end = header(22); end.u32(0, 0x06054b50); end.u16(8, this.entries.length); end.u16(10, this.entries.length); end.u32(12, centralBytes); end.u32(16, offset);
      return new Blob([...chunks, ...directory, end.bytes], { type: 'application/zip' });
    }
  }
  root.ChatArchiveZip = { Writer, crc32 };
})(globalThis);
