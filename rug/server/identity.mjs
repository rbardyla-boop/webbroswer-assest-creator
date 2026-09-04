import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');

export class IdentityStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.records = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  }

  persist() {
    fs.writeFileSync(this.file, `${JSON.stringify(this.records, null, 2)}\n`, { mode: 0o600 });
  }

  issue(actorId) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.records[actorId] = { token_hash: hash(token), issued_at: new Date().toISOString() };
    this.persist();
    return token;
  }

  revoke(actorId) {
    delete this.records[actorId];
    this.persist();
  }

  authenticate(actorId, token) {
    const record = this.records[actorId];
    if (!record || !token) return false;
    const a = Buffer.from(record.token_hash, 'hex');
    const b = Buffer.from(hash(token), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
