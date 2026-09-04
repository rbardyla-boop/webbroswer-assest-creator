import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class ArtifactStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  digest(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
  }

  put(bytes) {
    const digest = this.digest(bytes);
    const file = path.join(this.directory, digest);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, { mode: 0o600 });
    return { digest, size: bytes.length, file };
  }

  has(digest) {
    return /^[a-f0-9]{64}$/.test(digest) && fs.existsSync(path.join(this.directory, digest));
  }

  read(digest) {
    if (!this.has(digest)) return null;
    return fs.readFileSync(path.join(this.directory, digest));
  }
}

export async function readBinary(req, maxBytes = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error(`Artifact exceeds ${maxBytes} byte limit`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
