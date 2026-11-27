// A small zip reader and writer for game bundles, so the installer needs no dependency and every rule about what a
// bundle may hold is in one place we can test.
//
// Reading refuses anything that could escape the game's folder or surprise us: absolute paths, "..", backslashes,
// drive letters, symlinks, encrypted entries, zip64, more than MAX_FILES entries or more than MAX_TOTAL bytes
// unpacked (zip bombs). Writing is deterministic (sorted names, a fixed date, stored, not compressed), so CI can
// rebuild a bundle from a pinned commit and get the same bytes, and the same sha256.
import zlib from 'node:zlib';

export const MAX_FILES = 2000;
export const MAX_TOTAL = 50 * 1024 * 1024; // unpacked
export const MAX_FILE = 20 * 1024 * 1024;

export interface ZipFile { path: string; data: Buffer }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// The one place a path from a zip (or a pointer, or a URL) becomes a path inside the game's folder.
// Returns the clean relative path, or null when it would leave the folder or is not a plain file path.
export function safeRelPath(name: string): string | null {
  if (typeof name !== 'string' || !name || name.length > 240) return null;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) return null;
  if (parts.some((p) => /[<>:"|?*\x00-\x1f]/.test(p))) return null;
  return parts.join('/');
}

export class ZipError extends Error {}

// Reads a whole zip held in memory. Directories are skipped (folders come from file paths).
export function readZip(buf: Buffer): ZipFile[] {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ZipError('zip64 archives are not supported');
  if (count > MAX_FILES) throw new ZipError(`too many files (${count}; at most ${MAX_FILES})`);
  if (cdOff + cdSize > buf.length) throw new ZipError('the zip is truncated');
  const out: ZipFile[] = [], seen = new Set<string>();
  let p = cdOff, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError('bad central directory');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8, ext = buf.readUInt32LE(p + 38), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (flags & 1) throw new ZipError(`${name}: encrypted entries are not allowed`);
    const unixMode = madeBy === 3 ? ext >>> 16 : 0;
    if ((unixMode & 0o170000) === 0o120000) throw new ZipError(`${name}: symlinks are not allowed`);
    if (name.endsWith('/')) { if (safeRelPath(name.slice(0, -1)) === null) throw new ZipError(`${name}: unsafe path`); continue; }
    const rel = safeRelPath(name);
    if (rel === null) throw new ZipError(`${JSON.stringify(name)}: unsafe path (it would land outside the game folder)`);
    const key = rel.toLowerCase(); // two names that differ only in case would overwrite each other on macOS
    if (seen.has(key)) throw new ZipError(`${rel}: listed twice`);
    seen.add(key);
    if (usize > MAX_FILE) throw new ZipError(`${rel}: too large (${usize} bytes; at most ${MAX_FILE})`);
    total += usize;
    if (total > MAX_TOTAL) throw new ZipError(`the bundle unpacks to more than ${MAX_TOTAL} bytes`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError(`${rel}: bad local header`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + csize > buf.length) throw new ZipError(`${rel}: truncated`);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_FILE + 1 }); } catch (e) { throw new ZipError(`${rel}: ${(e as Error).message}`); }
    } else throw new ZipError(`${rel}: compression method ${method} is not supported`);
    if (data.length !== usize) throw new ZipError(`${rel}: size does not match`);
    if (crc32(data) !== crc) throw new ZipError(`${rel}: checksum does not match`);
    out.push({ path: rel, data });
  }
  return out;
}

function findEocd(buf: Buffer): number {
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  throw new ZipError('not a zip file');
}

const DOS_DATE = (1 << 5) | 1; // 1980-01-01, so the same files always make the same zip
const DOS_TIME = 0;

// Writes files into a stored (uncompressed) zip, sorted by path. The same files give the same bytes.
export function writeZip(files: ZipFile[]): Buffer {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const locals: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  for (const f of sorted) {
    const rel = safeRelPath(f.path);
    if (rel === null) throw new ZipError(`${f.path}: unsafe path`);
    const name = Buffer.from(rel, 'utf8'), crc = crc32(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(DOS_TIME, 10); lh.writeUInt16LE(DOS_DATE, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(f.data.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(DOS_TIME, 12); ch.writeUInt16LE(DOS_DATE, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(f.data.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a plain file, rw-r--r--, never executable
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + f.data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(sorted.length, 8); end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
