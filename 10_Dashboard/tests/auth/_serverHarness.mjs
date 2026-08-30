/**
 * Boots the real Express app (10_Dashboard/server.js) with the auth boundary
 * and the requests store mocked, so the authorization + ownership rules can
 * be exercised with zero Clerk network calls and zero disk fixtures.
 *
 * Identity in tests: send header  x-test-user: <clerkUserId>  (omit = anon).
 */
import { mock } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const LIB = (f) => pathToFileURL(join(HERE, '..', '..', 'lib', f)).href;

// ── in-memory request fixtures ────────────────────────────────────────────
let REQUESTS = [];
export function setRequests(rs) { REQUESTS = JSON.parse(JSON.stringify(rs)); }
export function getRequests() { return REQUESTS; }

function withStatus(r) {
  return { ...r, status: r.status || (r.cancelled ? 'cancelled' : 'complete') };
}
const reportPath = (r) => `02_Benchmark_Repository/_Feature_Benchmarks/homepage/${r.id}.md`;

const requestsStoreMock = {
  STAGES: ['queued', 'preparing', 'running', 'completed', 'failed', 'feature_vision'],
  BENCHMARK_TYPES: ['Feature Benchmark', 'Complete Journey'],
  SCOPE_OPTIONS: ['UX/UI only', 'End-to-End Journey'],
  listRequests: () => REQUESTS.map(withStatus),
  getRequest: (_p, id) => REQUESTS.map(withStatus).find((r) => r.id === id) || null,
  listCurrentFeatureBenchmarks: () => REQUESTS
    .filter((r) => r.benchmark_type === 'Feature Benchmark' && !r.cancelled)
    .map((r) => ({
      request_id: r.id, created_by: r.created_by || null,
      company: (r.items[0] || {}).name || '—', companies: r.items.map((i) => i.name),
      feature: r.feature, scope: r.scope && r.scope.length ? r.scope : ['End-to-End Journey'],
      date: r.created_at, created_at: r.created_at, status: 'complete', stage: 'completed',
      items: r.items, has_report: true, report_path: reportPath(r),
    })),
  listFeatureBenchmarks: () => REQUESTS
    .filter((r) => r.benchmark_type === 'Feature Benchmark')
    .map((r) => ({ feature_slug: 'homepage', request_id: r.id, path: reportPath(r), request: withStatus(r) })),
  createRequest: (_p, payload) => {
    const r = {
      id: `req_new_${Math.random().toString(16).slice(2, 10)}`,
      created_at: new Date().toISOString(),
      created_by: payload.created_by || null,
      created_by_name: payload.created_by_name || null,
      created_by_email: payload.created_by_email || null,
      benchmark_type: payload.benchmark_type, feature: payload.feature,
      scope: payload.scope || [], notes: payload.notes || '', cancelled: false,
      items: (payload.competitors || []).map((c) => ({
        slug: c.slug || String(c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        name: c.name, url: c.url || null, stage: 'queued',
      })),
    };
    REQUESTS.push(r);
    return r;
  },
  setStage: (_p, id, slug, stage) => {
    const r = REQUESTS.find((x) => x.id === id);
    if (!r) throw new Error(`Request "${id}" not found`);
    const it = r.items.find((i) => i.slug === slug);
    if (!it) throw new Error(`Competitor "${slug}" not found`);
    it.stage = stage;
    return withStatus(r);
  },
  cancelRequest: (_p, id) => {
    const r = REQUESTS.find((x) => x.id === id);
    if (!r) throw new Error(`Request "${id}" not found`);
    r.cancelled = true; r.status = 'cancelled';
    return withStatus(r);
  },
};

// ── mocked auth seam — identity comes from a test header ──────────────────
export const startBenchmarkCalls = [];
function identityFromReq(req) {
  const uid = req.headers['x-test-user'];
  if (!uid) return null;
  return { userId: uid, name: `User ${uid}`, email: `${uid}@example.com` };
}
const authMock = {
  authMiddleware: () => (_req, _res, next) => next(),
  getIdentity: identityFromReq,
  requireUser: (req, res, next) => {
    const id = identityFromReq(req);
    if (!id) return res.status(401).json({ error: 'Sign in to continue.' });
    req.identity = id;
    next();
  },
  authStatus: () => ({ configured: true, publishableKey: 'pk_test_stub', devMode: false }),
  displaySnapshot: async (identity) => ({
    created_by: identity.userId,
    created_by_name: identity.name || null,
    created_by_email: identity.email || null,
  }),
  ownedBy: (record, userId) => !!record && !!userId && record.created_by === userId,
};

let _app = null;
export async function getApp() {
  if (_app) return _app;
  mock.module(LIB('auth.js'), { exports: authMock });
  mock.module(LIB('requestsStore.js'), { exports: requestsStoreMock });
  mock.module(LIB('benchmarkService.js'), {
    exports: { startBenchmark: (args) => { startBenchmarkCalls.push(args); }, getRunStatus: () => null },
  });
  const mod = await import('../../server.js');
  _app = mod.app;
  return _app;
}

/** start the app on an ephemeral port; returns { base, close } */
export async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function req(base, path, { method = 'GET', user, body } = {}) {
  const headers = {};
  if (user) headers['x-test-user'] = user;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
