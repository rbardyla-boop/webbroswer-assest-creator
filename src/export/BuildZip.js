// Minimal, dependency-free ZIP writer (store/no-compression). Produces a real,
// openable .zip with a folder structure — enough to package a playable build
// without pulling in a heavy archiver dependency. Deterministic (fixed DOS
// timestamp) so identical inputs yield identical bytes. Node-safe.
//
// Layout per file: [local header][name][data]; then a central directory of
// [central header][name]; then the end-of-central-directory record.

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
// Fixed DOS date/time: 1980-01-01 00:00:00 (the zip epoch) for reproducibility.
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const textEncoder = new TextEncoder();

/**
 * @param {{ path: string, bytes?: Uint8Array, text?: string }[]} files
 * @returns {Uint8Array} the complete zip archive
 */
export function createZip(files) {
  const entries = (files ?? []).map((file) => {
    const nameBytes = textEncoder.encode(normalizePath(file.path));
    const data = file.bytes instanceof Uint8Array ? file.bytes : textEncoder.encode(file.text ?? "");
    return { nameBytes, data, crc: crc32(data) };
  });

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const local = new Uint8Array(30 + entry.nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, LOCAL_SIG, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, entry.crc, true);
    lv.setUint32(18, entry.data.length, true); // compressed size (== raw)
    lv.setUint32(22, entry.data.length, true); // uncompressed size
    lv.setUint16(26, entry.nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(entry.nameBytes, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, CENTRAL_SIG, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // method: store
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, entry.crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(entry.nameBytes, 46);
    centralParts.push(central);

    offset += local.length + entry.data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir disk
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true); // central dir offset
  ev.setUint16(20, 0, true); // comment length

  return concatBytes([...localParts, ...centralParts, eocd]);
}

function normalizePath(path) {
  // Strip backslashes, leading slashes, and any ".." segment so a crafted zip
  // entry name cannot be read (or later written) as a traversal path.
  return String(path ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/(^|\/)\.\.(?=\/|$)/g, "$1_");
}

const textDecoder = new TextDecoder();

/**
 * Read a store-only (method 0) zip into { path, bytes } entries via the central
 * directory. Compressed entries are skipped (this writer only stores). Paths are
 * returned normalized; callers must still sanitize before writing to disk.
 * @param {Uint8Array} bytes
 * @returns {{ path: string, bytes: Uint8Array }[]}
 */
export function readZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 22) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  if (eocd < 0) return [];
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true); // central directory offset
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (pointer + 46 > bytes.length || view.getUint32(pointer, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(pointer + 10, true);
    const compSize = view.getUint32(pointer + 20, true);
    const nameLen = view.getUint16(pointer + 28, true);
    const extraLen = view.getUint16(pointer + 30, true);
    const commentLen = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = textDecoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLen));
    pointer += 46 + nameLen + extraLen + commentLen;

    if (method !== 0) continue; // only store is supported
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIG) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > bytes.length) continue;
    entries.push({ path: normalizePath(name), bytes: bytes.slice(dataStart, dataStart + compSize) });
  }
  return entries;
}

function findEocd(bytes, view) {
  // Scan backward for the EOCD signature (no zip comment in our writer, but be
  // tolerant of one up to the 16-bit comment-length max).
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// --- CRC32 -------------------------------------------------------------------

const CRC_TABLE = buildCrcTable();

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
