/**
 * storage — the persistence seam.
 *
 * Render's filesystem is ephemeral (free tier) — `Benchmark_Requests.json`,
 * generated Feature Benchmark reports, and screenshots all vanish on
 * restart/redeploy. This module keeps the local filesystem as the active
 * working/cache directory (so no fs call site had to become async) and adds
 * Cloudflare R2 as the persistent source of truth for *generated runtime
 * artifacts only*.
 *
 *   STORAGE_PROVIDER=local  (default) — no remote store; behaviour unchanged
 *   STORAGE_PROVIDER=r2               — mirror generated artifacts to R2
 *
 * R2 config is env-only: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET. Secrets are never logged.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, sep, posix } from 'path';
import { fileURLToPath } from 'url';
import { logInfo, logWarn, logError } from '../../../shared/logger.mjs';
import { LocalStorage } from './LocalStorage.js';
import { R2Storage } from './R2Storage.js';
import { MemoryStorage } from './MemoryStorage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(join(__dirname, '..', '..', '.env')); } catch { /* env already set / no .env */ }

// ─── Object key builders — requestId is the primary run identifier ─────────
export const STATE_KEY = 'state/Benchmark_Requests.json';
const REPORT_PREFIX = 'feature-benchmarks/';
const SCREENSHOT_PREFIX = 'screenshots/';
const NAV_PREFIX = 'navigation/';

// _Feature_Benchmarks/<feature>/<file>.md  ->  feature-benchmarks/<feature>/<file>.md
const FEATURE_REPORT_RE = /(?:^|[\\/])02_Benchmark_Repository[\\/]_Feature_Benchmarks[\\/]([^\\/]+)[\\/]([^\\/]+\.md)$/;

/** Map a local report path (absolute or project-relative) to its R2 key, or null. */
export function keyForReportPath(p) {
  const m = String(p || '').match(FEATURE_REPORT_RE);
  if (!m) return null;
  return `${REPORT_PREFIX}${m[1]}/${m[2]}`;
}

/**
 * Validate + map the `path` value from GET /api/markdown to a report key.
 * Only Feature Benchmark report paths are allowed — this is NOT a generic
 * object reader. Rejects traversal, absolute paths, non-.md, wrong folder.
 */
export function keyForMarkdownRequestPath(relPath) {
  const p = String(relPath || '').replace(/\\/g, '/');
  if (p.includes('..') || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const m = p.match(/^02_Benchmark_Repository\/_Feature_Benchmarks\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+\.md)$/);
  return m ? `${REPORT_PREFIX}${m[1]}/${m[2]}` : null;
}

export function keyForScreenshot(requestId, filename) {
  return `${SCREENSHOT_PREFIX}${safeId(requestId)}/${safeName(filename)}`;
}
export function keyForNavArtifact(requestId, filename) {
  return `${NAV_PREFIX}${safeId(requestId)}/${safeName(filename)}`;
}

function safeId(id) {
  const s = String(id || '').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!s) throw new Error('storage: blank requestId');
  return s;
}
function safeName(name) {
  const base = posix.basename(String(name || '').replace(/\\/g, '/'));
  const s = base.replace(/[^A-Za-z0-9._-]/g, '_');
  if (!s || s === '.' || s === '..') throw new Error(`storage: unsafe filename "${name}"`);
  return s;
}

function contentTypeFor(key) {
  if (key.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  if (key.endsWith('.html')) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

// ─── Provider singleton (+ test override) ─────────────────────────────────
let _instance = null;
let _override = null;

function createFromEnv() {
  const provider = (process.env.STORAGE_PROVIDER || 'local').trim().toLowerCase();
  if (provider === 'local') return new LocalStorage();
  if (provider === 'memory') return new MemoryStorage();
  if (provider === 'r2') {
    return new R2Storage({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET,
    });
  }
  throw new Error(`Unknown STORAGE_PROVIDER "${provider}" — use "local" or "r2".`);
}

export function getStorage() {
  if (_override) return _override;
  if (!_instance) {
    _instance = createFromEnv();
    logInfo('storage provider initialised', { provider: _instance.provider, remote: _instance.isRemote });
  }
  return _instance;
}

/** test hooks only */
export function __setStorageForTests(instance) { _override = instance; _instance = null; }
export function __resetStorageForTests() { _override = null; _instance = null; }

// ─── Persistence helpers ─────────────────────────────────────────────────

function safeGetStorage() {
  try {
    return { s: getStorage(), err: null };
  } catch (err) {
    return { s: null, err };
  }
}

/**
 * Storage availability preflight — is the configured persistent store
 * actually reachable and usable right now?
 *
 * Uses ONE lightweight, non-destructive operation (the provider's
 * healthCheck(): a ListObjectsV2 capped at 1 key for R2). Never uploads,
 * never deletes, never throws.
 *
 *   local              -> { ok: true,  provider: 'local', skipped: true }
 *   r2/memory healthy   -> { ok: true,  provider }
 *   r2 misconfigured    -> { ok: false, provider: 'misconfigured', reason }
 *   r2 unreachable      -> { ok: false, provider: 'r2', reason }
 *
 * Callers (benchmarkService) use this to fail a new run BEFORE any
 * Browserbase / Discovery / Vision / Anthropic work when ok === false.
 */
export async function checkStorageHealth() {
  const { s, err } = safeGetStorage();
  if (err) return { ok: false, provider: 'misconfigured', reason: err.message };
  if (!s.isRemote) return { ok: true, provider: s.provider, skipped: true };
  try {
    const r = await s.healthCheck();
    if (r && r.ok) return { ok: true, provider: s.provider };
    return { ok: false, provider: s.provider, reason: (r && r.detail) || 'storage did not report healthy' };
  } catch (e) {
    return { ok: false, provider: s.provider, reason: e.message };
  }
}

/**
 * putFile that resolves the content-type and NEVER throws (returns a result
 * object). `{ ok, skipped?, key, error? }`. skipped:true for the local
 * provider; ok:false + error for a misconfigured/failed remote.
 */
export async function persistFile(key, localPath) {
  const { s, err } = safeGetStorage();
  if (err) return { ok: false, key, error: err.message };
  if (!s.isRemote) return { ok: true, skipped: true, key };
  try {
    await s.putFile(key, localPath, contentTypeFor(key));
    return { ok: true, key };
  } catch (e) {
    return { ok: false, key, error: e.message };
  }
}

export async function persistBytes(key, buf) {
  const { s, err } = safeGetStorage();
  if (err) return { ok: false, key, error: err.message };
  if (!s.isRemote) return { ok: true, skipped: true, key };
  try {
    await s.putBytes(key, buf, contentTypeFor(key));
    return { ok: true, key };
  } catch (e) {
    return { ok: false, key, error: e.message };
  }
}

// ─── Benchmark_Requests.json write-through (fire-and-forget, tracked) ─────
// writeRequests() in requestsStore.js is synchronous and has many call
// sites; making it async would ripple through server.js and the CLI hook.
// Instead each write kicks a tracked background upload, and the two moments
// that must be *sure* the state is safe (right after createRequest, and at
// benchmark completion) call flushStatePersistence() and act on the result.
let _statePending = Promise.resolve();
let _stateHealth = { attempted: false, ok: true, error: null, lastAt: null };

export function persistStateBytes(buf) {
  const { s, err } = safeGetStorage();
  if (err) {
    _stateHealth.attempted = true;
    _stateHealth.ok = false;
    _stateHealth.error = err.message;
    logError('storage: cannot persist Benchmark_Requests.json — provider misconfigured', { error: err.message });
    return;
  }
  if (!s.isRemote) return;
  _stateHealth.attempted = true;
  const run = () =>
    s.putBytes(STATE_KEY, buf, contentTypeFor(STATE_KEY))
      .then(() => { _stateHealth.ok = true; _stateHealth.error = null; _stateHealth.lastAt = new Date().toISOString(); })
      .catch((err) => {
        _stateHealth.ok = false;
        _stateHealth.error = err.message;
        logError('storage: Benchmark_Requests.json could NOT be persisted to R2', { error: err.message });
      });
  _statePending = _statePending.then(run, run);
}

/** await the in-flight state upload(s); returns the current health. */
export async function flushStatePersistence() {
  await _statePending.catch(() => {});
  return { ...(_stateHealth) };
}

// ─── Startup restore ─────────────────────────────────────────────────────
/**
 * Initialise storage and restore generated runtime state from R2 BEFORE the
 * server accepts requests.
 *
 *  1. Benchmark_Requests.json — R2 is the source of truth. If R2 holds a
 *     valid copy, restore it over the (stale) repository copy. If R2 has
 *     nothing yet, keep the local copy and seed R2 from it.
 *  2. Feature Benchmark reports — small text; eager-restore all of
 *     feature-benchmarks/** so listFeatureBenchmarks() / has_report /
 *     GET /api/markdown all just work with no further change.
 *
 * Screenshots / nav artifacts are large and only needed for audit — those
 * are restored lazily, on demand, by the evidence endpoint.
 */
export async function restoreRuntimeStateOnStartup(projectRoot) {
  const { s, err } = safeGetStorage();
  if (err) {
    logError('storage: startup restore skipped — provider misconfigured', { error: err.message });
    return { restored: false, provider: 'misconfigured', errors: [err.message] };
  }
  if (!s.isRemote) return { restored: false, provider: s.provider };

  const summary = { provider: s.provider, state: 'unchanged', reports_restored: 0, errors: [] };
  const statePath = join(projectRoot, 'Benchmark_Requests.json');

  // 1 — request state
  try {
    const remote = await s.getBytes(STATE_KEY);
    if (remote) {
      let valid = false;
      try {
        const parsed = JSON.parse(remote.toString('utf8'));
        valid = parsed && Array.isArray(parsed.requests);
      } catch { valid = false; }
      if (valid) {
        const { writeFileSync } = await import('fs');
        writeFileSync(statePath, remote.toString('utf8'), 'utf8');
        summary.state = 'restored_from_r2';
        logInfo('storage: restored Benchmark_Requests.json from R2', { bytes: remote.length });
      } else {
        summary.errors.push('R2 Benchmark_Requests.json was not valid JSON — kept local copy');
        logWarn('storage: R2 Benchmark_Requests.json invalid, keeping local copy');
      }
    } else if (existsSync(statePath)) {
      // seed R2 from whatever the repo shipped
      await s.putBytes(STATE_KEY, readFileSync(statePath), contentTypeFor(STATE_KEY));
      summary.state = 'seeded_r2_from_local';
      logInfo('storage: seeded R2 Benchmark_Requests.json from local copy');
    }
  } catch (err) {
    summary.errors.push(`state restore: ${err.message}`);
    logError('storage: Benchmark_Requests.json restore failed', { error: err.message });
  }

  // 2 — feature reports (eager)
  try {
    const keys = await s.list(REPORT_PREFIX);
    for (const key of keys) {
      const rel = key.slice(REPORT_PREFIX.length); // <feature>/<file>.md
      const dest = join(projectRoot, '02_Benchmark_Repository', '_Feature_Benchmarks', ...rel.split('/'));
      // don't clobber a locally-newer file if the repo shipped one
      const ok = await s.restoreFile(key, dest);
      if (ok) summary.reports_restored += 1;
    }
    if (summary.reports_restored) logInfo('storage: restored Feature Benchmark reports from R2', { count: summary.reports_restored });
  } catch (err) {
    summary.errors.push(`report restore: ${err.message}`);
    logError('storage: report restore failed', { error: err.message });
  }

  return summary;
}

/**
 * On-demand evidence read: try local, else restore from R2 to a local cache
 * path and return it. Returns { path } or null.
 */
export async function resolveEvidenceLocalPath({ requestId, filename, cacheDir }) {
  const key = keyForScreenshot(requestId, filename);
  const dest = join(cacheDir, safeId(requestId), safeName(filename));
  if (existsSync(dest)) return { path: dest, source: 'local-cache' };
  const s = getStorage();
  if (!s.isRemote) return null;
  const ok = await s.restoreFile(key, dest).catch(() => false);
  return ok ? { path: dest, source: 'r2' } : null;
}

// re-exported for the CLI hook / anything that wants the raw path→key map
export { sep };
