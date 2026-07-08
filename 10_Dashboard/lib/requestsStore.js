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
  'opening_website',
  'capturing_screenshots',
  'analyzing_ux',
  'extracting_patterns',
  'updating_matrix',
  'generating_dashboard',
  'completed',
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

export function setStage(projectRoot, requestId, slug, stage) {
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
