/**
 * LocalStorage — the default provider. There is no separate persistent
 * backing store: the local filesystem IS the store, and every read/write the
 * app already does via fs is the whole story. This class exists so callers
 * can treat "no remote persistence configured" the same shape as a remote
 * provider — `isRemote` is false, so persistence hooks become no-ops and the
 * app behaves exactly as it did before R2 support existed.
 */
export class LocalStorage {
  constructor() {
    this.provider = 'local';
    this.isRemote = false;
  }

  async putBytes() { return { ok: true, skipped: true }; }
  async getBytes() { return null; }
  async exists() { return false; }
  async list() { return []; }
  async putFile() { return { ok: true, skipped: true }; }
  async restoreFile() { return false; }

  // Nothing to reach — the local disk is always "available" from this layer's
  // point of view. checkStorageHealth() short-circuits on !isRemote anyway.
  async healthCheck() { return { ok: true }; }
}
