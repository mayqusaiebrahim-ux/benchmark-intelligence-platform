/**
 * MemoryStorage — an in-process object store. Used by the persistence
 * regression tests so they never need real Cloudflare credentials. Same
 * async interface as R2Storage.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

export class MemoryStorage {
  constructor({ failWrites = false } = {}) {
    this.provider = 'memory';
    this.isRemote = true;
    this._objects = new Map(); // key -> Buffer
    this.failWrites = failWrites;
  }

  async putBytes(key, buf) {
    if (this.failWrites) throw new Error('simulated object-storage write failure');
    this._objects.set(key, Buffer.from(buf));
    return { ok: true, key };
  }

  async getBytes(key) {
    return this._objects.has(key) ? Buffer.from(this._objects.get(key)) : null;
  }

  async exists(key) {
    return this._objects.has(key);
  }

  async list(prefix) {
    return [...this._objects.keys()].filter((k) => k.startsWith(prefix));
  }

  async putFile(key, localPath) {
    const buf = await readFile(localPath);
    return this.putBytes(key, buf);
  }

  async restoreFile(key, localPath) {
    const buf = await this.getBytes(key);
    if (buf == null) return false;
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buf);
    return true;
  }
}
