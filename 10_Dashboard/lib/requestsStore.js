/**
 * requestsStore — single source of truth for Benchmark_Requests.json.
 * Imported by server.js (API) and scripts/update_queue.js (CLI hook called
 * during a real benchmarking session), so both read/write through the same
 * logic and never drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomBytes } from 'crypto';
import { resolveOfficialUrl } from './companyUrls.js';
import { persistStateBytes } from './storage/index.js';

export const STAGES = [
  'queued',
  'preparing',
  'running',   // V1.6: the automated benchmarkService/ClaudeProvider pipeline is executing
  'opening_website',
  'capturing_screenshots',
  'analyzing_ux',
  'extracting_patterns',
  'updating_matrix',
  'generating_dashboard',
  'completed',
  'failed',              // V1.6: the automated pipeline finished with a non-zero exit, cause unclassified
  // Sprint 24 — Output Verification Layer: replaces the single generic
  // 'failed' with three distinguishable terminal states, so the Queue never
  // has to guess whether Navigation/Screenshot/Vision broke (runtime_failed),
  // the spawned reasoning agent itself failed (reasoning_failed), or the
  // agent exited cleanly but its actual deliverables were missing/invalid
  // (verification_failed) — see 13_Orchestrator/stages/outputVerificationStage.js.
  'runtime_failed',
  'reasoning_failed',
  'verification_failed',
  // Sprint 26 — Live Runtime Progress: the actual Runtime stage ids
  // (13_Orchestrator/stages/*Stage.js), set as item.stage WHILE that stage
  // is running — not new concepts, just the existing Runtime progress
  // events (BenchmarkOrchestrator's onProgress) persisted the same way
  // every other stage transition already is, via this same setStage(). See
  // benchmarkService.js's Sprint 26 addition.
  'navigation',
  'screenshot',
  'vision',
  'reasoning',
  'output_verification',
  // Feature Benchmark's own Runtime stage ids (13_Orchestrator/pipelines/
  // featurePipeline.js), same role as the five above — set as item.stage
  // while that stage is running. Previously absent here, so
  // benchmarkService.js's setStage(event.stage, ...) call for any of these
  // threw "Unknown stage", which is why Feature Benchmark's item.stage
  // never advanced past 'running' for the whole run.
  'feature_discovery',
  'journey_mapper',
  'navigation_runner',
  'feature_vision',
  'feature_reasoning',
  'feature_report_writer',
  // "Capture manually": waiting for the analyst to navigate and press Capture
  // in the visible browser window (13_Orchestrator/stages/assistedCaptureStage.js).
  'assisted_capture',
];

export const BENCHMARK_TYPES = [
  'AI Experience',
  'UX/UI',
  'Mobile App',
  'Website',
  'Complete Journey',
  'Feature Benchmark',
];

export const SCOPE_OPTIONS = [
  'AI only',
  'UX/UI only',
  'Mobile',
  'Web',
  'End-to-End Journey',
  'Visual Design',
  'Interaction Design',
];

const REQUESTS_FILE = 'Benchmark_Requests.json';
const MATRIX_FILE = 'Master_Benchmark_Matrix.json';

function slugify(name) {
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function requestsPath(projectRoot) {
  return join(projectRoot, REQUESTS_FILE);
}

function matrixPath(projectRoot) {
  return join(projectRoot, MATRIX_FILE);
}

function readRequests(projectRoot) {
  const full = requestsPath(projectRoot);
  if (!existsSync(full)) {
    return { _meta: { schema_version: '1.0', last_updated: null }, requests: [] };
  }
  return JSON.parse(readFileSync(full, 'utf8'));
}

function writeRequests(projectRoot, data) {
  data._meta = data._meta || {};
  data._meta.last_updated = new Date().toISOString();
  const json = JSON.stringify(data, null, 2) + '\n';
  writeFileSync(requestsPath(projectRoot), json, 'utf8');   // local working copy — always
  persistStateBytes(Buffer.from(json, 'utf8'));             // -> R2 (tracked; no-op when STORAGE_PROVIDER=local)
}

// Item-level terminal-failure stages — the same vocabulary the dashboard
// itself groups "Needs attention" by (10_Dashboard/public/app.js's own
// FAILURE_STAGES); kept as a separate copy here since this module has no
// shared-constants path into public/app.js.
const FAILURE_STAGES = new Set(['failed', 'runtime_failed', 'reasoning_failed', 'verification_failed']);

export function computeBatchStatus(request) {
  if (request.cancelled) return 'cancelled';
  const items = request.items;
  if (items.length > 0 && items.every(i => i.stage === 'completed')) return 'complete';
  // All remaining work reached a terminal state (completed or a failure
  // stage) and at least one item did not succeed — the batch is DONE, not
  // still running. Previously a request whose only/last item permanently
  // failed stayed status:"in_progress" forever (no terminal failed branch
  // existed), even though nothing was running and nothing would retry it.
  if (items.length > 0 && items.every(i => i.stage === 'completed' || FAILURE_STAGES.has(i.stage))) return 'failed';
  if (items.some(i => i.stage !== 'queued')) return 'in_progress';
  return 'queued';
}

// Collision-resistant request id. The previous `req_<date>_<count>` scheme
// depended on Benchmark_Requests.json's current contents for the count — and
// that file can revert or disappear on a Render restart/redeploy, so two
// different runs could be assigned the same id and one report file could
// overwrite another's. This scheme depends on nothing but the clock and a
// CSPRNG: `req_<epoch-ms>_<8 hex>`. Still chronologically sortable, and old
// `req_YYYYMMDD_NNN` ids remain valid strings that every lookup (exact
// `r.id` match, `${requestId}.md` filename) keeps handling unchanged.
function nextRequestId() {
  return `req_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

function buildTriggerPrompt({ name, feature, scope }) {
  const scopeText = (scope || []).length ? scope.join(', ') : 'End-to-End Journey';
  return `Benchmark ${name} — focus: ${feature}, scope: ${scopeText}`;
}

/**
 * Appends a "pending" stub row to Master_Benchmark_Matrix.json's benchmark_plan
 * for a brand-new competitor, reusing the exact shape existing rows already
 * have so today's card rendering (isPending on status === 'pending') keeps
 * working unmodified.
 */
function seedMatrixStub(projectRoot, { slug, name, category }) {
  const full = matrixPath(projectRoot);
  if (!existsSync(full)) return;
  const matrix = JSON.parse(readFileSync(full, 'utf8'));
  const already = matrix.benchmark_plan.find(p => p.slug === slug);
  if (already) return;

  const maxRank = matrix.benchmark_plan.reduce((m, p) => Math.max(m, p.rank || 0), 0);
  matrix.benchmark_plan.push({
    rank: maxRank + 1,
    slug,
    name,
    category: category || 'AI-first',
    status: 'pending',
    date: null,
    overall_score: null,
  });
  matrix._meta = matrix._meta || {};
  matrix._meta.total_benchmarks_planned = matrix.benchmark_plan.length;
  writeFileSync(full, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
}

function existingSlugs(projectRoot) {
  const full = matrixPath(projectRoot);
  if (!existsSync(full)) return new Set();
  const matrix = JSON.parse(readFileSync(full, 'utf8'));
  return new Set(matrix.benchmark_plan.map(p => p.slug));
}

export function listRequests(projectRoot) {
  const data = readRequests(projectRoot);
  return data.requests.map(r => ({ ...r, status: computeBatchStatus(r) }));
}

export function getRequest(projectRoot, requestId) {
  return listRequests(projectRoot).find(r => r.id === requestId) || null;
}

/**
 * payload: {
 *   benchmark_type, feature, scope: string[], notes,
 *   competitors: [{ name, slug?, url?, is_new_company? }]
 * }
 */
export function createRequest(projectRoot, payload) {
  const data = readRequests(projectRoot);
  const known = existingSlugs(projectRoot);

  const isFullPipeline = payload.benchmark_type !== 'Feature Benchmark';

  const items = (payload.competitors || []).map(c => {
    const slug = c.slug || slugify(c.name);
    const isNew = !known.has(slug);
    if (isNew && isFullPipeline) {
      seedMatrixStub(projectRoot, { slug, name: c.name, category: c.category });
    }
    // URL resolution: prefer the URL supplied with the request; otherwise
    // fall back ONLY to the hand-curated companyUrls.js table (keyed by a
    // normalised slug — an explicit identity match, not "reuse whatever URL
    // some earlier run had"). Still null if the company is unknown and no
    // URL was given — a Feature Benchmark then fails before any browser work
    // (createBenchmarkTarget / benchmarkService), which is the intended
    // behaviour, not a silent guess.
    const url = (typeof c.url === 'string' && c.url.trim())
      ? c.url.trim()
      : (resolveOfficialUrl(c.name) || null);
    return {
      slug,
      name: c.name,
      url,
      url_source: (typeof c.url === 'string' && c.url.trim()) ? 'request'
        : (url ? 'resolved:companyUrls' : 'unresolved'),
      is_new_company: isNew,
      stage: 'queued',
      updated_at: new Date().toISOString(),
      trigger_prompt: buildTriggerPrompt({ name: c.name, feature: payload.feature, scope: payload.scope }),
    };
  });

  const request = {
    id: nextRequestId(),
    created_at: new Date().toISOString(),
    // Ownership: `created_by` is the authorization identity (a Clerk userId),
    // set server-side from the authenticated session — never from the browser
    // payload. `created_by_name` / `created_by_email` are display-only
    // snapshots and are never used for access decisions.
    created_by: payload.created_by || null,
    created_by_name: payload.created_by_name || null,
    created_by_email: payload.created_by_email || null,
    benchmark_type: payload.benchmark_type,
    feature: payload.feature,
    scope: payload.scope || [],
    notes: payload.notes || '',
    cancelled: false,
    status: 'queued',
    feature_benchmark_path: isFullPipeline
      ? null
      : `02_Benchmark_Repository/_Feature_Benchmarks/${slugify(payload.feature)}`,
    items,
  };

  data.requests.push(request);
  writeRequests(projectRoot, data);
  return request;
}

/**
 * setStage — unchanged 4-arg contract for every existing caller (the Queue's
 * manual dropdown, cancelRequest, etc.). V1.6 adds an optional 5th `meta`
 * argument so benchmarkService can record execution metadata in the same
 * read-modify-write as the stage change itself, rather than a second,
 * separately-racing disk write.
 *
 * @param {object} [meta]
 * @param {string} [meta.started_at]
 * @param {string} [meta.completed_at]
 * @param {'success'|'failed'} [meta.execution_status]
 * @param {string} [meta.execution_message]
 * @param {string} [meta.failed_stage] Sprint 26: the raw Runtime stage id
 *   ('navigation'|'screenshot'|'vision'|'reasoning'|'output_verification')
 *   the pipeline had reached when it failed — set alongside a
 *   runtime_failed/reasoning_failed/verification_failed stage transition so
 *   the Queue can show "stopped at: X" even after item.stage itself moves
 *   on to the terminal failure state. Left as-is (not cleared) on any other
 *   transition, matching how execution_message/execution_status already
 *   behave — only ever meaningful next to a failure stage.
 */
// ─── Interrupted runs ──────────────────────────────────────────────────────
// A pipeline lives only inside the Node process that started it; its
// progress is written here as item.stage. When that process dies (restart,
// deploy, out-of-memory kill) nothing ever moves those items to a terminal
// stage, so they showed "in progress" forever. Live finding: on Render's free
// plan a five-airline run left four items at navigation_runner after the
// server was killed while Chromium loaded a heavy homepage.
export const INTERRUPTED_MESSAGE =
  'This benchmark was interrupted because the server restarted while it was running (often because it ran out of memory). ' +
  'Nothing from this run was saved. Run it again.';

/**
 * Mark every item that is mid-run but NOT running in this process as failed,
 * with a truthful reason. Called once at startup, after state is restored,
 * before requests are accepted. Leaves 'queued' (never started), completed,
 * failure and cancelled items untouched, and clears the interrupted item's
 * run lock so it can be retried immediately.
 * @returns {{ requestId: string, slug: string, interruptedStage: string }[]}
 */
export function markInterruptedRuns(projectRoot, { isActive = () => false, now = Date.now(), graceMs = 0 } = {}) {
  const data = readRequests(projectRoot);
  const marked = [];
  const at = new Date(now).toISOString();
  for (const request of data.requests || []) {
    if (request.cancelled) continue;
    for (const item of request.items || []) {
      const stage = item.stage;
      if (!stage || stage === 'queued' || stage === 'completed' || FAILURE_STAGES.has(stage)) continue;
      if (isActive(request.id, item.slug)) continue;
      const last = Date.parse(item.updated_at || '') || 0;
      if (now - last < graceMs) continue;
      item.stage = 'failed';
      item.updated_at = at;
      item.completed_at = at;
      item.execution_status = 'failed';
      item.failed_stage = stage;
      item.execution_message = INTERRUPTED_MESSAGE;
      item.user_facing_message = true;
      if (request._pipeline_locks) delete request._pipeline_locks[item.slug];
      marked.push({ requestId: request.id, slug: item.slug, interruptedStage: stage });
    }
    if (marked.some((m) => m.requestId === request.id)) {
      if (request._pipeline_lock && !request.items.some((i) => i.stage !== 'queued' && i.stage !== 'completed' && !FAILURE_STAGES.has(i.stage))) {
        delete request._pipeline_lock;
      }
      request.status = computeBatchStatus(request);
    }
  }
  if (marked.length) writeRequests(projectRoot, data);
  return marked;
}

export function setStage(projectRoot, requestId, slug, stage, meta = {}) {
  if (!STAGES.includes(stage)) {
    throw new Error(`Unknown stage "${stage}". Valid stages: ${STAGES.join(', ')}`);
  }
  const data = readRequests(projectRoot);
  const request = data.requests.find(r => r.id === requestId);
  if (!request) throw new Error(`Request "${requestId}" not found`);
  const item = request.items.find(i => i.slug === slug);
  if (!item) throw new Error(`Competitor "${slug}" not found in request "${requestId}"`);

  item.stage = stage;
  item.updated_at = new Date().toISOString();
  if (meta.started_at !== undefined) item.started_at = meta.started_at;
  if (meta.completed_at !== undefined) item.completed_at = meta.completed_at;
  if (meta.execution_status !== undefined) item.execution_status = meta.execution_status;
  if (meta.execution_message !== undefined) item.execution_message = meta.execution_message;
  if (meta.failed_stage !== undefined) item.failed_stage = meta.failed_stage;
  // 'auto' | 'assisted' — how the page is reached ("Capture manually" = assisted).
  if (meta.capture_mode !== undefined) item.capture_mode = meta.capture_mode;
  // true when execution_message was written FOR the user (plain language, no
  // stack, no provider internals) and may therefore be shown in the UI.
  if (meta.user_facing_message !== undefined) item.user_facing_message = !!meta.user_facing_message;
  request.status = computeBatchStatus(request);

  writeRequests(projectRoot, data);
  return request;
}

export function cancelRequest(projectRoot, requestId) {
  const data = readRequests(projectRoot);
  const request = data.requests.find(r => r.id === requestId);
  if (!request) throw new Error(`Request "${requestId}" not found`);

  request.cancelled = true;
  request.status = 'cancelled';
  delete request._pipeline_lock;   // a cancel frees any run lock
  delete request._pipeline_locks;

  writeRequests(projectRoot, data);
  return request;
}

// ─── Duplicate-run protection ─────────────────────────────────────────────
// A persisted, request-scoped advisory lock so the SAME requestId can never
// have two full pipelines (discovery -> Browserbase -> Vision -> ...) running
// at once — a same-tick double-PATCH, a poll, or a second server instance all
// hit the same JSON file. It is NOT a queue. It self-expires so a crashed /
// killed run can be retried without manual cleanup. A benchmark takes minutes;
// the window is generous.
export const PIPELINE_LOCK_STALE_MS = 20 * 60 * 1000;

// Scope: one lock PER COMPANY in a request (`_pipeline_locks[slug]`), plus
// the legacy request-wide lock (`_pipeline_lock`) which still blocks every
// company. Previously the only lock was request-wide, so a benchmark of
// Saudia vs Emirates vs Qatar ran ONE company: the wizard starts every
// company at once, the first took the lock, and the others were silently
// dropped and sat at "Starting benchmark" forever. Concurrent browser
// sessions are capped separately (launchBrowser's slot limit).

function lockIsFresh(lock) {
  return !!(lock && lock.at && (Date.now() - new Date(lock.at).getTime()) < PIPELINE_LOCK_STALE_MS);
}

/** `${requestId}:${slug}` holders map to that company's lock; anything else is request-wide. */
function lockSlug(requestId, holder, slug) {
  if (slug) return slug;
  const prefix = `${requestId}:`;
  if (typeof holder === 'string' && holder.startsWith(prefix) && holder.length > prefix.length) return holder.slice(prefix.length);
  return null;
}

/**
 * Current lock state without mutating anything. With `slug`, answers "is
 * THIS company already running?"; without it, "is anything in this request
 * running?".
 */
export function pipelineLockStatus(projectRoot, requestId, slug) {
  const request = readRequests(projectRoot).requests.find(r => r.id === requestId);
  if (!request) return { locked: false };
  const candidates = [request._pipeline_lock];
  const itemLocks = request._pipeline_locks || {};
  if (slug) candidates.push(itemLocks[slug]);
  else candidates.push(...Object.values(itemLocks));
  const fresh = candidates.find(lockIsFresh);
  if (fresh) {
    return { locked: true, holder: fresh.holder || null, since: fresh.at, ageMs: Date.now() - new Date(fresh.at).getTime() };
  }
  const stale = candidates.find(l => l && l.at);
  return stale ? { locked: false, stale: true, holder: stale.holder || null, since: stale.at } : { locked: false };
}

/**
 * Atomically (read-modify-write on one JSON file, single-threaded) claim the
 * pipeline lock — for one company when `holder` is `${requestId}:${slug}`
 * (or `slug` is given), otherwise request-wide. Returns { ok:true } or
 * { ok:false, reason, holder?, since? }.
 */
export function tryAcquirePipelineLock(projectRoot, requestId, holder, slug) {
  const data = readRequests(projectRoot);
  const request = data.requests.find(r => r.id === requestId);
  if (!request) return { ok: false, reason: 'request-not-found' };
  const key = lockSlug(requestId, holder, slug);
  const wide = request._pipeline_lock;
  const itemLocks = request._pipeline_locks || {};

  const blocking = [wide, ...(key ? [itemLocks[key]] : Object.values(itemLocks))].find(lockIsFresh);
  if (blocking) {
    // Re-entrant: the same holder re-acquiring its own lock is a no-op success.
    if (holder && blocking.holder === holder) return { ok: true, reentrant: true };
    return { ok: false, reason: 'in-progress', holder: blocking.holder || null, since: blocking.at };
  }
  const lock = { holder: holder || null, at: new Date().toISOString() };
  if (key) {
    request._pipeline_locks = { ...itemLocks, [key]: lock };
    if (wide && !lockIsFresh(wide)) delete request._pipeline_lock;
  } else {
    request._pipeline_lock = lock;
  }
  writeRequests(projectRoot, data);
  return { ok: true };
}

/** Release the lock — only the holder that took it may release it. */
export function releasePipelineLock(projectRoot, requestId, holder, slug) {
  const data = readRequests(projectRoot);
  const request = data.requests.find(r => r.id === requestId);
  if (!request) return;
  const key = lockSlug(requestId, holder, slug);
  if (key) {
    const lock = request._pipeline_locks && request._pipeline_locks[key];
    if (!lock) return;
    if (holder && lock.holder && lock.holder !== holder) return;
    delete request._pipeline_locks[key];
    if (Object.keys(request._pipeline_locks).length === 0) delete request._pipeline_locks;
  } else {
    if (!request._pipeline_lock) return;
    if (holder && request._pipeline_lock.holder && request._pipeline_lock.holder !== holder) return;
    delete request._pipeline_lock;
  }
  writeRequests(projectRoot, data);
}

// ─── Current vs. legacy classification ─────────────────────────────────────
// The customer-facing product (Home, Benchmarks) shows ONLY current automated
// Feature Benchmark runs. "Current" is decided by the data model, never by
// company name:
//   1. benchmark_type === 'Feature Benchmark'  (the only automated model)
//   2. not cancelled
//   3. not a pipeline dev/verification artifact (see DEV_ARTIFACT_RE)
// Everything else — Complete Journey / UX-UI / AI Experience requests, the
// legacy Master Matrix research, Homepage Benchmark experiments, cancelled or
// throwaway runs — is legacy and belongs in Archive only.
export const DEV_ARTIFACT_RE =
  /\b(sprint\s*\d+|verification|throwaway|debug|evidence test|smoke test|safe to (interrupt|cancel|ignore))\b/i;

export function isCurrentFeatureBenchmark(request) {
  if (!request || request.benchmark_type !== 'Feature Benchmark') return false;
  if (request.cancelled) return false;
  if (DEV_ARTIFACT_RE.test(`${request.feature || ''} ${request.notes || ''}`)) return false;
  return true;
}

/**
 * The single data source for the customer-facing Home and Benchmarks views.
 * Returns one normalized record per current Feature Benchmark request:
 *   { request_id, company, companies[], feature, scope[], date,
 *     created_at, status, stage, has_report, report_path }
 */
export function listCurrentFeatureBenchmarks(projectRoot) {
  return listRequests(projectRoot)
    .filter(isCurrentFeatureBenchmark)
    .map(r => {
      const items = r.items || [];
      const reportRel = `02_Benchmark_Repository/_Feature_Benchmarks/${slugify(r.feature)}/${r.id}.md`;
      const hasReport = existsSync(join(projectRoot, reportRel));
      const completedAt = items.map(i => i.completed_at).filter(Boolean).sort().pop() || null;
      return {
        request_id: r.id,
        created_by: r.created_by || null,
        company: items.map(i => i.name).join(', ') || '—',
        companies: items.map(i => i.name),
        feature: r.feature,
        scope: (r.scope && r.scope.length) ? r.scope : ['End-to-End Journey'],
        date: completedAt || r.created_at,
        created_at: r.created_at,
        status: r.status,                 // queued | in_progress | complete
        stage: items[0]?.stage || 'queued',
        items: items.map(i => ({
          name: i.name, slug: i.slug, stage: i.stage, url: i.url || null,
          is_new_company: !!i.is_new_company,
          started_at: i.started_at || null, completed_at: i.completed_at || null,
          updated_at: i.updated_at || null,
          execution_status: i.execution_status || null,
          execution_message: i.execution_message || null,
          user_facing_message: !!i.user_facing_message,
          failed_stage: i.failed_stage || null,
          capture_mode: i.capture_mode || 'auto',
        })),
        has_report: hasReport,
        report_path: hasReport ? reportRel : null,
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function listFeatureBenchmarks(projectRoot) {
  const root = join(projectRoot, '02_Benchmark_Repository', '_Feature_Benchmarks');
  if (!existsSync(root)) return [];
  const requests = listRequests(projectRoot).filter(r => r.benchmark_type === 'Feature Benchmark');

  const featureDirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  const results = [];
  for (const dir of featureDirs) {
    const dirPath = join(root, dir.name);
    const files = readdirSync(dirPath).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const requestId = file.replace('.md', '');
      const request = requests.find(r => r.id === requestId);
      results.push({
        feature_slug: dir.name,
        request_id: requestId,
        path: `02_Benchmark_Repository/_Feature_Benchmarks/${dir.name}/${file}`,
        request: request || null,
      });
    }
  }
  return results;
}
