/**
 * R2Storage — Cloudflare R2 via its S3-compatible API, signed with
 * `aws4fetch` (AwsClient: a zero-dependency SigV4 wrapper around fetch).
 *
 * The bucket is private. Nothing here logs a secret — the constructor takes
 * the credentials, uses them only to sign requests, and never prints them.
 * Callers reach objects only through the application's own endpoints; this
 * class is never exposed to the frontend.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { AwsClient } from 'aws4fetch';

export class R2Storage {
  /**
   * @param {object} cfg
   * @param {string} cfg.accountId       R2_ACCOUNT_ID
   * @param {string} cfg.accessKeyId     R2_ACCESS_KEY_ID
   * @param {string} cfg.secretAccessKey R2_SECRET_ACCESS_KEY
   * @param {string} cfg.bucket          R2_BUCKET
   */
  constructor({ accountId, accessKeyId, secretAccessKey, bucket }) {
    const missing = ['accountId', 'accessKeyId', 'secretAccessKey', 'bucket']
      .filter((k) => !({ accountId, accessKeyId, secretAccessKey, bucket })[k]);
    if (missing.length) {
      throw new Error(`R2 storage is misconfigured — missing: ${missing.join(', ')} (set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).`);
    }
    this.provider = 'r2';
    this.isRemote = true;
    this._bucket = bucket;
    this._endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
    this._client = new AwsClient({ accessKeyId, secretAccessKey, region: 'auto', service: 's3' });
  }

  _url(key) {
    // key is already a clean, app-controlled path (see storage/index.js key
    // builders) — encode each segment so spaces/unicode are safe, never
    // collapse `..`.
    const safe = String(key).split('/').map(encodeURIComponent).join('/');
    return `${this._endpoint}/${this._bucket}/${safe}`;
  }

  async putBytes(key, buf, contentType = 'application/octet-stream') {
    const res = await this._client.fetch(this._url(key), {
      method: 'PUT',
      body: Buffer.from(buf),
      headers: { 'content-type': contentType },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`R2 PUT ${key} failed: ${res.status} ${res.statusText} ${detail.slice(0, 200)}`);
    }
    return { ok: true, key };
  }

  async getBytes(key) {
    const res = await this._client.fetch(this._url(key));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`R2 GET ${key} failed: ${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async exists(key) {
    const res = await this._client.fetch(this._url(key), { method: 'HEAD' });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`R2 HEAD ${key} failed: ${res.status} ${res.statusText}`);
    return true;
  }

  async list(prefix) {
    // S3 ListObjectsV2 — paginated.
    const keys = [];
    let token;
    do {
      const u = new URL(`${this._endpoint}/${this._bucket}`);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      if (token) u.searchParams.set('continuation-token', token);
      const res = await this._client.fetch(u.toString());
      if (!res.ok) throw new Error(`R2 LIST ${prefix} failed: ${res.status} ${res.statusText}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(decodeXml(m[1]));
      const trunc = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = trunc ? (xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] : undefined;
    } while (token);
    return keys;
  }

  async putFile(key, localPath, contentType) {
    const buf = await readFile(localPath);
    return this.putBytes(key, buf, contentType);
  }

  async restoreFile(key, localPath) {
    const buf = await this.getBytes(key);
    if (buf == null) return false;
    await mkdir(dirname(localPath), { recursive: true });
    await writeFile(localPath, buf);
    return true;
  }
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
