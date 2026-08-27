/**
 * requestsStore — single source of truth for Benchmark_Requests.json.
 * Imported by server.js (API) and scripts/update_queue.js (CLI hook called
 * during a real benchmarking session), so both read/write through the same
 * logic and never drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

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
  writeFileSync(requestsPath(projectRoot), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function computeBatchStatus(request) {
  if (request.cancelled) return 'cancelled';
  const items = request.items;
  if (items.length > 0 && items.every(i => i.stage === 'completed')) return 'complete';
  if (items.some(i => i.stage !== 'queued')) return 'in_progress';
  return 'queued';
}

function nextRequestId(data) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const todaysCount = data.requests.filter(r => r.id.startsWith(`req_${today}_`)).length;
  const seq = String(todaysCount + 1).padStart(3, '0');
  return `req_${today}_${seq}`;
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
    return {
      slug,
      name: c.name,
      url: c.url || null,
      is_new_company: isNew,
      stage: 'queued',
      updated_at: new Date().toISOString(),
      trigger_prompt: buildTriggerPrompt({ name: c.name, feature: payload.feature, scope: payload.scope }),
    };
  });

  const request = {
    id: nextRequestId(data),
    created_at: new Date().toISOString(),
    created_by: payload.created_by || null,
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

  writeRequests(projectRoot, data);
  return request;
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
          failed_stage: i.failed_stage || null,
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
