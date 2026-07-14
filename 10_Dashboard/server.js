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
  STAGES, BENCHMARK_TYPES, SCOPE_OPTIONS,
} from './lib/requestsStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..');   // AI_Travel_Benchmark_2026/ folder
const PORT = process.env.PORT || 3000;

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
    const request = setStage(PROJECT, req.params.id, req.params.slug, req.body?.stage);
    res.json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/feature-benchmarks', (req, res) => {
  res.json({ items: listFeatureBenchmarks(PROJECT) });
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
