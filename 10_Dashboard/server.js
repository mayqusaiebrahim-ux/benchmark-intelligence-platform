/**
 * AI Travel Benchmark Dashboard — Server
 * Reads all project data from the existing file structure on every request.
 * Adding a new benchmark automatically reflects in the dashboard on next load.
 * Run: node server.js
 */

import express from 'express';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  listRequests, createRequest, setStage, cancelRequest, listFeatureBenchmarks,
  listCurrentFeatureBenchmarks,
  STAGES, BENCHMARK_TYPES, SCOPE_OPTIONS,
} from './lib/requestsStore.js';
// Sprint V1.5: startBenchmark now comes from the Dashboard's own Benchmark
// Service (Dashboard -> Benchmark Service -> Agent Provider -> Claude
// Provider), not the Engine. 11_Benchmark_Engine/orchestrator/index.js's
// startBenchmark() stub is intentionally left untouched and unused — the
// Engine itself is not modified by this sprint.
import { startBenchmark } from './lib/benchmarkService.js';
import { BenchmarkScheduler } from '../11_Benchmark_Engine/scheduler/BenchmarkScheduler.js';
import { EVENTS } from '../11_Benchmark_Engine/scheduler/progressEvents.js';
import { logInfo, logError } from '../shared/logger.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..');   // AI_Travel_Benchmark_2026/ folder
const PORT = process.env.PORT || 3000;

// ─── Process-level diagnostics (instrumentation only) ───────────────────────
// Registered as early as possible, before the Express app is built, so
// nothing that happens later in this file's setup can occur unobserved.
// Both handlers log with the full stack, then exit — preserving Node's
// existing default behavior (crash on an uncaught exception / unhandled
// rejection). Registering a handler at all suppresses that default unless
// it's restored explicitly, so simply logging here without exiting would
// be a real behavior change, not just instrumentation.
process.on('uncaughtException', (err) => {
  logError('uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  process.exit(1);
});
process.on('SIGTERM', () => {
  logInfo('Received SIGTERM');
});
process.on('SIGINT', () => {
  logInfo('Received SIGINT');
});
process.on('beforeExit', (code) => {
  logInfo('beforeExit', { code });
});
process.on('exit', (code) => {
  logInfo('exit', { code });
});

// ─── Homepage Benchmark Beta: airlines the "Select airlines" step offers ────
// Dashboard-layer data only — the engine (Discovery/Vision/Reports/Scheduler/
// Anti-Bot) is untouched; this just tells the UI what it's allowed to queue.
const HOMEPAGE_BENCHMARK_AIRLINES = [
  { slug: 'emirates', name: 'Emirates', url: 'https://www.emirates.com/' },
  { slug: 'qatar_airways', name: 'Qatar Airways', url: 'https://www.qatarairways.com/' },
  { slug: 'etihad_airways', name: 'Etihad Airways', url: 'https://www.etihad.com/en-ae/' },
  { slug: 'turkish_airlines', name: 'Turkish Airlines', url: 'https://www.turkishairlines.com/en-int/' },
  { slug: 'singapore_airlines', name: 'Singapore Airlines', url: 'https://www.singaporeair.com/' },
  { slug: 'lufthansa', name: 'Lufthansa', url: 'https://www.lufthansa.com/' },
  { slug: 'air_france', name: 'Air France', url: 'https://wwws.airfrance.us/' },
  { slug: 'klm', name: 'KLM', url: 'https://www.klm.com/' },
  { slug: 'delta_air_lines', name: 'Delta Air Lines', url: 'https://www.delta.com/' },
  { slug: 'united_airlines', name: 'United Airlines', url: 'https://www.united.com/' },
  { slug: 'alaska_airlines', name: 'Alaska Airlines', url: 'https://www.alaskaair.com/' },
  { slug: 'airasia', name: 'AirAsia', url: 'https://www.airasia.com/' },
];
const HOMEPAGE_BENCHMARK_CONCURRENCY = 3; // fixed default — not a user-facing choice, per "everything else stays behind the scenes"

// In-memory only: the most recent (or currently running) parallel Homepage
// Benchmark batch. No persistence needed for the Beta — a server restart
// mid-run simply loses live progress; every job that already finished has
// already saved its own report.json/report.md to disk regardless.
let activeHomepageRun = null;

const app = express();
app.use(express.json());

// ─── Static files ──────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));
app.use('/screenshots', express.static(join(PROJECT, '03_Screenshots')));

// ─── Helpers ───────────────────────────────────────────────────────────────
function readJSON(relPath) {
  const full = join(PROJECT, relPath);
  if (!existsSync(full)) return null;
  try { return JSON.parse(readFileSync(full, 'utf8')); } catch { return null; }
}

function readMD(relPath) {
  const full = join(PROJECT, relPath);
  if (!existsSync(full)) return null;
  try { return readFileSync(full, 'utf8'); } catch { return null; }
}

function getMatrix() {
  return readJSON('Master_Benchmark_Matrix.json');
}

function getCompanyFolder(matrix, slug) {
  const co = matrix?.companies?.[slug];
  if (!co?.meta?.report_path) return null;
  const parts = co.meta.report_path.split('/');
  parts.pop();
  return parts.join('/');
}

function listDir(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true });
}

// ─── API: Matrix ────────────────────────────────────────────────────────────
app.get('/api/matrix', (req, res) => {
  const data = getMatrix();
  if (!data) return res.status(500).json({ error: 'Matrix not found' });
  res.json(data);
});

// ─── API: All benchmarks (overview cards) ───────────────────────────────────
app.get('/api/benchmarks', (req, res) => {
  const matrix = getMatrix();
  if (!matrix) return res.status(500).json({ error: 'Matrix not found' });

  const result = matrix.benchmark_plan.map(plan => {
    const co = matrix.companies[plan.slug];
    const folder = getCompanyFolder(matrix, plan.slug);
    const meta = folder ? readJSON(`${folder}/metadata.json`) : null;

    return {
      slug: plan.slug,
      name: plan.name,
      category: plan.category,
      status: plan.status,
      date: plan.date,
      overall_score: plan.overall_score,
      ai_maturity: co?.overview?.ai_maturity || null,
      business_model: co?.overview?.business_model || null,
      has_loyalty: co?.overview?.has_loyalty || false,
      native_booking: co?.overview?.native_booking || false,
      innovation_scores: co?.innovation_scores || null,
      standout_feature: meta?.standout_feature || null,
      patterns_extracted: meta?.patterns_extracted || 0,
      screenshots_count: meta?.screenshots_count || 0,
    };
  });

  res.json(result);
});

// ─── API: Single company ────────────────────────────────────────────────────
app.get('/api/company/:slug', (req, res) => {
  const { slug } = req.params;
  const matrix = getMatrix();
  if (!matrix) return res.status(500).json({ error: 'Matrix not found' });

  const co = matrix.companies[slug];
  if (!co) return res.status(404).json({ error: `Company "${slug}" not found` });

  const plan = matrix.benchmark_plan.find(p => p.slug === slug);
  const folder = getCompanyFolder(matrix, slug);
  const meta = folder ? readJSON(`${folder}/metadata.json`) : null;

  // List journey step files
  const journeyDir = folder ? join(PROJECT, folder, '02_user_journey') : null;
  const journeyFiles = journeyDir && existsSync(journeyDir)
    ? readdirSync(journeyDir).filter(f => f.endsWith('.md')).sort()
    : [];

  res.json({
    slug,
    plan,
    company_data: co,
    meta,
    folder,
    journey_files: journeyFiles,
    has_ux_analysis: folder ? existsSync(join(PROJECT, folder, '03_ux_analysis.md')) : false,
    has_emerging_patterns: folder ? existsSync(join(PROJECT, folder, '04_emerging_patterns.md')) : false,
    has_opportunities: folder ? existsSync(join(PROJECT, folder, '05_innovation_opportunities.md')) : false,
    saudia_brief_path: `07_Saudia_Opportunities/${plan?.name}_opportunities.md`,
    has_saudia_brief: existsSync(join(PROJECT, `07_Saudia_Opportunities/${plan?.name}_opportunities.md`)),
    has_figma: folder ? existsSync(join(PROJECT, `08_Figma/${plan?.name}/annotations.json`)) : false,
  });
});

// ─── API: Markdown content ──────────────────────────────────────────────────
app.get('/api/markdown', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });

  // Security: only allow paths inside the project
  const full = join(PROJECT, filePath);
  if (!full.startsWith(PROJECT)) return res.status(403).json({ error: 'Access denied' });

  const content = readMD(filePath);
  if (content === null) return res.status(404).json({ error: 'File not found' });
  res.json({ content, path: filePath });
});

// ─── API: Screenshots inventory ─────────────────────────────────────────────
app.get('/api/screenshots/:slug', (req, res) => {
  const { slug } = req.params;
  const matrix = getMatrix();
  if (!matrix) return res.json({});

  const co = matrix.companies[slug];
  if (!co) return res.json({});

  const companyName = co.meta?.name || slug;
  const screenshotsRoot = join(PROJECT, '03_Screenshots', companyName);

  if (!existsSync(screenshotsRoot)) return res.json({});

  const result = {};
  try {
    const stepDirs = listDir(screenshotsRoot)
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();

    for (const step of stepDirs) {
      const stepPath = join(screenshotsRoot, step);
      const files = readdirSync(stepPath)
        .filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'))
        .sort();
      if (files.length > 0) {
        result[step] = files.map(f => ({
          url: `/screenshots/${companyName}/${step}/${f}`,
          name: f,
          step,
        }));
      }
    }
  } catch (e) {
    console.error('Screenshots error:', e.message);
  }

  res.json(result);
});

// ─── API: Homepage Benchmarks (11_Benchmark_Engine MVP pipeline) ────────────
app.get('/api/homepage-benchmarks', (req, res) => {
  const root = join(PROJECT, '02_Benchmark_Repository', '_Homepage_Benchmarks');
  if (!existsSync(root)) return res.json({ items: [] });

  const items = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;

    const report = readJSON(`02_Benchmark_Repository/_Homepage_Benchmarks/${dir.name}/report.json`);
    if (!report) continue;

    const screenshotFile = report.screenshot_path ? report.screenshot_path.split(/[\\/]/).pop() : null;

    items.push({
      slug: dir.name,
      website_name: report.website_name,
      url: report.url,
      website_type: report.website_type,
      confidence: report.confidence,
      benchmark_timestamp: report.benchmark_timestamp,
      screenshot_url: screenshotFile ? `/screenshots/${screenshotFile}` : null,
      ai_ux_analysis: report.ai_ux_analysis || null,
      ai_ux_analysis_error: report.ai_ux_analysis_error || null,
      report_md_path: `02_Benchmark_Repository/_Homepage_Benchmarks/${dir.name}/report.md`,
    });
  }

  items.sort((a, b) => new Date(b.benchmark_timestamp || 0) - new Date(a.benchmark_timestamp || 0));
  res.json({ items });
});

// ─── API: Homepage Benchmark Beta — select airlines, start, watch progress ──
// "Select Homepage Benchmark -> Select airlines -> Click Start -> View
// results" with nothing manual in between. Wraps the existing, unmodified
// Sprint 13 BenchmarkScheduler directly — no new engine capability, just a
// Dashboard-layer trigger for something that already worked from the CLI.
app.get('/api/homepage-benchmarks/airlines', (req, res) => {
  const items = HOMEPAGE_BENCHMARK_AIRLINES.map((a) => {
    const report = readJSON(`02_Benchmark_Repository/_Homepage_Benchmarks/${a.slug}/report.json`);
    return {
      ...a,
      already_benchmarked: !!report,
      last_benchmarked_at: report?.benchmark_timestamp || null,
    };
  });
  res.json({ items, default_concurrency: HOMEPAGE_BENCHMARK_CONCURRENCY });
});

app.post('/api/homepage-benchmarks/run', (req, res) => {
  const slugs = Array.isArray(req.body?.slugs) ? req.body.slugs : [];
  if (slugs.length === 0) {
    return res.status(400).json({ error: 'Select at least one airline.' });
  }

  const bySlug = new Map(HOMEPAGE_BENCHMARK_AIRLINES.map((a) => [a.slug, a]));
  const unknown = slugs.filter((s) => !bySlug.has(s));
  if (unknown.length > 0) {
    return res.status(400).json({ error: `Unknown airline slug(s): ${unknown.join(', ')}` });
  }

  if (activeHomepageRun && !activeHomepageRun.complete) {
    return res.status(409).json({ error: 'A Homepage Benchmark run is already in progress.', runId: activeHomepageRun.runId });
  }

  const companies = slugs.map((slug) => {
    const a = bySlug.get(slug);
    return { companySlug: a.slug, companyName: a.name, url: a.url };
  });

  const scheduler = new BenchmarkScheduler({ companies, concurrency: HOMEPAGE_BENCHMARK_CONCURRENCY });

  activeHomepageRun = {
    runId: scheduler.runId,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    complete: false,
    concurrency: HOMEPAGE_BENCHMARK_CONCURRENCY,
    jobs: scheduler.getStatusSnapshot(),
  };

  const refreshJobs = () => { activeHomepageRun.jobs = scheduler.getStatusSnapshot(); };
  for (const evt of [EVENTS.QUEUED, EVENTS.STARTED, EVENTS.PROGRESS, EVENTS.RETRY, EVENTS.SUCCEEDED, EVENTS.FAILED]) {
    scheduler.on(evt, refreshJobs);
  }
  scheduler.on(EVENTS.BATCH_COMPLETE, () => {
    refreshJobs();
    activeHomepageRun.complete = true;
    activeHomepageRun.finishedAt = new Date().toISOString();
  });

  // Not awaited — the run continues after this response goes out. The
  // frontend polls GET /run/:runId for live status instead of holding the
  // HTTP request open for what can be several minutes.
  scheduler.run().catch((err) => {
    activeHomepageRun.complete = true;
    activeHomepageRun.finishedAt = new Date().toISOString();
    activeHomepageRun.error = err.message;
  });

  res.status(202).json({ runId: scheduler.runId });
});

// Lets the frontend reattach to an in-flight (or just-finished) run after a
// page reload/navigation without needing to already know its runId.
app.get('/api/homepage-benchmarks/run/current', (req, res) => {
  res.json(activeHomepageRun || { runId: null });
});

app.get('/api/homepage-benchmarks/run/:runId', (req, res) => {
  if (!activeHomepageRun || activeHomepageRun.runId !== req.params.runId) {
    return res.status(404).json({ error: 'No such run (or it predates this server session).' });
  }
  res.json(activeHomepageRun);
});

// ─── API: Patterns ──────────────────────────────────────────────────────────
app.get('/api/patterns', (req, res) => {
  const matrix = getMatrix();
  if (!matrix) return res.json({});

  const patternLib = readJSON('06_AI_Trends/pattern_library.json');
  const tracker = matrix.pattern_tracker || {};

  const nameMap = {};
  (matrix.benchmark_plan || []).forEach(p => { nameMap[p.slug] = p.name; });

  const patterns = Object.entries(tracker).map(([id, pat]) => ({
    id,
    ...pat,
    company_names: (pat.companies || []).map(s => nameMap[s] || s),
  }));

  res.json({ patterns, pattern_lib: patternLib });
});

// ─── API: Saudia opportunities ───────────────────────────────────────────────
app.get('/api/saudia', (req, res) => {
  const matrix = getMatrix();
  if (!matrix) return res.json({});

  const nameMap = {};
  (matrix.benchmark_plan || []).forEach(p => { nameMap[p.slug] = p.name; });

  // Gap analysis from matrix
  const gap = matrix.saudia_gap || {};

  // Collect all Saudia opportunity files
  const opportunitiesDir = join(PROJECT, '07_Saudia_Opportunities');
  const briefs = [];
  if (existsSync(opportunitiesDir)) {
    const files = readdirSync(opportunitiesDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = readMD(`07_Saudia_Opportunities/${file}`);
      if (content) briefs.push({ file, content });
    }
  }

  res.json({ gap, briefs, key_insights: matrix.key_insights || [] });
});

// ─── API: Stats ──────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const matrix = getMatrix();
  if (!matrix) return res.json({});

  const complete = (matrix.benchmark_plan || []).filter(p => p.status === 'complete');
  const planned = (matrix.benchmark_plan || []).length;
  const patterns = Object.keys(matrix.pattern_tracker || {}).length;
  const tableStakes = Object.values(matrix.pattern_tracker || {})
    .filter(p => p.count >= (p.table_stakes_at || 5)).length;
  const gapItems = Object.keys(matrix.saudia_gap || {}).length;

  const avgScore = complete.length > 0
    ? (complete.reduce((s, b) => s + (b.overall_score || 0), 0) / complete.length).toFixed(2)
    : 0;

  res.json({
    benchmarks_complete: complete.length,
    benchmarks_planned: planned,
    patterns_discovered: patterns,
    table_stakes_count: tableStakes,
    saudia_opportunities: gapItems,
    average_score: parseFloat(avgScore),
    scores_range: complete.length > 0
      ? { min: Math.min(...complete.map(b => b.overall_score || 0)), max: Math.max(...complete.map(b => b.overall_score || 0)) }
      : null,
  });
});

// ─── API: Benchmark Requests (Wizard + Queue) ───────────────────────────────
app.get('/api/requests', (req, res) => {
  res.json({
    requests: listRequests(PROJECT),
    stages: STAGES,
    benchmark_types: BENCHMARK_TYPES,
    scope_options: SCOPE_OPTIONS,
  });
});

app.post('/api/requests', (req, res) => {
  const { benchmark_type, feature, scope, notes, competitors } = req.body || {};

  if (!benchmark_type || !BENCHMARK_TYPES.includes(benchmark_type)) {
    return res.status(400).json({ error: `benchmark_type must be one of: ${BENCHMARK_TYPES.join(', ')}` });
  }
  if (!feature || !String(feature).trim()) {
    return res.status(400).json({ error: 'feature is required' });
  }
  if (!Array.isArray(competitors) || competitors.length === 0) {
    return res.status(400).json({ error: 'At least one competitor is required' });
  }

  try {
    const request = createRequest(PROJECT, {
      benchmark_type,
      feature: String(feature).trim(),
      scope: Array.isArray(scope) ? scope : [],
      notes: notes || '',
      competitors,
    });
    res.status(201).json(request);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/requests/:id/items/:slug', (req, res) => {
  try {
    const stage = req.body?.stage;
    const request = setStage(PROJECT, req.params.id, req.params.slug, stage);
    res.json(request);

    // "Run Benchmark" sends stage: 'preparing' — hand off to the Benchmark
    // Service without making the API response wait on it. The item's
    // trigger_prompt already exists (built once at request-creation time by
    // requestsStore.js's unchanged buildTriggerPrompt()) — this is the exact
    // text a human used to copy and paste by hand.
    if (stage === 'preparing') {
      const item = request.items.find(i => i.slug === req.params.slug);
      startBenchmark({
        company: item?.name,
        feature: request.feature,
        benchmarkType: request.benchmark_type,
        requestId: request.id,
        slug: req.params.slug,
        prompt: item?.trigger_prompt,
        projectRoot: PROJECT,
        url: item?.url,
      });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/feature-benchmarks', (req, res) => {
  res.json({ items: listFeatureBenchmarks(PROJECT) });
});

// ─── API: Current Feature Benchmarks — the customer-facing product's ONLY ───
// data source for Home and Benchmarks. Legacy research, Homepage Benchmark
// experiments, Complete Journey runs and pipeline verification artifacts are
// filtered out at the model level by listCurrentFeatureBenchmarks(); they
// remain available through the legacy endpoints above for the Archive view.
app.get('/api/current-benchmarks', (req, res) => {
  res.json({ items: listCurrentFeatureBenchmarks(PROJECT) });
});

app.post('/api/requests/:id/cancel', (req, res) => {
  try {
    const request = cancelRequest(PROJECT, req.params.id);
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── API: Global Search ──────────────────────────────────────────────────────
app.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ query: q, results: [] });

  const matrix = getMatrix();
  if (!matrix) return res.json({ query: q, results: [] });

  const results = [];

  function snippet(text, term) {
    const idx = text.toLowerCase().indexOf(term);
    if (idx === -1) return text.replace(/\s+/g, ' ').slice(0, 140).trim();
    const start = Math.max(0, idx - 50);
    const clean = text.replace(/\s+/g, ' ');
    return (start > 0 ? '…' : '') + clean.slice(start, idx + term.length + 70).trim() + '…';
  }

  for (const [slug, co] of Object.entries(matrix.companies || {})) {
    const name = co.meta?.name || slug;

    const overviewHay = [name, co.overview?.business_model, co.overview?.funding_scale, co.overview?.category]
      .filter(Boolean).join(' ').toLowerCase();
    if (overviewHay.includes(q)) {
      results.push({
        type: 'company', label: name,
        snippet: co.overview?.ai_maturity ? `AI Maturity: ${co.overview.ai_maturity} · ${co.overview.business_model || ''}` : '',
        link: `#company/${slug}`,
      });
    }

    for (const [capId, cap] of Object.entries(co.ai_capabilities || {})) {
      const hay = `${capId.replace(/_/g, ' ')} ${cap.label || ''} ${cap.notes || ''}`.toLowerCase();
      if (hay.includes(q)) {
        results.push({
          type: 'ai_capability', label: `${name} — ${capId.replace(/_/g, ' ')}`,
          snippet: cap.notes || cap.label || '', link: `#company/${slug}/overview`,
        });
      }
    }

    for (const [patId, pat] of Object.entries(co.ux_patterns || {})) {
      const hay = `${patId.replace(/_/g, ' ')} ${pat.label || ''} ${pat.notes || ''}`.toLowerCase();
      if (hay.includes(q)) {
        results.push({
          type: 'ux_pattern', label: `${name} — ${patId.replace(/_/g, ' ')}`,
          snippet: pat.notes || pat.label || '', link: `#company/${slug}/overview`,
        });
      }
    }
  }

  const nameMap = {};
  (matrix.benchmark_plan || []).forEach(p => { nameMap[p.slug] = p.name; });

  for (const [id, pat] of Object.entries(matrix.pattern_tracker || {})) {
    const companies = (pat.companies || []).map(s => nameMap[s] || s).join(', ');
    const hay = `${id.replace(/_/g, ' ')} ${pat.label || ''} ${companies}`.toLowerCase();
    if (hay.includes(q)) {
      results.push({
        type: 'pattern', label: pat.label || id.replace(/_/g, ' '),
        snippet: `Seen in ${pat.count || 0} companies${companies ? ': ' + companies : ''}`,
        link: '#trends',
      });
    }
  }

  const seenFeatures = new Set();
  for (const request of listRequests(PROJECT)) {
    const feature = request.feature || '';
    if (!feature || seenFeatures.has(feature.toLowerCase())) continue;
    if (feature.toLowerCase().includes(q)) {
      seenFeatures.add(feature.toLowerCase());
      results.push({
        type: 'feature', label: feature,
        snippet: `${request.benchmark_type} · ${request.items.length} compan${request.items.length === 1 ? 'y' : 'ies'}`,
        link: `#benchmarks?feature=${encodeURIComponent(feature)}`,
      });
    }
  }

  const DOCS = [
    { file: '01_executive_summary.md', label: 'Executive Summary', tab: 'overview' },
    { file: '03_ux_analysis.md', label: 'UX Analysis', tab: 'ux_analysis' },
    { file: '04_emerging_patterns.md', label: 'Emerging Patterns', tab: 'ux_analysis' },
    { file: '05_innovation_opportunities.md', label: 'Innovation Opportunities', tab: 'opportunities' },
  ];

  for (const plan of matrix.benchmark_plan || []) {
    const folder = getCompanyFolder(matrix, plan.slug);
    if (!folder) continue;
    for (const doc of DOCS) {
      const content = readMD(`${folder}/${doc.file}`);
      if (content && content.toLowerCase().includes(q)) {
        results.push({
          type: 'document', label: `${plan.name} — ${doc.label}`,
          snippet: snippet(content, q), link: `#company/${plan.slug}/${doc.tab}`,
        });
      }
    }
  }

  res.json({ query: q, results: results.slice(0, 40) });
});

// ─── Catch-all: return index.html for SPA ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✅ AI Travel Benchmark Dashboard`);
  console.log(`   http://localhost:${PORT}\n`);
  console.log(`   Reads live from: ${PROJECT}`);
  console.log(`   Auto-updates after every benchmark — just refresh.\n`);
});
