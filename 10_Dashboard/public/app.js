/* ─── AI Travel Benchmark Dashboard — SPA ────────────────────────────────── */

// ─── Constants ────────────────────────────────────────────────────────────────
const JOURNEY_STEP_LABELS = {
  step_01_entry:           '01 Entry',
  step_02_discovery:       '02 Discovery',
  step_03_search:          '03 Search',
  step_04_ai_interaction:  '04 AI Interaction',
  step_05_recommendations: '05 Recommendations',
  step_06_maps:            '06 Maps',
  step_07_booking:         '07 Booking',
  step_08_ancillaries:     '08 Ancillaries',
  step_09_payment:         '09 Payment',
  step_10_trip_management: '10 Trip Management',
  step_11_checkin:         '11 Check-in',
  step_12_loyalty:         '12 Loyalty',
};

// Sprint 27 (P1-4): `desc` added so every render site can offer a plain-
// language definition on hover instead of a bare rubric term — wording
// matches CLAUDE.md's own 1/3/5 scoring rubric, not invented fresh.
const INNOVATION_DIMS = [
  { id: 'clarity',           label: 'Clarity',           desc: 'How understandable the UI is at a glance — confusing (1) to instantly obvious (5).' },
  { id: 'ai_sophistication', label: 'AI Sophistication',  desc: 'How capable the AI is — no AI present (1) to proactive, contextual AI (5).' },
  { id: 'personalization',   label: 'Personalization',   desc: 'How tailored the experience is to the individual user — fully generic (1) to deeply personalized (5).' },
  { id: 'delight',           label: 'Delight',           desc: 'How the experience feels to use — frustrating (1) to surprising and joyful (5).' },
  { id: 'innovation',        label: 'Innovation',        desc: 'How new the idea is versus the rest of the industry — direct copycat (1) to category-defining (5).' },
];

const CHART_COLORS = ['#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#ec4899'];

// Screenshot priority: AI-first steps shown as hero/highlights
const AI_STEP_PRIORITY = [
  '04_ai_interaction', '05_recommendations', '01_entry', '03_search',
  '10_trip_management', '07_booking', '06_maps', '02_discovery',
  '08_ancillaries', '09_payment', '11_checkin', '12_loyalty',
];
const AI_HIGHLIGHT_STEPS = ['04_ai_interaction', '05_recommendations'];

const MATURITY_CLASS = {
  'Autonomous':     'badge-accent',
  'Conversational': 'badge-blue',
  'Assistive':      'badge-green',
  'Basic':          'badge-yellow',
  'Absent':         'badge-gray',
};

const CATEGORY_CLASS = {
  'AI-first':  'badge-purple',
  'Big Tech':  'badge-blue',
  'OTA':       'badge-green',
  'Airline':   'badge-accent',
  'Super App': 'badge-yellow',
};

const STAGE_LABELS = {
  queued:                 'Waiting to start',
  preparing:              'Starting benchmark',
  running:                'Starting benchmark',
  opening_website:        'Opening the site',
  capturing_screenshots:  'Capturing the experience',
  analyzing_ux:           'Analyzing the experience',
  extracting_patterns:    'Analyzing the experience',
  updating_matrix:        'Finishing up',
  generating_dashboard:   'Finishing up',
  completed:              'Completed',
  failed:                 'Could not capture this experience',
  // Sprint 24 — Output Verification Layer
  runtime_failed:         'Could not capture this experience',
  reasoning_failed:       'Could not finish the report',
  verification_failed:    'Report came back incomplete',
  // Sprint 26 — Live Runtime Progress: real Runtime stage ids, shown WHILE
  // that stage is running (see benchmarkService.js). Same ids Output
  // Verification's own error.stageId already used in Sprint 24 — reused
  // here as display labels rather than invented fresh.
  navigation:              'Opening the site',
  screenshot:              'Capturing the experience',
  vision:                  'Analyzing the experience',
  reasoning:               'Generating report',
  output_verification:     'Finishing up',
  // Feature Benchmark's own Runtime stage ids (13_Orchestrator/pipelines/
  // featurePipeline.js) — customer-facing labels, not internal stage/module
  // names, since end users never see or manage the AI pipeline directly.
  // feature_reasoning and feature_report_writer intentionally share one
  // label: from a user's perspective both are "generating the report"
  // (writing the content, then persisting it) — report_writer is also
  // typically too fast to ever be visibly shown on its own.
  feature_discovery:       'Discovering relevant pages',
  journey_mapper:          'Navigating experience',
  navigation_runner:       'Capturing evidence',
  feature_vision:          'Analyzing',
  feature_reasoning:       'Generating report',
  feature_report_writer:   'Generating report',
};

// Sprint 27 (P0-3): plain-language explanations for the three failure
// states, so "Reasoning Failed" doesn't require knowing what "Reasoning"
// means internally — shown as a tooltip and, in the Queue, inline under the
// badge (see the AUTOMATED_STAGES rendering branch below).
const FAILURE_STAGE_DESC = {
  runtime_failed:      'The automated capture (opening the site, taking a screenshot, or reading it with AI Vision) hit an error before analysis could even begin.',
  reasoning_failed:    'The AI research agent that writes the actual report did not finish successfully.',
  verification_failed: 'The AI research agent finished, but one or more expected report files were missing or incomplete — nothing was silently marked "done."',
  failed:              'The benchmark did not complete, for a reason outside the categories above.',
};

// Sprint 26: the two possible Runtime stage sequences fullPipeline.js
// actually runs (13_Orchestrator/pipelines/fullPipeline.js) — url-present
// requests get all five stages, url-less requests skip straight to
// Reasoning. Mirrored here only for display (which segments to draw, how
// many total steps for the progress %) — not a second source of truth,
// since which sequence applies is derived from the item's own existing
// `url` field, not guessed.
const RUNTIME_STAGES_WITH_URL = ['navigation', 'screenshot', 'vision', 'reasoning', 'output_verification'];
const RUNTIME_STAGES_NO_URL = ['reasoning', 'output_verification'];

// Feature Benchmark's own Runtime stage sequence (13_Orchestrator/pipelines/
// featurePipeline.js's stage list, in order) — Feature Benchmark always
// requires a URL (featurePipeline.requiredFields), so unlike Full Pipeline
// there is no separate "no URL" variant to mirror.
const FEATURE_PIPELINE_STAGES = [
  'feature_discovery', 'journey_mapper', 'navigation_runner',
  'feature_vision', 'feature_reasoning', 'feature_report_writer',
];

// Which of the two live sequences applies is derived from the request's own
// existing benchmark_type field — Feature Benchmark items always carry a
// url too, so this can't be told apart via item.url the way Full Pipeline's
// two variants are; see runtimeSequenceFor() below.
const RUNTIME_STAGE_SET = new Set([...RUNTIME_STAGES_WITH_URL, ...FEATURE_PIPELINE_STAGES]);
const STAGE_ORDER = Object.keys(STAGE_LABELS);

function runtimeSequenceFor(request, item) {
  if (request.benchmark_type === 'Feature Benchmark') return FEATURE_PIPELINE_STAGES;
  return item.url ? RUNTIME_STAGES_WITH_URL : RUNTIME_STAGES_NO_URL;
}

const FEATURE_PRESETS = [
  'AI Travel Planner', 'AI Chat', 'Homepage', 'Search', 'Search Results',
  'Booking Flow', 'Passenger Details', 'Payment', 'Check-in', 'Ancillaries',
  'Loyalty', 'Burger Menu', 'Profile', 'Notifications',
];

// Same values as FEATURE_PRESETS — grouped only for the wizard's visual
// layout. Order/labels here never reach the backend.
const FEATURE_GROUPS = [
  { label: 'AI', items: ['AI Travel Planner', 'AI Chat'] },
  { label: 'Core journey', items: ['Homepage', 'Search', 'Search Results', 'Booking Flow', 'Passenger Details', 'Payment', 'Check-in'] },
  { label: 'Other experiences', items: ['Ancillaries', 'Loyalty', 'Burger Menu', 'Profile', 'Notifications'] },
];

const SCOPE_INFO = [
  { id: 'AI only',            desc: 'AI conversations, suggestions, and capabilities only' },
  { id: 'UX/UI only',         desc: 'Visual and interaction design only' },
  { id: 'Mobile',             desc: 'Mobile app surfaces' },
  { id: 'Web',                desc: 'Web surfaces' },
  { id: 'End-to-End Journey', desc: 'All 12 journey steps' },
  { id: 'Visual Design',      desc: 'Look and feel, typography, layout' },
  { id: 'Interaction Design', desc: 'Flows, transitions, micro-interactions' },
];

const COMPETITOR_SUGGESTIONS = [
  'Mindtrip', 'Trip.com', 'Booking.com', 'ixigo', 'Google Travel', 'Hopper',
  'Expedia', 'Airbnb', 'Kayak', 'Emirates', 'Qatar Airways', 'Singapore Airlines',
  'Turkish Airlines', 'Layla', 'Roam Around', 'Grab', 'Naver', 'Saudia',
];

const ROADMAP_ITEMS = [
  { title: 'Figma Sync',              desc: 'Push journey maps & annotations directly' },
  { title: 'Notion Sync',             desc: 'Mirror benchmarks into Notion workspaces' },
  { title: 'AI Report Generator',     desc: 'Draft executive summaries from raw captures' },
  { title: 'Automatic Scheduling',    desc: 'Recurring re-benchmarks on a cadence' },
  { title: 'Video Capture',           desc: 'Motion & micro-interaction recording' },
  { title: 'Heatmaps',                desc: 'Attention and interaction heatmaps' },
  { title: 'Analytics',               desc: 'Usage analytics across the knowledge base' },
];

// ─── State ────────────────────────────────────────────────────────────────────
let _matrix = null;
let _benchmarks = null;
let _comparison_selected = new Set();
let _requests_cache = null;
let _wizard = null; // current wizard draft state, created on entering #wizard
let _library_filters = { q: '', sort: 'newest' };
let _queue_filter = 'All';

const DURATION_HOURS_BY_TYPE = {
  'Feature Benchmark': 0.6,
  'AI Experience': 1.25,
  'UX/UI': 1.25,
  'Mobile App': 1.75,
  'Website': 1.25,
  'Complete Journey': 2.5,
};

function estimateCompletionDate(request) {
  const hours = DURATION_HOURS_BY_TYPE[request.benchmark_type] || 1.5;
  return new Date(new Date(request.created_at).getTime() + hours * 3600 * 1000);
}

function lastUpdatedAt(request) {
  const times = [request.created_at, ...request.items.map(i => i.updated_at)].map(t => new Date(t).getTime());
  return new Date(Math.max(...times));
}

// ─── Keyboard accessibility for interactive non-native elements ─────────────
// Chips, filter pills, gallery items, and icon-only close buttons are
// <div>/<span> with onclick — native HTML never makes those keyboard-
// focusable or operable. style.css already defines :focus-visible outlines
// for .chip/.filter-chip/.nav-item, but they were inert without a tabindex.
// Rather than converting every one to a <button> (touching each call site's
// layout), templates get role="button" + tabindex="0", and this one
// delegated listener maps Enter/Space to the same click each already
// handles — it only adds keyboard operability, never changes behavior.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('[role="button"]');
  if (!el) return;
  e.preventDefault();
  el.click();
});

// ─── Generic Modal ────────────────────────────────────────────────────────────
function modalEscHandler(e) { if (e.key === 'Escape') closeModal(); }

window.openModal = function(html, { wide = false } = {}) {
  document.getElementById('modal-overlay')?.remove();
  const m = document.createElement('div');
  m.id = 'modal-overlay';
  m.innerHTML = `<div id="modal-box" class="${wide ? 'modal-box-wide' : ''}">${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m) closeModal(); });
  document.body.appendChild(m);
  document.addEventListener('keydown', modalEscHandler);
};

window.closeModal = function() {
  document.getElementById('modal-overlay')?.remove();
  document.removeEventListener('keydown', modalEscHandler);
};

// Sprint 27 — Internal Beta Polish (P1-1): replaces native alert()/confirm()
// with the app's own modal chrome, so an error or a destructive-action
// confirmation looks like the rest of the product instead of a jarring
// browser-native dialog. Same openModal()/closeModal() every other dialog
// in the app already uses — no new UI system.
window.showAlertModal = function(message, { title = 'Something went wrong' } = {}) {
  openModal(`
    <div class="modal-header">
      <div class="modal-title">${title}</div>
      <div class="modal-close" role="button" tabindex="0" aria-label="Close dialog" onclick="closeModal()">✕</div>
    </div>
    <div class="modal-body"><p class="text-2" style="line-height:1.5">${message}</p></div>
    <div style="display:flex;justify-content:flex-end;gap:8px;padding:0 20px 20px">
      <button class="btn btn-primary" onclick="closeModal()">OK</button>
    </div>`);
};

// Sprint 27 (Priority 6 — missing success messages): a small, non-blocking
// toast for "this worked" confirmations — a full modal would force a click
// to dismiss right when the user is already navigating on, which is worse
// than no feedback at all. Auto-dismisses; doesn't stack (one at a time is
// enough for this app's action volume).
window.showToast = function(message) {
  document.getElementById('atb-toast')?.remove();
  const t = document.createElement('div');
  t.id = 'atb-toast';
  t.className = 'atb-toast';
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('visible'), 10);
  setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 300); }, 3200);
};

window.showConfirmModal = function(message, { title = 'Please confirm', confirmLabel = 'Confirm' } = {}) {
  return new Promise((resolve) => {
    openModal(`
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <div class="modal-close" role="button" tabindex="0" aria-label="Close dialog" onclick="closeModal()">✕</div>
      </div>
      <div class="modal-body"><p class="text-2" style="line-height:1.5">${message}</p></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:0 20px 20px">
        <button class="btn btn-ghost" id="confirm-modal-cancel">Cancel</button>
        <button class="btn btn-danger" id="confirm-modal-ok">${confirmLabel}</button>
      </div>`);
    document.getElementById('confirm-modal-cancel').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('confirm-modal-ok').onclick = () => { closeModal(); resolve(true); };
  });
};

// ─── API ──────────────────────────────────────────────────────────────────────
const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `${r.status} ${url}`); }
    return r.json();
  },
  async patch(url, body) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `${r.status} ${url}`); }
    return r.json();
  },
};

async function getMatrix() {
  if (!_matrix) _matrix = await api.get('/api/matrix');
  return _matrix;
}

async function getBenchmarks() {
  if (!_benchmarks) _benchmarks = await api.get('/api/benchmarks');
  return _benchmarks;
}

async function getRequests(force = false) {
  if (!_requests_cache || force) _requests_cache = await api.get('/api/requests');
  return _requests_cache;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s === null || s === undefined) return '#5a6480';
  if (s >= 4.0) return '#22c55e';
  if (s >= 3.0) return '#f59e0b';
  return '#ef4444';
}

function scoreBadge(s) {
  if (s === null || s === undefined) return 'badge-gray';
  if (s >= 4.0) return 'badge-green';
  if (s >= 3.0) return 'badge-yellow';
  return 'badge-red';
}

function fmt(val) {
  if (val === null || val === undefined) return '—';
  return typeof val === 'number' ? val.toFixed(1) : val;
}

function badge(text, cls, title) {
  return `<span class="badge ${cls}"${title ? ` title="${title}"` : ''}>${text}</span>`;
}

// Sprint 27 (P1-4): plain-language definitions for the AI Maturity ladder,
// wording matches CLAUDE.md's own "AI Maturity Level" scale.
const MATURITY_DESC = {
  'Autonomous':     'AI takes action on its own — proactive monitoring, multi-step tasks without being asked.',
  'Conversational': 'AI holds a real back-and-forth conversation, not just single-turn suggestions.',
  'Assistive':      'AI offers helpful suggestions, but the user drives every step.',
  'Basic':          'Some AI-labeled features exist, but they are simple, not contextual.',
  'Absent':         'No meaningful AI present in this experience.',
};

// Sprint 27 (Priority 5): pulled out of renderTabOverview() and rendered
// directly under the company header in renderCompany() instead — the
// single highest-signal "key finding" this report has (one prioritized
// idea, why it matters, business impact) was previously visible only after
// clicking into the Overview tab specifically. Same data, same card, no
// new fetch — just shown where a scanning reader actually looks first.
function executiveRecommendationHtml(rec) {
  if (!rec) return '';
  const complexityBadge = rec.complexity === 'Low' ? 'badge-green'
    : rec.complexity === 'High' ? 'badge-red' : 'badge-yellow';
  const timelineBadge = rec.timeline === 'Quick Win' ? 'badge-accent'
    : rec.timeline === 'Long-term' ? 'badge-purple' : 'badge-blue';
  return `
    <div class="exec-rec-card mb-4">
      <div class="exec-rec-eyebrow">If Saudia adopts only ONE idea from this benchmark</div>
      <div class="exec-rec-idea">${rec.one_idea}</div>
      ${rec.description ? `<p class="exec-rec-desc">${rec.description}</p>` : ''}
      <div class="exec-rec-details">
        ${rec.why_it_matters ? `<div><div class="exec-rec-label">Why it matters</div><div class="exec-rec-text">${rec.why_it_matters}</div></div>` : ''}
        ${rec.business_impact ? `<div><div class="exec-rec-label">Business impact</div><div class="exec-rec-text">${rec.business_impact}</div></div>` : ''}
      </div>
      <div class="exec-rec-footer">
        ${rec.complexity ? `<span class="badge ${complexityBadge}">${rec.complexity} Complexity</span>` : ''}
        ${rec.timeline ? `<span class="badge ${timelineBadge}">${rec.timeline}</span>` : ''}
      </div>
    </div>`;
}

function maturityBadge(m) {
  return badge(m || '—', MATURITY_CLASS[m] || 'badge-gray', MATURITY_DESC[m] || 'AI Maturity — how capable this product\'s AI actually is.');
}

function categoryBadge(c) {
  return badge(c || '—', CATEGORY_CLASS[c] || 'badge-gray');
}

function scoreBar(score, maxScore = 5, color) {
  const pct = ((score || 0) / maxScore) * 100;
  const c = color || scoreColor(score);
  return `
    <div class="score-bar" title="${fmt(score)} / ${maxScore}">
      <div class="score-bar-fill" style="width:${pct}%;background:${c}"></div>
    </div>`;
}

function setContent(html) {
  document.getElementById('content').innerHTML = html;
}

function setTitle(t) {
  // The product shell has no page-title bar — each page renders its own
  // heading. Keep the browser tab label useful.
  document.title = t && t !== 'Home' ? `${t} · Benchmark Intelligence` : 'Benchmark Intelligence';
}

// The persistent top-nav CTA ("New Benchmark") replaced every per-page action
// button, so this is now a no-op kept only so existing call sites don't break.
function setTopbarActions() {}

// ─── Radar Chart (SVG) ───────────────────────────────────────────────────────
function radarChart(datasets, labels, size = 220, maxVal = 5) {
  const N = labels.length;
  const ang = (2 * Math.PI) / N;
  const r = size / 2 - 36;
  const cx = size / 2;
  const cy = size / 2;

  function pt(i, val) {
    const a = i * ang - Math.PI / 2;
    const d = r * (val / maxVal);
    return [cx + d * Math.cos(a), cy + d * Math.sin(a)];
  }

  // Grid
  let grids = '';
  for (const f of [0.2, 0.4, 0.6, 0.8, 1.0]) {
    const pts = Array.from({ length: N }, (_, i) => pt(i, maxVal * f).join(',')).join(' ');
    grids += `<polygon points="${pts}" fill="none" stroke="#252a3a" stroke-width="${f === 1 ? 1.5 : 1}"/>`;
  }

  // Axes + labels
  let axes = '', lbls = '';
  for (let i = 0; i < N; i++) {
    const [x2, y2] = pt(i, maxVal);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#252a3a" stroke-width="1"/>`;
    // 1.6, not the smaller offset a middle-anchored label could use: with
    // directional anchors below, side labels grow back toward center from
    // this point, so it needs enough clearance from the r=maxVal data ring
    // that the text doesn't overlap the plotted polygon itself.
    const [lx, ly] = pt(i, maxVal + 1.6);
    // A label straight off the right/left edge grows further past the
    // viewBox under text-anchor="middle" (confirmed: "AI Sophistication"
    // clipped to "AI Sophisticati" in both the company header and the
    // Comparison page radar). Anchor right-side labels to grow leftward
    // (toward center) and left-side labels to grow rightward instead —
    // the standard fix for polar/radar chart label placement — so long
    // labels stay inside the chart regardless of size.
    const cosA = Math.cos(i * ang - Math.PI / 2);
    const anchor = cosA > 0.3 ? 'end' : cosA < -0.3 ? 'start' : 'middle';
    lbls += `<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" fill="#8892a8" font-size="10">${labels[i]}</text>`;
  }

  // Score value labels on first axis at each grid level
  let scoreMarks = '';
  for (const [f, v] of [[0.4, 2], [0.6, 3], [0.8, 4], [1.0, 5]]) {
    const [px, py] = pt(0, maxVal * f);
    scoreMarks += `<text x="${px + 4}" y="${py}" fill="#5a6480" font-size="8">${v}</text>`;
  }

  // Data polygons
  let polys = '';
  datasets.forEach((ds, ci) => {
    const pts = ds.values.map((v, i) => pt(i, v || 0).join(',')).join(' ');
    const c = CHART_COLORS[ci % CHART_COLORS.length];
    polys += `<polygon points="${pts}" fill="${c}" fill-opacity="0.15" stroke="${c}" stroke-width="2"/>`;
    ds.values.forEach((v, i) => {
      const [px, py] = pt(i, v || 0);
      polys += `<circle cx="${px}" cy="${py}" r="3" fill="${c}"/>`;
    });
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    ${grids}${axes}${scoreMarks}${polys}${lbls}
  </svg>`;
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function navigate(hash) {
  location.hash = hash;
}

window.addEventListener('hashchange', () => route(location.hash));

function updateActiveNav(activeRoute) {
  // Archive is a tab inside Benchmarks — highlight Benchmarks for it.
  const nav = activeRoute === 'archive' ? 'benchmarks' : activeRoute;
  document.querySelectorAll('#topnav [data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === nav);
  });
}

async function route(hash) {
  const raw = hash.replace('#', '') || 'home';
  const [h, queryString] = raw.split('?');
  const query = new URLSearchParams(queryString || '');

  if (h.startsWith('company/')) {
    const parts = h.split('/');
    await renderCompany(parts[1], parts[2] || 'overview');
    updateActiveNav(parts[1]);
    return;
  }

  if (h.startsWith('feature-report/')) {
    const requestId = decodeURIComponent(h.slice('feature-report/'.length));
    updateActiveNav('benchmarks');
    await renderFeatureReport(requestId);
    return;
  }

  // Product routes: Home / New Benchmark / Benchmarks (Current | Archive) /
  // Activity. The legacy routes below (matrix, comparison, trends, saudia,
  // homepage-benchmarks) stay reachable by URL and from Archive, but are not
  // in the product navigation.
  updateActiveNav(h);
  switch (h) {
    case 'home':        await renderHome(); break;
    case 'benchmarks':  await renderBenchmarks(query); break;
    case 'archive':     await renderBenchmarks(new URLSearchParams({ tab: 'archive' })); break;
    case 'wizard':      await renderWizard(); break;
    case 'activity':
    case 'queue':       await renderActivity(); break;
    // ── Legacy / hidden — not in product navigation ──
    case 'homepage-benchmarks': await renderHomepageBenchmarks(); break;
    case 'comparison':  await renderComparison(); break;
    case 'matrix':      await renderMatrix(); break;
    case 'trends':      await renderTrends(); break;
    case 'saudia':      await renderSaudia(); break;
    default:            await renderHome();
  }
}

// ─── Current Feature Benchmarks (customer-facing data source) ─────────────────
// Home and Benchmarks read ONLY this. It maps 1:1 to the server's
// /api/current-benchmarks (listCurrentFeatureBenchmarks): current, automated
// Feature Benchmark runs — no legacy research, no Homepage experiments, no
// Complete Journey runs, no pipeline verification artifacts.
let _current_benchmarks = null;
async function getCurrentBenchmarks(force = false) {
  if (!_current_benchmarks || force) {
    _current_benchmarks = (await api.get('/api/current-benchmarks').catch(() => ({ items: [] }))).items || [];
  }
  return _current_benchmarks;
}

const CB_STATUS = {
  complete:    { label: 'Complete',    cls: 'badge-green' },
  in_progress: { label: 'Running',     cls: 'badge-accent' },
  queued:      { label: 'Queued',      cls: 'badge-gray' },
};
function cbStatus(s) { return CB_STATUS[s] || { label: s || '—', cls: 'badge-gray' }; }

// Plain-language, one-line progress for a running item — never a raw stage id.
function cbStageLabel(stage) { return STAGE_LABELS[stage] || 'Working…'; }

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ─── Top nav ─────────────────────────────────────────────────────────────────
// One small count next to Activity when something is in flight — otherwise
// the nav stays calm and label-only.
async function initSidebar() {
  try {
    const benchmarks = await getCurrentBenchmarks(true);
    const active = benchmarks.filter(b => b.status !== 'complete').length;
    const el = document.getElementById('nav-activity-count');
    if (el) {
      el.textContent = active;
      el.hidden = active === 0;
    }
  } catch { /* server not reachable — count stays hidden */ }
}

// ─── Shared: benchmark result row (Home + Benchmarks + Archive) ──────────────
// A benchmark is a research document, not a dashboard widget — render it as a
// list row: an initial marker, company eyebrow, strong feature title, a quiet
// meta line, and one clear action.
function cbInitial(name) {
  const first = String(name || '?').replace(/^the\s+/i, '').trim();
  return (first[0] || '?').toUpperCase();
}

// The action link is rendered as a "stretched link": its ::after covers the
// whole row, so the entire row is clickable and keyboard-focusable without
// nesting <a> inside <a>.
function cbActionHtml(b) {
  if (b.has_report) {
    return `<a class="cb-row-action cb-row-stretch" href="#feature-report/${encodeURIComponent(b.request_id)}">View report<span aria-hidden="true"> →</span></a>`;
  }
  if (b.status === 'complete') {
    return `<span class="cb-row-action muted">Report generating…</span>`;
  }
  return `<a class="cb-row-action cb-row-stretch" href="#activity">View progress<span aria-hidden="true"> →</span></a>`;
}

function cbRowHtml(b) {
  const st = cbStatus(b.status);
  const running = b.status === 'in_progress';
  const meta = [(b.scope || []).join(', '), fmtDate(b.date)].filter(Boolean).join('  ·  ');
  return `
    <div class="cb-row">
      <span class="cb-row-mark" aria-hidden="true">${cbInitial(b.companies?.[0] || b.company)}</span>
      <div class="cb-row-main">
        <div class="cb-row-company">${b.company}</div>
        <div class="cb-row-feature">${b.feature}</div>
        <div class="cb-row-meta">${meta}${running ? `  ·  ${cbStageLabel(b.stage)}` : ''}</div>
      </div>
      <div class="cb-row-side">
        <span class="status-pill status-${b.status}">${st.label}</span>
        ${cbActionHtml(b)}
      </div>
    </div>`;
}

function cbListHtml(items) {
  return `<div class="cb-list">${items.map(cbRowHtml).join('')}</div>`;
}

function cbEmptyStateHtml(context) {
  return `
    <div class="empty-state">
      <h3>No benchmarks yet</h3>
      <p>${context || 'Start a benchmark and the report will appear here.'}</p>
      <a href="#wizard" class="btn btn-primary" style="margin-top:18px">Start a benchmark</a>
    </div>`;
}

// ─── Page: Home ──────────────────────────────────────────────────────────────
const HOME_EXAMPLES = ['Homepage', 'Booking Flow', 'Search', 'Payment', 'AI Chat'];

async function renderHome() {
  setTitle('Home');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const benchmarks = await getCurrentBenchmarks(true);
  const recent = benchmarks.slice(0, 6);

  setContent(`
    <div class="home">
      <section class="home-hero">
        <div class="home-hero-brand">Benchmark Intelligence</div>
        <h1 class="home-hero-title">Benchmark any digital travel experience<br class="home-hero-br" /> and understand how leading products solve it.</h1>

        <form class="home-quick" onsubmit="homeQuickStart(event)">
          <input type="text" id="home-quick-input" class="home-quick-input" placeholder="What do you want to benchmark?" autocomplete="off" aria-label="What do you want to benchmark?" />
          <button type="submit" class="btn btn-primary btn-lg">Start benchmark<span aria-hidden="true"> →</span></button>
        </form>

        <div class="home-examples">
          <span class="home-examples-label">Try</span>
          ${HOME_EXAMPLES.map(f => `<button type="button" class="home-example" onclick="homeQuickPick('${f}')">${f}</button>`).join('')}
        </div>

        <a href="#wizard" class="home-manual">Or create a benchmark manually<span aria-hidden="true"> →</span></a>
      </section>

      <section class="home-recent">
        <div class="home-recent-head">
          <h2>Recent benchmarks</h2>
          ${benchmarks.length > recent.length ? `<a href="#benchmarks" class="btn-link">View all</a>` : ''}
        </div>
        ${recent.length ? cbListHtml(recent) : `<p class="home-recent-empty">Nothing yet — start your first benchmark above.</p>`}
      </section>
    </div>
  `);
}

function homeStartWithFeature(v) {
  initWizard();
  if (v && v.trim()) { _wizard.feature = v.trim(); _wizard.step = 2; }
  navigate('wizard');
}
window.homeQuickStart = function(e) {
  e.preventDefault();
  homeStartWithFeature(document.getElementById('home-quick-input').value);
};
window.homeQuickPick = function(f) {
  const input = document.getElementById('home-quick-input');
  if (input) input.value = f;
  homeStartWithFeature(f);
};

// ─── Benchmark card HTML ──────────────────────────────────────────────────────
function benchmarkCardHtml(b) {
  const isPending = b.status === 'pending';
  const scores = b.innovation_scores;
  const href = isPending ? '' : `#company/${b.slug}`;

  return `
    <a class="benchmark-card ${isPending ? 'pending' : ''}" href="${href}" data-slug="${b.slug}">
      <div class="bc-header">
        <div>
          <div class="bc-name">${b.name}</div>
          <div class="bc-category">${b.category}</div>
        </div>
        <div>
          <div class="bc-score" style="color:${scoreColor(b.overall_score)}">${isPending ? '—' : fmt(b.overall_score)}</div>
          <div class="score-label">${isPending ? 'Pending' : '/ 5.0'}</div>
        </div>
      </div>

      ${!isPending && scores ? `
      <div class="bc-bars">
        ${INNOVATION_DIMS.map(d => `
          <div class="bc-bar-row">
            <div class="bc-bar-label" title="${d.desc}">${d.label}</div>
            <div class="bc-bar"><div class="bc-bar-fill" style="width:${((scores[d.id] || 0) / 5) * 100}%;background:${scoreColor(scores[d.id])}"></div></div>
            <div class="bc-bar-val">${fmt(scores[d.id])}</div>
          </div>`).join('')}
      </div>` : ''}

      <div class="bc-meta">
        ${b.ai_maturity ? maturityBadge(b.ai_maturity) : ''}
        ${categoryBadge(b.category)}
        ${b.native_booking ? badge('Native Booking', 'badge-green') : ''}
        ${b.has_loyalty ? badge('Loyalty', 'badge-blue') : ''}
      </div>

      ${b.standout_feature ? `<div class="bc-standout">${b.standout_feature}</div>` : ''}
    </a>`;
}

function attachCardClicks() {
  document.querySelectorAll('.benchmark-card:not(.pending)').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      navigate(el.getAttribute('href'));
    });
  });
}

// ─── Page: New Benchmark Wizard ──────────────────────────────────────────────
// This wizard only ever creates Feature Benchmarks — there is no
// "Benchmark Type" step and no benchmark_type choice exposed to the user.
// AI Experience / UX/UI / Mobile App / Website are Scope options only (see
// SCOPE_INFO below), never a benchmark_type value: benchmarkService.js
// routes strictly on benchmark_type, and only 'Feature Benchmark' and
// 'Complete Journey' (backend-only, not offered here) have defined routes.
function initWizard() {
  _wizard = { step: 1, benchmark_type: 'Feature Benchmark', feature: null, competitors: [], scope: [], notes: '', submitting: false, error: null };
}

async function renderWizard() {
  setTitle('New Benchmark');
  if (!_wizard) initWizard();
  renderWizardStep();
}

const WIZARD_STEPS = [
  { label: 'Feature',   context: 'Choose the one experience every company will be measured on.' },
  { label: 'Companies', context: 'The products you want to compare, side by side.' },
  { label: 'Focus',     context: 'What the research should analyse and score.' },
  { label: 'Review',    context: 'Confirm and start. The run happens on its own.' },
];
const WIZARD_STEP_LABELS = WIZARD_STEPS.map(s => s.label);

function wizardProgressHtml() {
  return `
    <div class="wiz-progress">
      <div class="wiz-progress-dots">
        ${WIZARD_STEPS.map((s, i) => {
          const n = i + 1;
          const cls = n < _wizard.step ? 'done' : n === _wizard.step ? 'current' : '';
          return `<span class="wiz-dot ${cls}" title="${s.label}"></span>`;
        }).join('')}
      </div>
      <div class="wiz-progress-text">Step ${_wizard.step} of 4 · ${WIZARD_STEPS[_wizard.step - 1].label}</div>
    </div>`;
}

function wizardErrorHtml() {
  return _wizard.error ? `<div class="wiz-error" role="alert">${_wizard.error}</div>` : '';
}

function wizardActionsHtml(primaryLabel, primaryFn) {
  const back = _wizard.step > 1
    ? `<button class="btn btn-ghost" onclick="wizardBack()" ${_wizard.submitting ? 'disabled' : ''}>Back</button>`
    : '<span></span>';
  return `
    <div class="wiz-actions">
      ${back}
      <button class="btn btn-primary btn-lg" onclick="${primaryFn}()" ${_wizard.submitting ? 'disabled' : ''}>${primaryLabel}</button>
    </div>`;
}

function renderWizardStep() {
  const body = { 1: wizardStep1, 2: wizardStep2, 3: wizardStep3, 4: wizardStep4 }[_wizard.step]();
  setContent(`<div class="wiz">${wizardProgressHtml()}<div class="wiz-step">${body}</div></div>`);
}

function wizardStepHeadHtml(question) {
  return `
    <div class="wiz-head">
      <h1 class="wiz-q">${question}</h1>
      <p class="wiz-context">${WIZARD_STEPS[_wizard.step - 1].context}</p>
    </div>`;
}

function wizardStep1() {
  const customVal = _wizard.feature && !FEATURE_PRESETS.includes(_wizard.feature) ? _wizard.feature : '';
  return `
    ${wizardStepHeadHtml('What would you like to benchmark?')}
    <div class="wiz-feature-groups">
      ${FEATURE_GROUPS.map(g => `
        <div class="wiz-feature-group">
          <div class="wiz-feature-group-label">${g.label}</div>
          <div class="wiz-options">
            ${g.items.map(f => `<button type="button" class="wiz-option ${_wizard.feature === f ? 'selected' : ''}" aria-pressed="${_wizard.feature === f}" onclick="wizardSetFeature('${f}')">${f}</button>`).join('')}
          </div>
        </div>`).join('')}
    </div>
    <div class="wiz-field">
      <label class="form-label" for="wiz-feature-custom">Or something else</label>
      <input type="text" id="wiz-feature-custom" class="form-input" placeholder="e.g. Refund flow" value="${customVal}" oninput="wizardSetFeatureText(this.value)" />
    </div>
    ${wizardErrorHtml()}
    ${wizardActionsHtml('Continue', 'wizardNext')}`;
}

function wizardStep2() {
  const rows = _wizard.competitors.map((c, i) => `
    <div class="wiz-company">
      <span class="wiz-company-name">${c.name}</span>
      <span class="wiz-company-url">${c.url || 'no URL'}</span>
      <button type="button" class="wiz-company-remove" aria-label="Remove ${c.name}" onclick="wizardRemoveCompetitor(${i})">✕</button>
    </div>`).join('');
  const suggestions = COMPETITOR_SUGGESTIONS.filter(s => !_wizard.competitors.some(c => c.name === s)).slice(0, 10);

  return `
    ${wizardStepHeadHtml('Which companies should we compare?')}
    <div class="wiz-add-row">
      <input type="text" class="form-input" id="wizard-competitor-name" placeholder="Company name" />
      <input type="text" class="form-input" id="wizard-competitor-url" placeholder="https:// (optional)" />
      <button type="button" class="btn btn-ghost" onclick="wizardAddCompetitor()">Add</button>
    </div>
    ${suggestions.length ? `<div class="wiz-suggestions">
      ${suggestions.map(s => `<button type="button" class="wiz-suggestion" onclick="wizardQuickAddCompetitor('${s}')">+ ${s}</button>`).join('')}
    </div>` : ''}
    <div class="wiz-company-list">${rows || '<p class="wiz-empty">No companies added yet.</p>'}</div>
    ${wizardErrorHtml()}
    ${wizardActionsHtml('Continue', 'wizardNext')}`;
}

function wizardStep3() {
  return `
    ${wizardStepHeadHtml('What should we focus on?')}
    <div class="wiz-scope-list">
      ${SCOPE_INFO.map(s => `
        <button type="button" class="wiz-scope ${_wizard.scope.includes(s.id) ? 'selected' : ''}" aria-pressed="${_wizard.scope.includes(s.id)}" onclick="wizardToggleScope('${s.id}')">
          <span class="wiz-scope-name">${s.id}</span>
          <span class="wiz-scope-desc">${s.desc}</span>
        </button>`).join('')}
    </div>
    ${wizardErrorHtml()}
    ${wizardActionsHtml('Continue', 'wizardNext')}`;
}

function wizardStep4() {
  const scopeText = _wizard.scope.join(', ') || 'End-to-End Journey';
  const companyNames = _wizard.competitors.map(c => c.name).join(', ');
  return `
    ${wizardStepHeadHtml('Ready to benchmark')}
    <dl class="wiz-review">
      <div><dt>Companies</dt><dd>${companyNames}</dd></div>
      <div><dt>Feature</dt><dd>${_wizard.feature}</dd></div>
      <div><dt>Focus</dt><dd>${scopeText}</dd></div>
    </dl>
    <div class="wiz-field">
      <label class="form-label" for="wiz-notes">Notes (optional)</label>
      <textarea class="form-textarea" id="wiz-notes" oninput="wizardSetNotes(this.value)">${_wizard.notes || ''}</textarea>
    </div>
    ${wizardErrorHtml()}
    ${wizardActionsHtml(_wizard.submitting ? 'Starting…' : 'Start benchmark', 'wizardSubmit')}`;
}

window.wizardSetFeature = function(id) { _wizard.feature = id; _wizard.error = null; renderWizardStep(); };
window.wizardSetFeatureText = function(v) { _wizard.feature = v; };
window.wizardSetNotes = function(v) { _wizard.notes = v; };

window.wizardAddCompetitor = function() {
  const nameEl = document.getElementById('wizard-competitor-name');
  const urlEl = document.getElementById('wizard-competitor-url');
  const name = nameEl.value.trim();
  if (!name) return;
  _wizard.competitors.push({ name, url: urlEl.value.trim() || null });
  _wizard.error = null;
  renderWizardStep();
};

window.wizardQuickAddCompetitor = function(name) {
  if (_wizard.competitors.some(c => c.name === name)) return;
  _wizard.competitors.push({ name, url: null });
  _wizard.error = null;
  renderWizardStep();
};

window.wizardRemoveCompetitor = function(i) {
  _wizard.competitors.splice(i, 1);
  renderWizardStep();
};

window.wizardToggleScope = function(id) {
  const idx = _wizard.scope.indexOf(id);
  if (idx === -1) _wizard.scope.push(id); else _wizard.scope.splice(idx, 1);
  renderWizardStep();
};

window.wizardNext = function() {
  const validators = {
    1: () => !_wizard.feature || !_wizard.feature.trim() ? 'Enter or choose a feature.' : null,
    2: () => _wizard.competitors.length === 0 ? 'Add at least one competitor.' : null,
    3: () => _wizard.scope.length === 0 ? 'Select at least one scope option.' : null,
  }[_wizard.step];
  const err = validators ? validators() : null;
  if (err) { _wizard.error = err; renderWizardStep(); return; }
  _wizard.error = null;
  _wizard.step += 1;
  renderWizardStep();
};

window.wizardBack = function() {
  _wizard.error = null;
  _wizard.step = Math.max(1, _wizard.step - 1);
  renderWizardStep();
};

window.wizardSubmit = async function() {
  _wizard.submitting = true;
  _wizard.error = null;
  renderWizardStep();
  try {
    const request = await api.post('/api/requests', {
      benchmark_type: _wizard.benchmark_type,
      feature: _wizard.feature,
      scope: _wizard.scope,
      notes: _wizard.notes,
      competitors: _wizard.competitors,
    });
    // The product is automated end to end — running is not a separate
    // manual step a user takes later. Start every item immediately (the
    // same PATCH the old manual "Start" button used to require).
    await Promise.all((request.items || []).map(item =>
      api.patch(`/api/requests/${request.id}/items/${item.slug}`, { stage: 'preparing' }).catch(() => {})
    ));
    _requests_cache = null;
    _benchmarks = null;
    _matrix = null;
    _current_benchmarks = null;
    _wizard = null;
    await initSidebar();
    navigate('activity');
    showToast('Benchmark started — follow it in Activity.');
  } catch (e) {
    _wizard.submitting = false;
    _wizard.error = e.message || 'Could not create the request.';
    renderWizardStep();
  }
};

// ─── Page: Activity ──────────────────────────────────────────────────────────
// "Activity", not "Queue" — the user cares about what's happening to their
// benchmarks, not an engineering work queue. Everything here is plain
// language: no request ids, no stage ids, no pipeline internals.
const ACTIVE_QUEUE_STAGES = new Set(['preparing', 'running', ...RUNTIME_STAGES_WITH_URL, ...FEATURE_PIPELINE_STAGES]);
let _queue_poll_timer = null;

function formatAgo(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
}

const FAILURE_STAGES = new Set(['failed', 'runtime_failed', 'reasoning_failed', 'verification_failed']);
function isItemActive(stage) { return ACTIVE_QUEUE_STAGES.has(stage); }

// A running benchmark rendered as a live object: company, feature, current
// step, a progress bar (determinate when the step is known, indeterminate
// otherwise), when it started, and a way to stop it.
function activityRunningHtml(b) {
  const item = b.items[0] || {};
  const idx = FEATURE_PIPELINE_STAGES.indexOf(item.stage);
  const known = idx >= 0;
  const pct = known ? Math.round(((idx + 1) / FEATURE_PIPELINE_STAGES.length) * 100) : 0;
  const started = item.started_at ? `Started ${formatAgo(Date.now() - new Date(item.started_at).getTime())}` : 'Starting…';
  return `
    <article class="act-card">
      <div class="act-card-head">
        <span class="act-mark" aria-hidden="true">${cbInitial(b.companies?.[0] || b.company)}</span>
        <div>
          <div class="act-card-company">${b.company}</div>
          <div class="act-card-feature">${b.feature}</div>
        </div>
      </div>
      <div class="act-card-status">${cbStageLabel(item.stage)}…</div>
      <div class="act-bar ${known ? '' : 'indeterminate'}"><span style="${known ? `width:${pct}%` : ''}"></span></div>
      <div class="act-card-foot">
        <span class="act-card-time">${started}</span>
        <button class="btn-link" onclick="cancelBatch('${b.request_id}')">Cancel</button>
      </div>
    </article>`;
}

function activityDoneHtml(b) {
  return `
    <div class="act-row">
      <span class="act-mark act-mark-sm" aria-hidden="true">${cbInitial(b.companies?.[0] || b.company)}</span>
      <div class="act-row-main">
        <div class="act-row-company">${b.company}</div>
        <div class="act-row-feature">${b.feature}</div>
        <div class="act-row-note">Completed ${fmtDate(b.date)}</div>
      </div>
      ${b.has_report
        ? `<a class="act-row-action" href="#feature-report/${encodeURIComponent(b.request_id)}">View report<span aria-hidden="true"> →</span></a>`
        : `<span class="act-row-action muted">Report generating…</span>`}
    </div>`;
}

function activityFailedHtml(b) {
  const item = b.items.find(i => FAILURE_STAGES.has(i.stage)) || b.items[0] || {};
  return `
    <div class="act-row">
      <span class="act-mark act-mark-sm act-mark-error" aria-hidden="true">${cbInitial(b.companies?.[0] || b.company)}</span>
      <div class="act-row-main">
        <div class="act-row-company">${b.company}</div>
        <div class="act-row-feature">${b.feature}</div>
        <div class="act-row-note act-row-note-error">${STAGE_LABELS[item.stage] || 'Could not complete this benchmark'}</div>
      </div>
      <button class="btn-link act-row-action" onclick="retryBenchmark('${b.request_id}','${item.slug || ''}')">Retry</button>
    </div>`;
}

function activityGroupHtml(title, rows) {
  if (!rows.length) return '';
  return `
    <section class="act-group">
      <div class="act-group-head"><h2 class="act-group-title">${title}</h2><span class="act-group-count">${rows.length}</span></div>
      <div class="act-group-body">${rows.join('')}</div>
    </section>`;
}

async function renderActivity() {
  setTitle('Activity');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);
  clearInterval(_queue_poll_timer);

  let benchmarks = await getCurrentBenchmarks(true);

  function draw() {
    const running = benchmarks.filter(b => b.status === 'in_progress' && !b.items.some(i => FAILURE_STAGES.has(i.stage)));
    const failed = benchmarks.filter(b => b.items.some(i => FAILURE_STAGES.has(i.stage)));
    const done = benchmarks
      .filter(b => b.status === 'complete')
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 12);

    const el = document.getElementById('activity-body');
    if (!el) return;
    if (running.length + failed.length + done.length === 0) {
      el.innerHTML = cbEmptyStateHtml('Start a benchmark and its progress will show up here.');
      return;
    }
    el.innerHTML =
      activityGroupHtml('Running', running.map(activityRunningHtml)) +
      activityGroupHtml('Recently completed', done.map(activityDoneHtml)) +
      activityGroupHtml('Needs attention', failed.map(activityFailedHtml));
  }

  setContent(`
    <div class="activity">
      <h1 class="page-title">Activity</h1>
      <div id="activity-body"></div>
    </div>`);
  draw();

  const hasActive = () => benchmarks.some(b => b.items.some(i => isItemActive(i.stage)));
  if (hasActive()) {
    _queue_poll_timer = setInterval(async () => {
      try {
        benchmarks = await getCurrentBenchmarks(true);
        draw();
        await initSidebar();
        if (!hasActive()) clearInterval(_queue_poll_timer);
      } catch { clearInterval(_queue_poll_timer); }
    }, 2000);
  }
}

window.cancelBatch = async function(requestId) {
  if (!(await showConfirmModal('Cancel this benchmark? This cannot be undone.', { title: 'Cancel benchmark', confirmLabel: 'Cancel benchmark' }))) return;
  try {
    await api.post(`/api/requests/${requestId}/cancel`, {});
    await renderActivity();
    await initSidebar();
  } catch (e) {
    showAlertModal(e.message || 'Could not cancel this benchmark.');
  }
};

// Re-runs a failed benchmark item through the same PATCH the wizard uses to
// kick off a run — no new backend behaviour.
window.retryBenchmark = async function(requestId, slug) {
  if (!slug) return;
  try {
    await api.patch(`/api/requests/${requestId}/items/${slug}`, { stage: 'preparing' });
    _current_benchmarks = null;
    await renderActivity();
    await initSidebar();
    showToast('Benchmark restarted.');
  } catch (e) {
    showAlertModal(e.message || 'Could not restart this benchmark.');
  }
};

// ─── Benchmark Details Modal ──────────────────────────────────────────────────
// Read-only: the product runs benchmarks automatically now (see
// wizardSubmit()), so there is no separate manual "start" action left to
// surface here — this is purely a status/result view.
window.openBenchmarkDetailsModal = async function(requestId, slug) {
  const { requests } = await getRequests();
  const request = requests.find(r => r.id === requestId);
  const item = request?.items.find(i => i.slug === slug);
  if (!request || !item) return;

  const scopeText = (request.scope || []).join(', ') || 'End-to-End Journey';
  const statusText = (request.status || '').replace('_', ' ');
  const stageLabel = STAGE_LABELS[item.stage] || item.stage;
  const timeLabel = item.started_at ? 'Started' : 'Created';
  const timeValue = item.started_at ? new Date(item.started_at).toLocaleString() : new Date(request.created_at).toLocaleString();
  // Only a Feature Benchmark request has a real generated report to open
  // (02_Benchmark_Repository/_Feature_Benchmarks/<slug>/<requestId>.md, via
  // renderFeatureReport()) — anything else (e.g. Complete Journey) keeps its
  // prior behavior of linking into the filtered Library, unchanged.
  const reportLink = item.stage === 'completed'
    ? (request.benchmark_type === 'Feature Benchmark'
        ? `<div class="wizard-review-row"><label>Result</label><span class="value"><a href="#feature-report/${encodeURIComponent(request.id)}" onclick="closeModal()">View report →</a></span></div>`
        : `<div class="wizard-review-row"><label>Result</label><span class="value"><a href="#benchmarks?feature=${encodeURIComponent(request.feature)}" onclick="closeModal()">View report →</a></span></div>`)
    : '';

  openModal(`
    <div class="modal-header">
      <div class="modal-title">Benchmark Details</div>
      <div class="modal-close" role="button" tabindex="0" aria-label="Close dialog" onclick="closeModal()">✕</div>
    </div>
    <div class="modal-body">
      <div class="wizard-review-row"><label>Company</label><span class="value">${item.name}</span></div>
      <div class="wizard-review-row"><label>Feature</label><span class="value">${request.feature}</span></div>
      <div class="wizard-review-row"><label>Scope</label><span class="value">${scopeText}</span></div>
      <div class="wizard-review-row"><label>Status</label><span class="value">${statusText}</span></div>
      <div class="wizard-review-row"><label>${timeLabel}</label><span class="value">${timeValue}</span></div>
      <div class="wizard-review-row"><label>Current stage</label><span class="value">${stageLabel}</span></div>
      ${reportLink}
    </div>
  `);
};

// ─── Archive (a tab inside Benchmarks) ───────────────────────────────────────
// Legacy research and experiments — reachable, but not competing with the
// current product. Nothing here is deleted.
const ARCHIVE_DEV_ARTIFACT_RE =
  /\b(sprint\s*\d+|verification|throwaway|debug|evidence test|smoke test|safe to (interrupt|cancel|ignore))\b/i;

function isLegacyRequest(r) {
  if (r.benchmark_type !== 'Feature Benchmark') return true;
  if (r.cancelled || r.status === 'cancelled') return true;
  return ARCHIVE_DEV_ARTIFACT_RE.test(`${r.feature || ''} ${r.notes || ''}`);
}

async function archiveContentHtml() {
  const [benchmarks, hpData, requestsData] = await Promise.all([
    getBenchmarks().catch(() => []),
    api.get('/api/homepage-benchmarks').catch(() => ({ items: [] })),
    getRequests(true).catch(() => ({ requests: [] })),
  ]);
  const legacyResearch = (benchmarks || []).filter(b => b.status === 'complete');
  const pending = (benchmarks || []).filter(b => b.status === 'pending');
  const homepageExp = hpData.items || [];
  const legacyRequests = (requestsData.requests || []).filter(isLegacyRequest);

  const total = legacyResearch.length + homepageExp.length + legacyRequests.length + pending.length;
  if (total === 0) {
    return `<div class="empty-state"><h3>Nothing archived</h3><p>Legacy research and experiments would appear here.</p></div>`;
  }

  const rowLink = (href, title, sub, meta) => `
    <a class="cb-row cb-row-link" href="${href}">
      <div class="cb-row-main">
        <div class="cb-row-company">${title}</div>
        <div class="cb-row-meta">${sub}${meta ? ` · ${meta}` : ''}</div>
      </div>
      <span class="cb-row-action">Open →</span>
    </a>`;

  const group = (title, sub, body, n) => !n ? '' : `
    <section class="arc-group">
      <h2 class="arc-group-title">${title}</h2>
      <p class="arc-group-sub">${sub}</p>
      ${body}
    </section>`;

  return `
    <div class="archive-banner">
      <strong>Legacy Research &amp; Historical work.</strong>
      Not part of the current automated benchmark workflow — kept for reference.
    </div>
    ${group('Legacy research',
      'Full journey studies of Mindtrip, Trip.com, Booking.com and ixigo.',
      `<div class="cb-list">${legacyResearch.map(b => rowLink(`#company/${b.slug}`, b.name, `${b.category} research`, fmtDate(b.date))).join('')}</div>`,
      legacyResearch.length)}
    ${group('Homepage experiments',
      'Early homepage-only scans of airline sites.',
      `<div class="cb-list">${homepageExp.map(h => rowLink('#homepage-benchmarks', h.website_name || h.slug, 'Homepage experiment', fmtDate(h.benchmark_timestamp))).join('')}</div>`,
      homepageExp.length)}
    ${group('Historical requests',
      'Old, cancelled, or internal test runs.',
      `<div class="cb-list">${legacyRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(r => `
        <div class="cb-row">
          <div class="cb-row-main">
            <div class="cb-row-company">${r.feature || '—'}</div>
            <div class="cb-row-meta">${r.benchmark_type} · ${(r.items || []).map(i => i.name).join(', ') || '—'} · ${fmtDate(r.created_at)}</div>
          </div>
          <span class="status-pill">${(r.status || '').replace('_', ' ') || 'unknown'}</span>
        </div>`).join('')}</div>`,
      legacyRequests.length)}
    ${group('Planned, never run',
      'Companies in the old research plan that were never benchmarked.',
      `<div class="cb-list">${pending.map(b => `
        <div class="cb-row">
          <div class="cb-row-main"><div class="cb-row-company">${b.name}</div><div class="cb-row-meta">${b.category}</div></div>
          <span class="status-pill">planned</span>
        </div>`).join('')}</div>`,
      pending.length)}
  `;
}

// ─── Page: Benchmarks ───────────────────────────────────────────────────────
// A content library: Current (only /api/current-benchmarks) and Archive
// (legacy). No KPI tiles, no analytics — each benchmark reads as a document.
async function renderBenchmarks(query) {
  setTitle('Benchmarks');
  const tab = query?.get('tab') === 'archive' ? 'archive' : 'current';
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const benchmarks = await getCurrentBenchmarks(true);

  function tabsHtml() {
    return `
      <div class="lib-tabs" role="tablist">
        <a href="#benchmarks" class="lib-tab ${tab === 'current' ? 'active' : ''}" role="tab" aria-selected="${tab === 'current'}">Current</a>
        <a href="#benchmarks?tab=archive" class="lib-tab ${tab === 'archive' ? 'active' : ''}" role="tab" aria-selected="${tab === 'archive'}">Archive</a>
      </div>`;
  }

  if (tab === 'archive') {
    setContent(`
      <div class="lib">
        <h1 class="page-title">Benchmarks</h1>
        ${tabsHtml()}
        <div id="lib-body"><div class="loading-state"><div class="spinner"></div></div></div>
      </div>`);
    document.getElementById('lib-body').innerHTML = await archiveContentHtml();
    return;
  }

  if (benchmarks.length === 0) {
    setContent(`
      <div class="lib">
        <h1 class="page-title">Benchmarks</h1>
        ${tabsHtml()}
        ${cbEmptyStateHtml('Every benchmark you run and its report will appear here.')}
      </div>`);
    return;
  }

  function draw() {
    const q = _library_filters.q.trim().toLowerCase();
    let list = benchmarks.filter(b => !q || `${b.company} ${b.feature}`.toLowerCase().includes(q));
    list.sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
      return _library_filters.sort === 'oldest' ? -d : d;
    });
    const el = document.getElementById('lib-body');
    if (!el) return;
    el.innerHTML = list.length
      ? `<div class="lib-count">${list.length} benchmark${list.length === 1 ? '' : 's'}</div>${cbListHtml(list)}`
      : `<div class="empty-state"><h3>No matches</h3><p>Nothing matches “${_library_filters.q}”.</p></div>`;
  }

  window.libraryFilterSet = function(key, value) { _library_filters[key] = value; draw(); };

  setContent(`
    <div class="lib">
      <h1 class="page-title">Benchmarks</h1>
      ${tabsHtml()}
      <div class="lib-controls">
        <input type="text" class="form-input lib-search" placeholder="Search company or feature…" value="${_library_filters.q}" oninput="libraryFilterSet('q', this.value)" aria-label="Search benchmarks" />
        <select class="form-select lib-sort" onchange="libraryFilterSet('sort', this.value)" aria-label="Sort by date">
          <option value="newest"${_library_filters.sort !== 'oldest' ? ' selected' : ''}>Newest first</option>
          <option value="oldest"${_library_filters.sort === 'oldest' ? ' selected' : ''}>Oldest first</option>
        </select>
      </div>
      <div id="lib-body"></div>
    </div>`);
  draw();
}

// ─── Page: Feature Benchmark Report ───────────────────────────────────────────
// Reached via #feature-report/<requestId> — from the Benchmark Details modal's
// "View report →" link and from a completed card in renderFeatureSection()
// above; both funnel into this one view, per fb.request_id as the stable UI
// identifier (fb.path is only ever used here, after locating the benchmark,
// to fetch its markdown — never as the identifier itself). Renders the
// actual report the Feature Benchmark pipeline already wrote to disk —
// does not regenerate or duplicate its content.
const BACK_TO_LIBRARY_LINK = `<a href="#benchmarks" class="report-back"><span aria-hidden="true">← </span>Back to Benchmarks</a>`;

// Presentation only — never alters the generated findings. Takes the HTML
// marked() produced from the report markdown and:
//   1. drops the leading heading(s) that just repeat the company/feature the
//      page header already shows (so nothing is stacked 3-deep);
//   2. drops the duplicate "Evidence source / Feature found / Benchmarked at"
//      key-value block (also already in the header);
//   3. tags provenance lines (Journey step / URL captured / Evidence),
//      confidence notes, caveats and bold mini-headings so CSS can style them
//      as a research memo rather than raw markdown.
function enhanceReportHtml(rawHtml, { company, feature }) {
  let root;
  try {
    root = document.createElement('div');
    root.innerHTML = rawHtml;
  } catch { return `<div class="report-body">${rawHtml}</div>`; }

  const norm = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const names = norm(company).split(/,\s*/).filter(Boolean);
  const featN = norm(feature);
  const isDupHeading = el => {
    if (!/^H[1-3]$/.test(el.tagName)) return false;
    const t = norm(el.textContent);
    if (!t) return true;
    if (t.startsWith('feature benchmark')) return true;
    if (t === featN || t === `${featN} benchmark`) return true;
    if (names.includes(t)) return true;
    return names.some(n => n && (t === n || t.startsWith(n + ' —') || t.startsWith(n + ' -') || t.startsWith(n + ' –') || t.startsWith(n + ' benchmark')));
  };
  const isDupMeta = el => el.tagName === 'P' && /(evidence source|feature found|benchmarked at)\s*:/i.test(el.textContent) && !/journey step|url (captured|attempted)/i.test(el.textContent);
  const isHeading = el => /^H[1-3]$/.test(el.tagName);
  const restatesFeature = el => featN && new RegExp(`[—–-]\\s*${featN}\\b|\\(${featN}\\b`).test(norm(el.textContent));

  // Trim the duplicative lead-in the page header already shows: the
  // "Feature Benchmark — X" title, the per-company "## Company" heading and
  // its key-value block, and a "Company — Feature (…)" restatement.
  let guard = 10;
  while (root.firstElementChild && guard-- > 0) {
    const el = root.firstElementChild;
    if (el.tagName === 'HR' || isDupHeading(el) || isDupMeta(el)) { el.remove(); continue; }
    if (isHeading(el) && el.nextElementSibling && isDupMeta(el.nextElementSibling)) { el.remove(); continue; }
    if (isHeading(el) && restatesFeature(el)) { el.remove(); continue; }
    break;
  }

  [...root.children].forEach((el, i) => {
    if (el.tagName === 'P') {
      const strongs = el.querySelectorAll(':scope > strong');
      const onlyStrong = strongs.length && norm(el.textContent) === norm(strongs[0].textContent) && el.textContent.length <= 44;
      const lead = norm(strongs[0]?.textContent || el.textContent);
      if (onlyStrong) { el.classList.add('report-minihead'); return; }
      if (/journey step|url (captured|attempted)|feature actually captured|evidence:/i.test(el.textContent) && el.querySelector('strong')) {
        el.classList.add('report-provenance'); return;
      }
      if (/^confidence\b/.test(lead)) { el.classList.add('report-callout', 'report-callout-muted'); return; }
      if (/^(note|caveat|important|conclusion)\b/.test(lead)) { el.classList.add('report-callout'); return; }
      const prev = el.previousElementSibling;
      if (prev && /^H[2-3]$/.test(prev.tagName) && /caveat|conclusion|out of scope/i.test(prev.textContent)) {
        el.classList.add('report-callout');
      }
    }
  });

  return `<div class="report-body">${root.innerHTML}</div>`;
}

// Pulls the machine-readable target marker + "Benchmarked at" line the
// report writer embeds, so the Evidence block can show the exact captured
// URL and capture time without a second API call.
function parseReportMeta(rawMarkdown) {
  const md = rawMarkdown || '';
  const marker = md.match(/<!--\s*benchmark-target:(.*?)-->/s);
  const fields = {};
  if (marker) {
    for (const part of marker[1].split('|')) {
      const m = part.split('=');
      if (m.length >= 2) fields[m[0].trim()] = m.slice(1).join('=').trim();
    }
  }
  const capturedAt = (md.match(/\*\*Benchmarked at:\*\*\s*([0-9T:.\-Z]+)/) || [])[1] || null;
  const featureFound = /\*\*Feature found:\*\*\s*Yes/i.test(md);
  return { capturedUrl: fields.url || null, capturedAt, featureFound };
}

// The Evidence section — the actual captured screenshot, served from the
// private app endpoint (never public R2), clickable to enlarge, with a
// meaningful alt label. Rendered only when real evidence exists.
function evidenceBlockHtml({ evidence, company, feature, meta }) {
  const shot = (evidence?.screenshots || [])[0];
  if (!shot) return '';
  const label = `${feature}${meta.featureFound ? ' · Direct observation' : ' · Base-page observation'}`;
  const alt = `Captured screenshot of ${company || 'the site'} — ${feature}${meta.featureFound ? '' : ' (homepage / base page)'}`;
  const captionBits = [];
  captionBits.push(`<span class="report-ev-label">${escapeHtml(label)}</span>`);
  if (meta.capturedUrl) {
    captionBits.push(`<span class="report-ev-meta">Captured URL <a href="${escapeAttr(meta.capturedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(meta.capturedUrl)}</a></span>`);
  }
  if (meta.capturedAt) {
    captionBits.push(`<span class="report-ev-meta">Captured ${escapeHtml(fmtDate(meta.capturedAt))}</span>`);
  }
  const imgUrl = shot.url;
  const enlargeName = `${company || ''} — ${feature}`.trim();
  return `
    <section class="report-evidence" aria-labelledby="report-evidence-h">
      <h2 id="report-evidence-h" class="report-evidence-h">Evidence</h2>
      <figure class="report-ev-fig">
        <button type="button" class="report-ev-btn" aria-label="Enlarge captured screenshot"
          onclick="openLightbox('${escapeAttr(imgUrl)}', ${JSON.stringify(enlargeName)})">
          <img class="report-ev-img" src="${escapeAttr(imgUrl)}" alt="${escapeAttr(alt)}" loading="lazy">
        </button>
        <figcaption class="report-ev-cap">${captionBits.join('')}</figcaption>
      </figure>
    </section>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

async function renderFeatureReport(requestId) {
  setTitle('Report');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  // Prefer the current-benchmark record (carries company/feature/scope/date
  // in the customer-facing model); fall back to the raw feature-benchmarks
  // listing for the report file path.
  const [currentData, featureData] = await Promise.all([
    getCurrentBenchmarks().catch(() => []),
    api.get('/api/feature-benchmarks').catch(() => ({ items: [] })),
  ]);
  const cb = (currentData || []).find(b => b.request_id === requestId);
  const fb = (featureData.items || []).find(i => i.request_id === requestId);
  const reportPath = cb?.report_path || fb?.path;

  if (!cb && !fb) {
    setContent(`
      <div class="report">
        ${BACK_TO_LIBRARY_LINK}
        <div class="empty-state"><h3>Report not found</h3><p>No benchmark report exists for this request.</p></div>
      </div>`);
    return;
  }

  const properFeature = cb?.feature || fb?.request?.feature;
  const feature = properFeature
    || (fb?.feature_slug || '—').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const company = cb?.company || (fb?.request?.items || []).map(i => i.name).join(', ') || '';
  const scope = cb?.scope || (fb?.request?.scope?.length ? fb.request.scope : ['End-to-End Journey']);
  const date = cb?.date || fb?.request?.created_at || null;

  let reportBodyHtml;
  let reportMeta = { capturedUrl: null, capturedAt: null, featureFound: false };
  if (!reportPath) {
    reportBodyHtml = `<div class="empty-state"><h3>Report is still being generated</h3><p>Check back once the run finishes — follow it in Activity.</p></div>`;
  } else {
    try {
      const r = await api.get(`/api/markdown?path=${encodeURIComponent(reportPath)}`);
      reportMeta = parseReportMeta(r.content);
      reportBodyHtml = enhanceReportHtml(marked.parse(r.content), { company, feature });
    } catch (e) {
      reportBodyHtml = `<div class="empty-state"><h3>Report file is unavailable.</h3></div>`;
    }
  }

  // Evidence lives in the private app endpoint, backed by R2 — so it stays
  // visible after a Render restart. Failure here must not break the report.
  let evidence = null;
  try {
    evidence = await api.get(`/api/evidence/${encodeURIComponent(requestId)}`);
  } catch (e) { evidence = null; }
  const evidenceHtml = evidenceBlockHtml({ evidence, company, feature, meta: reportMeta });

  const metaBits = [(scope || []).join(', '), date ? fmtDate(date) : null].filter(Boolean);

  setContent(`
    <article class="report">
      ${BACK_TO_LIBRARY_LINK}
      <header class="report-head">
        <div class="report-kicker">Benchmark report</div>
        <h1 class="report-title">${company && company !== '—' ? company : feature}</h1>
        ${company && company !== '—' ? `<div class="report-subject">${feature}</div>` : ''}
        <div class="report-meta">${metaBits.join('  ·  ')}</div>
      </header>
      ${evidenceHtml}
      ${reportBodyHtml}
    </article>`);
}

// ─── Page: Homepage Benchmarks ────────────────────────────────────────────────
const CONFIDENCE_BADGE = { high: 'badge-green', medium: 'badge-yellow', low: 'badge-red' };
let _homepage_benchmarks_cache = [];

// Run panel state: select airlines -> Start -> live progress. Nothing here
// requires a manual prompt — Start fires the real parallel Scheduler
// immediately and the panel polls its own progress until done.
let _hb_airlines_cache = [];
let _hb_selected = new Set();
let _hb_active_run = null;
let _hb_poll_timer = null;
let _hb_starting = false;

function hbStageBadgeClass(job) {
  if (job.status === 'succeeded') return 'succeeded';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'retrying') return 'retrying';
  if (job.status === 'running') return 'running';
  return 'queued';
}

function hbStageLabel(job) {
  const STAGE_TEXT = {
    queued: 'Queued', antibot_probe: 'Checking access…', discovery: 'Discovery', screenshot: 'Screenshot',
    analysis: 'AI Vision Analysis', report: 'Writing report', done: 'Done',
  };
  if (job.status === 'succeeded') return `Succeeded — ${job.result?.mdPath ? 'report saved' : 'done'}`;
  if (job.status === 'failed') return `Failed after ${job.attempts} attempt${job.attempts === 1 ? '' : 's'}`;
  if (job.status === 'retrying') return `Retrying (attempt ${job.attempts + 1} next)`;
  if (job.status === 'queued') return 'Queued';
  const stage = String(job.stage || '');
  if (stage.startsWith('antibot_probe')) return 'Checking access…';
  return STAGE_TEXT[stage] || stage || 'Running…';
}

function hbAirlineRowHtml(a) {
  const checked = _hb_selected.has(a.slug);
  const statusText = a.already_benchmarked
    ? `✓ Benchmarked ${a.last_benchmarked_at ? new Date(a.last_benchmarked_at).toLocaleDateString() : ''}`
    : 'Not yet benchmarked';
  return `
    <label class="hb-airline-row ${checked ? 'checked' : ''}" onclick="event.preventDefault(); hbToggleAirline('${a.slug}')">
      <input type="checkbox" ${checked ? 'checked' : ''} readonly />
      <div>
        <div class="hb-airline-row-name">${a.name}</div>
        <div class="hb-airline-row-status">${statusText}</div>
      </div>
    </label>`;
}

function hbProgressPanelHtml(run) {
  const rows = (run.jobs || []).map((job) => `
    <div class="hb-progress-row">
      <div class="hb-progress-row-name">${job.job.companyName}</div>
      <div class="hb-progress-row-bar">${scoreBar(
        job.status === 'succeeded' ? 5 : job.status === 'failed' ? 5 : job.status === 'queued' ? 0 : 2.5,
        5,
        job.status === 'succeeded' ? '#22c55e' : job.status === 'failed' ? '#ef4444' : job.status === 'queued' ? '#5a6480' : '#3b82f6',
      )}</div>
      <div class="hb-progress-row-stage">
        <span class="hb-stage-badge ${hbStageBadgeClass(job)}">${job.status}</span>
        <span>${hbStageLabel(job)}</span>
      </div>
    </div>`).join('');

  const succeeded = (run.jobs || []).filter((j) => j.status === 'succeeded').length;
  const failed = (run.jobs || []).filter((j) => j.status === 'failed').length;
  const total = (run.jobs || []).length;

  return `
    <div class="hb-run-progress">
      <div class="hb-run-progress-list">${rows}</div>
      <div class="hb-run-summary">
        ${run.complete
          ? `Batch complete — ${succeeded}/${total} succeeded${failed ? `, ${failed} failed` : ''}.`
          : `Running… ${succeeded + failed}/${total} finished so far.`}
      </div>
    </div>`;
}

async function hbRenderRunPanel() {
  const panel = document.getElementById('hb-run-panel-body');
  if (!panel) return;

  const airlineList = `
    <div class="hb-airline-list">${_hb_airlines_cache.map(hbAirlineRowHtml).join('')}</div>
    <div class="hb-run-panel-actions">
      <button class="btn btn-primary" onclick="hbStartBenchmark()" ${_hb_starting || _hb_selected.size === 0 ? 'disabled' : ''}>
        ${_hb_starting ? 'Starting…' : `Start Benchmark (${_hb_selected.size} selected)`}
      </button>
      <button class="btn-link" onclick="hbSelectAll()">Select all</button>
      <button class="btn-link" onclick="hbSelectNone()">Clear</button>
    </div>`;

  const progress = _hb_active_run ? hbProgressPanelHtml(_hb_active_run) : '';
  panel.innerHTML = airlineList + progress;
}

window.hbToggleAirline = function (slug) {
  if (_hb_selected.has(slug)) _hb_selected.delete(slug); else _hb_selected.add(slug);
  hbRenderRunPanel();
};
window.hbSelectAll = function () {
  _hb_airlines_cache.forEach((a) => _hb_selected.add(a.slug));
  hbRenderRunPanel();
};
window.hbSelectNone = function () {
  _hb_selected.clear();
  hbRenderRunPanel();
};

window.hbStartBenchmark = async function () {
  if (_hb_selected.size === 0 || _hb_starting) return;
  _hb_starting = true;
  hbRenderRunPanel();

  try {
    const { runId } = await api.post('/api/homepage-benchmarks/run', { slugs: [..._hb_selected] });
    _hb_active_run = { runId, jobs: [], complete: false };
    hbPollRun(runId);
  } catch (err) {
    // A 409 (already running) still gives us a runId to attach to instead of failing silently.
    const match = /runId["\s:]+["']?([\w-]+)/.exec(err.message);
    if (match) {
      _hb_active_run = { runId: match[1], jobs: [], complete: false };
      hbPollRun(match[1]);
    } else {
      showAlertModal(err.message || 'Could not start the benchmark.');
    }
  } finally {
    _hb_starting = false;
    hbRenderRunPanel();
  }
};

function hbPollRun(runId) {
  clearInterval(_hb_poll_timer);
  const tick = async () => {
    try {
      const run = await api.get(`/api/homepage-benchmarks/run/${runId}`);
      _hb_active_run = run;
      hbRenderRunPanel();
      if (run.complete) {
        clearInterval(_hb_poll_timer);
        // Refresh the results grid below with whatever just finished.
        const data = await api.get('/api/homepage-benchmarks');
        _homepage_benchmarks_cache = data.items || [];
        const grid = document.getElementById('hb-results-grid');
        if (grid) grid.outerHTML = hbResultsGridHtml(_homepage_benchmarks_cache);
      }
    } catch {
      clearInterval(_hb_poll_timer);
    }
  };
  tick();
  _hb_poll_timer = setInterval(tick, 2000);
}

function hbResultsGridHtml(items) {
  if (items.length === 0) {
    return `<div class="empty-state" id="hb-results-grid"><div class="empty-icon">⌂</div><h3>No homepage benchmarks yet</h3><p>Select airlines above and click Start.</p></div>`;
  }
  return `<div class="card-grid hb-grid" id="hb-results-grid">${items.map(homepageBenchmarkCardHtml).join('')}</div>`;
}

function homepageBenchmarkCardHtml(item) {
  const analysis = item.ai_ux_analysis;
  const summary = analysis ? analysis.first_impression : (item.ai_ux_analysis_error || 'AI analysis not available for this run.');
  const strengths = analysis?.top_5_ux_strengths || [];
  const opportunities = analysis?.top_5_ux_improvement_opportunities || [];
  const lastAnalyzed = item.benchmark_timestamp ? new Date(item.benchmark_timestamp).toLocaleString() : '—';

  return `
    <div class="card hb-card">
      <div class="hb-card-header">
        <div>
          <div class="hb-card-name">${item.website_name || item.slug}</div>
          <a class="hb-card-url" href="${item.url}" target="_blank" rel="noopener">${item.url || ''}</a>
        </div>
        ${badge(item.confidence || '—', CONFIDENCE_BADGE[item.confidence] || 'badge-gray')}
      </div>

      ${item.screenshot_url
        ? `<div class="hb-screenshot" onclick="openLightbox('${item.screenshot_url}','${item.website_name || item.slug}')">
             <img src="${item.screenshot_url}" alt="${item.website_name || item.slug} homepage" loading="lazy" />
           </div>`
        : `<div class="hb-screenshot hb-screenshot-empty">No screenshot</div>`}

      <div class="hb-block">
        <div class="hb-block-label">AI Summary</div>
        <p class="hb-summary-text">${summary}</p>
      </div>

      <div class="hb-columns">
        <div>
          <div class="hb-block-label">Top 5 Strengths</div>
          <ul class="hb-list">${strengths.map(s => `<li>${s}</li>`).join('') || '<li class="text-3">—</li>'}</ul>
        </div>
        <div>
          <div class="hb-block-label">Top 5 Opportunities</div>
          <ul class="hb-list">${opportunities.map(s => `<li>${s}</li>`).join('') || '<li class="text-3">—</li>'}</ul>
        </div>
      </div>

      <div class="hb-card-footer">
        <div class="text-2" style="font-size:11px">Last analyzed: ${lastAnalyzed}</div>
        <button class="btn btn-primary" onclick="openHomepageFullReport('${item.slug}')">Open Full Report</button>
      </div>
    </div>`;
}

window.openHomepageFullReport = async function(slug) {
  const item = _homepage_benchmarks_cache.find(i => i.slug === slug);
  if (!item) return;

  openModal(`
    <div class="modal-header">
      <div class="modal-title">${item.website_name || item.slug} — Full Report</div>
      <div class="modal-close" role="button" tabindex="0" aria-label="Close dialog" onclick="closeModal()">✕</div>
    </div>
    <div class="modal-body" id="hb-report-modal-body">
      <div class="loading-state"><div class="spinner"></div></div>
    </div>`, { wide: true });

  try {
    const r = await api.get(`/api/markdown?path=${encodeURIComponent(item.report_md_path)}`);
    document.getElementById('hb-report-modal-body').innerHTML = `<div class="md-content">${marked.parse(r.content)}</div>`;
  } catch {
    document.getElementById('hb-report-modal-body').innerHTML = `<div class="text-2">Could not load the full report.</div>`;
  }
};

async function renderHomepageBenchmarks() {
  setTitle('Homepage Benchmark');
  setTopbarActions('');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  clearInterval(_hb_poll_timer);
  _hb_active_run = null;

  let items = [];
  let airlines = [];
  try {
    const [hbData, airlinesData] = await Promise.all([
      api.get('/api/homepage-benchmarks'),
      api.get('/api/homepage-benchmarks/airlines'),
    ]);
    items = hbData.items || [];
    airlines = airlinesData.items || [];
  } catch {
    setContent(`<div class="empty-state"><h3>Could not load Homepage Benchmark</h3></div>`);
    return;
  }

  _homepage_benchmarks_cache = items;
  _hb_airlines_cache = airlines;
  _hb_selected = new Set(airlines.filter((a) => !a.already_benchmarked).map((a) => a.slug));

  // Reattach to a run already in flight (e.g. started before a page reload)
  // instead of showing an empty selector as if nothing were happening.
  try {
    const current = await api.get('/api/homepage-benchmarks/run/current');
    if (current.runId) {
      _hb_active_run = current;
      if (!current.complete) hbPollRun(current.runId);
    }
  } catch { /* no active run — normal case */ }

  setContent(`
    <div class="hb-run-panel">
      <div class="hb-run-panel-header">
        <div>
          <div class="section-title">Homepage Benchmark</div>
          <div class="section-sub">Select airlines, click Start. Discovery, screenshot, and AI Vision analysis run in parallel — results appear below as each one finishes.</div>
        </div>
      </div>
      <div id="hb-run-panel-body"></div>
    </div>

    <div class="section-header">
      <div>
        <div class="section-title">Results</div>
        <div class="section-sub">${items.length} homepage${items.length === 1 ? '' : 's'} analyzed — Discovery + GPT Vision UX Analysis</div>
      </div>
    </div>
    ${hbResultsGridHtml(items)}
  `);

  hbRenderRunPanel();
}

// ─── Page: Company Detail ─────────────────────────────────────────────────────
async function renderCompany(slug, tab) {
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  let co;
  try { co = await api.get(`/api/company/${slug}`); }
  catch {
    setTitle('Company Not Found');
    setTopbarActions('');
    setContent(`<div class="empty-state"><div class="empty-icon">⚠</div><h3>Company not found</h3><p>Slug: ${slug}</p></div>`);
    return;
  }

  const plan = co.plan || {};
  const data = co.company_data || {};
  const meta = data.meta || {};
  const overview = data.overview || {};
  const scores = data.innovation_scores || {};
  const jScores = data.journey_scores || {};

  // Benchmark ranking + step extremes (uses cached getBenchmarks())
  const allBenchmarks = await getBenchmarks();
  const completeBenchmarks = allBenchmarks.filter(b => b.status === 'complete');
  const sortedByScore = [...completeBenchmarks].sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0));
  const rank = sortedByScore.findIndex(b => b.slug === slug) + 1;
  const applicableSteps = Object.entries(jScores)
    .filter(([, s]) => s && s.applicable !== false && s.score != null)
    .map(([key, s]) => ({ key, label: JOURNEY_STEP_LABELS[key] || key, score: s.score }));
  const bestStep = applicableSteps.length > 0
    ? applicableSteps.reduce((a, b) => a.score >= b.score ? a : b) : null;
  const worstStep = applicableSteps.length > 0
    ? applicableSteps.reduce((a, b) => a.score <= b.score ? a : b) : null;
  const rankInfo = { rank, total: completeBenchmarks.length, bestStep, worstStep };

  // Research status, difficulty, journey coverage, and benchmark history —
  // derived from metadata.json (already returned as `meta`) + live Benchmark_Requests items
  const { requests: allRequests } = await getRequests();
  const liveItem = allRequests.flatMap(r => r.items.map(i => ({ ...i, requestId: r.id, requestFeature: r.feature, requestType: r.benchmark_type })))
    .find(i => i.slug === slug && i.stage !== 'completed');

  const researchStatus = liveItem
    ? `In Progress — ${STAGE_LABELS[liveItem.stage] || liveItem.stage}`
    : plan.status === 'complete'
      ? (() => {
          const cs = co.meta?.completion_status || {};
          const total = Object.keys(cs).length;
          const done = Object.values(cs).filter(Boolean).length;
          return total ? `Complete — ${done}/${total} deliverables` : 'Complete';
        })()
      : 'Not Started';

  const difficulty = co.meta?.capture_method
    ? (/hybrid/i.test(co.meta.capture_method) ? 'Hard (Hybrid Research)' : 'Standard (Playwright)')
    : '—';

  const journeyCoverage = `${applicableSteps.length} / 12 steps`;

  const historyEvents = [];
  if (plan.status === 'complete') {
    historyEvents.push({ date: plan.date, label: `Complete Journey benchmark completed — score ${fmt(plan.overall_score)}` });
  }
  allRequests.forEach(r => {
    const item = r.items.find(i => i.slug === slug);
    if (item) historyEvents.push({ date: item.updated_at, label: `${r.benchmark_type}: ${r.feature} — ${STAGE_LABELS[item.stage] || item.stage}` });
  });
  historyEvents.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const extra = { researchStatus, difficulty, journeyCoverage, historyEvents };

  setTitle(meta.name || slug);
  setTopbarActions(`
    <button class="btn btn-ghost" onclick="presetComparison('${slug}')">⇄ Compare</button>
    ${meta.url ? `<a href="${meta.url}" target="_blank" rel="noopener" class="btn btn-ghost">↗ Visit Site</a>` : ''}
  `);

  const overallScore = plan.overall_score;

  const tabs = [
    { id: 'overview',     label: 'Overview' },
    { id: 'journey',      label: 'Journey (12 Steps)' },
    { id: 'screenshots',  label: `Screenshots (${meta.screenshots_count || 0})` },
    { id: 'ux_analysis',  label: 'UX Analysis' },
    { id: 'opportunities',label: 'Opportunities' },
  ];

  const header = `
    <div class="company-header">
      <div class="ch-score-block">
        <div class="ch-score" style="color:${scoreColor(overallScore)}" title="Average of Clarity, AI Sophistication, Personalization, Delight, and Innovation, across all 12 journey steps (out of 5.0).">${fmt(overallScore)}</div>
        <div class="ch-score-label">Overall Score</div>
        <div class="mt-2">${maturityBadge(overview.ai_maturity)}</div>
      </div>
      <div class="ch-info">
        <div class="ch-name">${meta.name || slug}</div>
        <div class="text-2" style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Tags</div>
        <div class="ch-badges">
          ${categoryBadge(meta.category)}
          ${maturityBadge(overview.ai_maturity)}
          ${overview.has_loyalty ? badge('Loyalty', 'badge-blue') : ''}
          ${overview.native_booking ? badge('Native Booking', 'badge-green') : ''}
          ${overview.b2b_platform ? badge('B2B Platform', 'badge-purple') : ''}
        </div>
        <div class="ch-meta-grid">
          <div class="ch-meta-item"><strong>Business Model</strong><br>${overview.business_model || '—'}</div>
          <div class="ch-meta-item"><strong>Scale</strong><br>${overview.funding_scale || '—'}</div>
          <div class="ch-meta-item tech-info"><strong>Benchmark</strong><br>${meta.benchmark_id || '—'} · ${meta.benchmark_date || '—'}</div>
          <div class="ch-meta-item"><strong>Patterns</strong><br>${meta.patterns_extracted || 0} extracted</div>
          <div class="ch-meta-item"><strong>Last Updated</strong><br>${meta.benchmark_date || '—'}</div>
          <div class="ch-meta-item"><strong>Difficulty</strong><br>${extra.difficulty}</div>
          <div class="ch-meta-item"><strong>Journey Coverage</strong><br>${extra.journeyCoverage}</div>
          <div class="ch-meta-item"><strong>Research Status</strong><br>${extra.researchStatus}</div>
        </div>
        ${rankInfo.rank > 0 ? `
        <div class="ch-rank-row">
          <div class="rank-item">
            <span class="rank-label">Rank</span>
            <span class="rank-value">#${rankInfo.rank} of ${rankInfo.total}</span>
          </div>
          ${rankInfo.bestStep ? `<div class="rank-item"><span class="rank-label">Best</span> <span class="rank-value" style="color:var(--green)">${rankInfo.bestStep.label} &middot; ${fmt(rankInfo.bestStep.score)}</span></div>` : ''}
          ${rankInfo.worstStep ? `<div class="rank-item"><span class="rank-label">Weakest</span> <span class="rank-value" style="color:var(--red)">${rankInfo.worstStep.label} &middot; ${fmt(rankInfo.worstStep.score)}</span></div>` : ''}
        </div>` : ''}
      </div>
      <div style="min-width:220px">
        ${radarChart(
          [{ values: INNOVATION_DIMS.map(d => scores[d.id] || 0) }],
          INNOVATION_DIMS.map(d => d.label),
          220
        )}
      </div>
    </div>`;

  // Sprint 27 (Priority 5): the single highest-signal finding (Executive
  // Recommendation) now renders directly under the header — visible
  // immediately regardless of which tab is open. Paired with a one-line
  // "jump to" row so a scanning reader knows exactly which tab holds the
  // fuller UX findings / opportunities list, instead of guessing among
  // unlabeled tab names.
  const execRecTop = executiveRecommendationHtml(co.meta?.executive_recommendation);
  const jumpRow = (co.has_ux_analysis || co.has_opportunities) ? `
    <div class="text-3 mb-4" style="font-size:12px">
      Full findings: ${co.has_ux_analysis ? `<a href="#company/${slug}/ux_analysis" class="btn-link" style="font-size:12px">UX Analysis →</a>` : ''}
      ${co.has_ux_analysis && co.has_opportunities ? ' &nbsp;·&nbsp; ' : ''}
      ${co.has_opportunities ? `<a href="#company/${slug}/opportunities" class="btn-link" style="font-size:12px">Top Opportunities →</a>` : ''}
    </div>` : '';

  const tabBar = `
    <div class="tab-bar">
      ${tabs.map(t => `<button class="tab-btn ${t.id === tab ? 'active' : ''}" onclick="switchTab('${slug}','${t.id}')">${t.label}</button>`).join('')}
    </div>`;

  let tabContent = '';
  switch (tab) {
    case 'overview':      tabContent = await renderTabOverview(co, data, scores, jScores, rankInfo, extra); break;
    case 'journey':       tabContent = await renderTabJourney(co, data, jScores); break;
    case 'screenshots':   tabContent = await renderTabScreenshots(slug); break;
    case 'ux_analysis':   tabContent = await renderTabUX(co); break;
    case 'opportunities': tabContent = await renderTabOpportunities(co); break;
    default:              tabContent = await renderTabOverview(co, data, scores, jScores);
  }

  setContent(header + execRecTop + jumpRow + tabBar + tabContent);
  setupLightbox();
}

window.switchTab = function(slug, tab) {
  navigate(`company/${slug}/${tab}`);
};

// ─── Company Tab: Overview ────────────────────────────────────────────────────
async function renderTabOverview(co, data, scores, jScores, rankInfo = {}, extra = {}) {
  const caps = data.ai_capabilities || {};
  const patterns = data.ux_patterns || {};

  const capRows = Object.entries(caps).map(([id, v]) => {
    const label = v.label || v.status;
    const c = v.status === 'present' ? 'var(--green)' : v.status === 'partial' ? 'var(--yellow)' : 'var(--red)';
    return `<tr>
      <td>${id.replace(/_/g,' ')}</td>
      <td style="color:${c}">${label}</td>
      <td>${v.notes || ''}</td>
    </tr>`;
  }).join('');

  const patternRows = Object.entries(patterns).map(([id, v]) => {
    const c = v.present ? (v.quality === 'strong' ? 'var(--green)' : 'var(--yellow)') : 'var(--red)';
    return `<tr>
      <td>${id.replace(/_/g,' ')}</td>
      <td style="color:${c}">${v.label}</td>
      <td>${v.notes || ''}</td>
    </tr>`;
  }).join('');

  // Journey summary bar
  const journeyBars = Object.entries(JOURNEY_STEP_LABELS).map(([key, label]) => {
    const s = jScores[key];
    if (!s) return '';
    const isNA = s.applicable === false;
    return `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:120px;font-size:11px;color:var(--text-2)">${label}</div>
        <div style="flex:1">${isNA ? '<span style="color:var(--text-3);font-size:11px">N/A</span>' : scoreBar(s.score)}</div>
        <div style="width:28px;text-align:right;font-size:12px;font-weight:700;color:${scoreColor(s.score)}">${isNA ? '—' : fmt(s.score)}</div>
      </div>`;
  }).join('');

  // Executive summary MD
  let summaryHtml = '';
  if (co.folder) {
    try {
      const r = await api.get(`/api/markdown?path=${encodeURIComponent(co.folder + '/01_executive_summary.md')}`);
      summaryHtml = `<div class="md-content">${marked.parse(r.content)}</div>`;
    } catch { summaryHtml = ''; }
  }

  return `
    ${summaryHtml ? `<div class="card mb-4">${summaryHtml}</div>` : ''}

    <div class="two-col-grid">
      <div class="card">
        <h3>Journey Score Breakdown</h3>
        <div class="mt-3">${journeyBars}</div>
      </div>

      <div>
        <div class="card mb-4">
          <h3>AI Capabilities</h3>
          <div class="matrix-table-wrap" style="max-height:260px;overflow-y:auto">
            <table class="matrix-table" style="white-space:normal">
              <thead><tr><th>Capability</th><th>Status</th><th>Notes</th></tr></thead>
              <tbody>${capRows}</tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>Benchmark History</h3>
          <div class="space-y mt-3">
            ${(extra.historyEvents || []).map(e => `
              <div class="text-sm">${e.label}<div class="text-2" style="font-size:11px">${e.date ? new Date(e.date).toLocaleString() : '—'}</div></div>
            `).join('') || '<div class="text-2 text-sm">No history yet.</div>'}
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>UX Patterns</h3>
      <div class="matrix-table-wrap">
        <table class="matrix-table" style="white-space:normal">
          <thead><tr><th>Pattern</th><th>Present</th><th>Notes</th></tr></thead>
          <tbody>${patternRows}</tbody>
        </table>
      </div>
    </div>`;
}

// ─── Company Tab: Journey ─────────────────────────────────────────────────────
async function renderTabJourney(co, data, jScores) {
  const cards = Object.entries(JOURNEY_STEP_LABELS).map(([key, label]) => {
    const s = jScores[key] || {};
    const isNA = s.applicable === false;
    // N/A steps still carry a placeholder numeric `score` in the data (seen:
    // score:1 alongside applicable:false) — scoreColor(1) reads as red,
    // making "N/A" look like a failing score instead of "not applicable."
    // The Comparison page's journey table already colors N/A cells neutral
    // gray; match that here instead of passing the underlying score through.
    return `
      <div class="journey-step ${isNA ? 'na' : ''}" onclick="openJourneyStep('${co.slug}','${key}')">
        <div class="js-label">${label}</div>
        <div class="js-score" style="color:${isNA ? 'var(--text-3)' : scoreColor(s.score)}">${isNA ? 'N/A' : fmt(s.score)}</div>
        ${scoreBar(isNA ? 0 : (s.score || 0))}
        ${s.key_finding ? `<div class="js-finding">${s.key_finding}</div>` : ''}
      </div>`;
  }).join('');

  // Load journey MD files list
  const files = co.journey_files || [];
  const fileList = files.length > 0 ? `
    <div class="card mt-4">
      <h3>Journey Step Files</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${files.map(f => {
          const slug = f.replace('.md', '');
          return `<button class="btn btn-ghost" onclick="loadJourneyFile('${co.slug}','${co.folder}','${f}')" style="font-size:12px">${slug}</button>`;
        }).join('')}
      </div>
      <div id="journey-file-content" class="mt-3"></div>
    </div>` : '';

  return `
    <div class="journey-grid">${cards}</div>
    ${fileList}`;
}

window.openJourneyStep = async function(slug, key) {
  // do nothing fancy — just highlight
};

window.loadJourneyFile = async function(slug, folder, file) {
  const el = document.getElementById('journey-file-content');
  if (!el) return;
  el.innerHTML = `<div class="loading-state"><div class="spinner"></div></div>`;
  try {
    const r = await api.get(`/api/markdown?path=${encodeURIComponent(folder + '/02_user_journey/' + file)}`);
    el.innerHTML = `<div class="md-content">${marked.parse(r.content)}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="text-2">Could not load file.</div>`;
  }
};

// ─── Company Tab: Screenshots ─────────────────────────────────────────────────
async function renderTabScreenshots(slug) {
  let steps;
  try { steps = await api.get(`/api/screenshots/${slug}`); }
  catch { return `<div class="empty-state"><h3>No screenshots found</h3></div>`; }

  const stepKeys = Object.keys(steps);
  if (stepKeys.length === 0) return `<div class="empty-state"><div class="empty-icon">📷</div><h3>No screenshots yet</h3><p>Screenshots will appear here after benchmarking.</p></div>`;

  const total = stepKeys.reduce((s, k) => s + steps[k].length, 0);

  // Hero: first image from the highest-priority AI step
  let heroImg = null;
  for (const p of AI_STEP_PRIORITY) {
    const match = stepKeys.find(s => s.includes(p));
    if (match && steps[match].length > 0) { heroImg = steps[match][0]; break; }
  }
  if (!heroImg) heroImg = steps[stepKeys[0]]?.[0];

  // AI highlights: up to 8 images from AI interaction + recommendations steps (excluding hero)
  const highlightImgs = [];
  for (const p of AI_HIGHLIGHT_STEPS) {
    const match = stepKeys.find(s => s.includes(p));
    if (match) highlightImgs.push(...steps[match].filter(img => img !== heroImg));
  }
  const highlights = highlightImgs.slice(0, 8);

  // Full gallery (all steps, hidden by default behind "View All")
  const allSections = stepKeys.map(step => {
    const imgs = steps[step];
    const isAI = AI_HIGHLIGHT_STEPS.some(p => step.includes(p));
    return `
      <div class="step-gallery-section">
        <div class="gallery-title" role="button" tabindex="0" aria-expanded="true" onclick="toggleGallerySection(this)">
          <span>${step.replace(/_/g, ' ')}</span>
          <span class="badge badge-gray" style="margin-left:8px">${imgs.length}</span>
          ${isAI ? `<span class="badge badge-accent" style="margin-left:4px;font-size:9px;padding:1px 5px">AI</span>` : ''}
          <span class="gallery-toggle" style="margin-left:auto">▾</span>
        </div>
        <div class="gallery-grid">
          ${imgs.map(img => `
            <div class="gallery-item" role="button" tabindex="0" aria-label="Open ${img.name} enlarged" onclick="openLightbox('${img.url}','${img.name}')">
              <img src="${img.url}" alt="${img.name}" loading="lazy" onerror="this.style.background='var(--surface-3)';this.src=''"/>
              <div class="gallery-item-name">${img.name}</div>
            </div>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    ${heroImg ? `
    <div class="hero-screenshot-section mb-4">
      <div class="hero-label">Hero Screenshot — Primary AI Interaction</div>
      <div class="hero-img-wrap" onclick="openLightbox('${heroImg.url}','${heroImg.name}')">
        <img src="${heroImg.url}" alt="${heroImg.name}" class="hero-img"/>
        <div class="hero-img-caption">${heroImg.name} &nbsp;·&nbsp; Click to enlarge</div>
      </div>
    </div>` : ''}

    ${highlights.length > 0 ? `
    <div class="section-header">
      <div>
        <div class="section-title">AI Highlights</div>
        <div class="section-sub">Key AI interactions from this benchmark</div>
      </div>
    </div>
    <div class="gallery-grid mb-4">
      ${highlights.map(img => `
        <div class="gallery-item" role="button" tabindex="0" aria-label="Open ${img.name} enlarged" onclick="openLightbox('${img.url}','${img.name}')">
          <img src="${img.url}" alt="${img.name}" loading="lazy" onerror="this.style.background='var(--surface-3)';this.src=''"/>
          <div class="gallery-item-name">${img.name}</div>
        </div>`).join('')}
    </div>` : ''}

    <div class="flex items-center justify-between mb-3">
      <div class="text-2">${total} total &nbsp;·&nbsp; ${stepKeys.length} steps</div>
      <button class="btn btn-ghost" onclick="toggleAllScreenshots(this)" style="font-size:12px">View All Screenshots ▸</button>
    </div>
    <div id="all-screenshots" style="display:none">${allSections}</div>`;
}

window.toggleAllScreenshots = function(btn) {
  const el = document.getElementById('all-screenshots');
  const hidden = el.style.display === 'none';
  el.style.display = hidden ? '' : 'none';
  btn.textContent = hidden ? 'Hide Screenshots ▴' : 'View All Screenshots ▸';
};

window.toggleGallerySection = function(titleEl) {
  const grid = titleEl.nextElementSibling;
  const toggle = titleEl.querySelector('.gallery-toggle');
  const hidden = grid.style.display === 'none';
  grid.style.display = hidden ? '' : 'none';
  if (toggle) toggle.textContent = hidden ? '▾' : '▸';
  titleEl.setAttribute('aria-expanded', hidden ? 'true' : 'false');
};

// ─── Company Tab: UX Analysis ─────────────────────────────────────────────────
async function renderTabUX(co) {
  if (!co.folder) return `<div class="empty-state"><h3>No UX analysis file found</h3></div>`;

  let html = '';
  const files = [];
  if (co.has_ux_analysis) files.push({ path: co.folder + '/03_ux_analysis.md', label: 'UX Analysis' });
  if (co.has_emerging_patterns) files.push({ path: co.folder + '/04_emerging_patterns.md', label: 'Emerging Patterns' });

  for (const f of files) {
    try {
      const r = await api.get(`/api/markdown?path=${encodeURIComponent(f.path)}`);
      html += `<div class="card mb-4"><div class="md-content">${marked.parse(r.content)}</div></div>`;
    } catch { html += `<div class="text-2 mb-4">${f.label} file not found.</div>`; }
  }

  return html || `<div class="empty-state"><h3>No UX analysis files found</h3></div>`;
}

// ─── Company Tab: Opportunities ───────────────────────────────────────────────
async function renderTabOpportunities(co) {
  let html = '';
  const files = [];
  if (co.has_opportunities) files.push({ path: co.folder + '/05_innovation_opportunities.md', label: 'Innovation Opportunities' });
  if (co.has_saudia_brief) files.push({ path: co.saudia_brief_path, label: 'Saudia Strategic Brief' });

  for (const f of files) {
    try {
      const r = await api.get(`/api/markdown?path=${encodeURIComponent(f.path)}`);
      html += `<div class="card mb-4"><div class="md-content">${marked.parse(r.content)}</div></div>`;
    } catch { html += `<div class="text-2 mb-4">${f.label}: file not found.</div>`; }
  }

  return html || `<div class="empty-state"><h3>No opportunity files found</h3></div>`;
}

window.presetComparison = function(slug) {
  _comparison_selected = new Set([slug]);
  navigate('comparison');
};

// ─── Page: Comparison ─────────────────────────────────────────────────────────
async function renderComparison() {
  setTitle('Company Comparison');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const [benchmarks, matrix] = await Promise.all([getBenchmarks(), getMatrix()]);
  const complete = benchmarks.filter(b => b.status === 'complete');

  if (_comparison_selected.size === 0) {
    complete.forEach(b => _comparison_selected.add(b.slug));
  }

  function html() {
    const selected = complete.filter(b => _comparison_selected.has(b.slug));

    const selector = `
      <div class="section-header">
        <div class="section-title">Select Companies to Compare</div>
      </div>
      <div class="comparison-selector">
        ${benchmarks.map(b => `
          <div class="company-toggle ${b.status === 'complete' ? (_comparison_selected.has(b.slug) ? 'selected' : '') : 'pending'}"
               ${b.status === 'complete' ? `role="button" tabindex="0" aria-pressed="${_comparison_selected.has(b.slug)}"` : ''}
               onclick="${b.status === 'complete' ? `toggleCompany('${b.slug}')` : ''}">
            <span style="color:${scoreColor(b.overall_score)}">${fmt(b.overall_score)}</span>
            ${b.name}
          </div>`).join('')}
      </div>`;

    if (selected.length === 0) return selector + `<div class="empty-state"><h3>Select at least one company</h3></div>`;

    // Radar chart
    const datasets = selected.map((b, i) => ({
      label: b.name,
      values: INNOVATION_DIMS.map(d => (b.innovation_scores?.[d.id] || 0)),
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));

    const legend = selected.map((b, i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></div>
        ${b.name}
      </div>`).join('');

    // Journey step comparison
    const stepRows = Object.entries(JOURNEY_STEP_LABELS).map(([key, label]) => {
      const cells = selected.map(b => {
        const co = matrix.companies[b.slug];
        const s = co?.journey_scores?.[key];
        if (!s) return '<td>—</td>';
        if (s.applicable === false) return `<td style="color:var(--text-3)">N/A</td>`;
        return `<td class="cell-score" style="color:${scoreColor(s.score)}">${fmt(s.score)}</td>`;
      }).join('');
      return `<tr><td>${label}</td>${cells}</tr>`;
    }).join('');

    // AI Capabilities comparison
    const schema = matrix.schema?.ai_capabilities || [];
    const capRows = schema.map(cap => {
      const cells = selected.map(b => {
        const co = matrix.companies[b.slug];
        const v = co?.ai_capabilities?.[cap.id];
        if (!v) return `<td style="color:var(--text-3)">—</td>`;
        const c = v.status === 'present' ? 'var(--green)' : v.status === 'partial' ? 'var(--yellow)' : 'var(--red)';
        return `<td style="color:${c}">${v.label}</td>`;
      }).join('');
      return `<tr><td>${cap.label}</td>${cells}</tr>`;
    }).join('');

    const colHeaders = selected.map(b => `<th>${b.name}<br><span style="color:${scoreColor(b.overall_score)};font-size:16px;font-weight:800">${fmt(b.overall_score)}</span></th>`).join('');

    return selector + `
      <div class="comparison-grid">
        <div class="radar-container">
          <h3>Innovation Dimensions</h3>
          ${radarChart(datasets, INNOVATION_DIMS.map(d => d.label), 260)}
          <div class="radar-legend">${legend}</div>
        </div>

        <div class="card">
          <h3>Journey Step Scores</h3>
          <div class="matrix-table-wrap" style="max-height:340px;overflow-y:auto;margin-top:10px">
            <table class="matrix-table">
              <thead><tr><th>Step</th>${colHeaders}</tr></thead>
              <tbody>${stepRows}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <h3>AI Capabilities</h3>
        <div class="matrix-table-wrap" style="margin-top:10px">
          <table class="matrix-table">
            <thead><tr><th>Capability</th>${colHeaders}</tr></thead>
            <tbody>${capRows}</tbody>
          </table>
        </div>
      </div>`;
  }

  window.toggleCompany = function(slug) {
    if (_comparison_selected.has(slug)) _comparison_selected.delete(slug);
    else _comparison_selected.add(slug);
    setContent(html());
  };

  setContent(html());
}

// ─── Page: Master Matrix ──────────────────────────────────────────────────────
async function renderMatrix() {
  setTitle('Score Matrix');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const matrix = await getMatrix();
  const benchmarks = await getBenchmarks();
  const complete = benchmarks.filter(b => b.status === 'complete');

  const colHeaders = [`<th>Dimension</th>`].concat(
    complete.map(b => `<th>${b.name}<br><span style="font-size:12px;color:${scoreColor(b.overall_score)}">${fmt(b.overall_score)}</span></th>`)
  ).join('');

  // Section 1: Overview
  const overviewRows = (matrix.schema?.overview_dimensions || []).map(dim => {
    const cells = complete.map(b => {
      const co = matrix.companies[b.slug];
      const val = co?.overview?.[dim.id];
      if (val === null || val === undefined) return '<td>—</td>';
      if (typeof val === 'boolean') return `<td>${val ? '✅' : '❌'}</td>`;
      return `<td>${val}</td>`;
    }).join('');
    return `<tr><td>${dim.label}</td>${cells}</tr>`;
  }).join('');

  // Section 2: AI Capabilities
  const capRows = (matrix.schema?.ai_capabilities || []).map(cap => {
    const cells = complete.map(b => {
      const co = matrix.companies[b.slug];
      const v = co?.ai_capabilities?.[cap.id];
      if (!v) return '<td class="cell-pending">—</td>';
      const c = v.status === 'present' ? 'var(--green)' : v.status === 'partial' ? 'var(--yellow)' : 'var(--red)';
      return `<td style="color:${c};font-size:12px">${v.label}</td>`;
    }).join('');
    return `<tr><td>${cap.label}</td>${cells}</tr>`;
  }).join('');

  // Section 3: UX Patterns
  const patternRows = (matrix.schema?.ux_patterns || []).map(pat => {
    const cells = complete.map(b => {
      const co = matrix.companies[b.slug];
      const v = co?.ux_patterns?.[pat.id];
      if (!v) return '<td class="cell-pending">—</td>';
      const c = v.present ? (v.quality === 'strong' ? 'var(--green)' : 'var(--yellow)') : 'var(--red)';
      return `<td style="color:${c}">${v.label}</td>`;
    }).join('');
    return `<tr><td>${pat.label}</td>${cells}</tr>`;
  }).join('');

  // Section 4: Journey Scores
  const journeyRows = (matrix.schema?.journey_steps || []).map(step => {
    const cells = complete.map(b => {
      const co = matrix.companies[b.slug];
      const s = co?.journey_scores?.[step.id];
      if (!s) return '<td class="cell-pending">—</td>';
      if (s.applicable === false) return `<td style="color:var(--text-3)">N/A</td>`;
      return `<td class="cell-score" style="color:${scoreColor(s.score)}">${fmt(s.score)}</td>`;
    }).join('');
    return `<tr><td>${step.label}</td>${cells}</tr>`;
  }).join('');

  // Section 5: Innovation Scores
  const innovRows = (matrix.schema?.innovation_dimensions || []).map(dim => {
    const cells = complete.map(b => {
      const co = matrix.companies[b.slug];
      const v = co?.innovation_scores?.[dim.id];
      return v != null ? `<td class="cell-score" style="color:${scoreColor(v)}">${fmt(v)}</td>` : '<td>—</td>';
    }).join('');
    return `<tr><td>${dim.label}</td>${cells}</tr>`;
  }).join('');

  function section(title, rows) {
    return `
      <tr class="matrix-section-header"><td colspan="${complete.length + 1}">${title}</td></tr>
      ${rows}`;
  }

  setContent(`
    <div class="matrix-table-wrap">
      <table class="matrix-table">
        <thead><tr>${colHeaders}</tr></thead>
        <tbody>
          ${section('Overview', overviewRows)}
          ${section('AI Capabilities', capRows)}
          ${section('UX Patterns', patternRows)}
          ${section('Journey Scores (1–5)', journeyRows)}
          ${section('Innovation Scores (1–5)', innovRows)}
        </tbody>
      </table>
    </div>
    <div class="text-2 text-sm mt-3 tech-info">
      Source: <code>Master_Benchmark_Matrix.json</code> ·
      Markdown version: <code>Master_Benchmark_Matrix.md</code>
    </div>`);
}

// ─── Page: Trends ─────────────────────────────────────────────────────────────
async function renderTrends() {
  setTitle('Emerging Trends & Patterns');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const { patterns } = await api.get('/api/patterns');
  const benchmarks = await getBenchmarks();
  const complete = benchmarks.filter(b => b.status === 'complete');
  const maxCount = complete.length || 1;
  const tableStakesAt = 5;

  const sorted = [...patterns].sort((a, b) => (b.count || 0) - (a.count || 0));

  const patternRows = sorted.map(p => {
    const count = p.count || 0;
    const pct = (count / tableStakesAt) * 100;
    const isTableStakes = count >= tableStakesAt;
    const statusClass = isTableStakes ? 'badge-accent' : count >= 2 ? 'badge-yellow' : 'badge-gray';
    const statusLabel = isTableStakes ? 'Table Stakes' : count >= 2 ? 'Emerging Trend' : 'Observed';

    const companyTags = (p.company_names || []).map(n => `<span class="badge badge-gray">${n}</span>`).join(' ');

    return `
      <div class="pattern-row">
        <div class="pattern-count" style="color:${count >= 2 ? 'var(--accent)' : 'var(--text-2)'}">
          ${count}
          <div class="pattern-threshold" style="color:var(--text-3)">/ ${tableStakesAt}</div>
        </div>
        <div class="pattern-bar-wrap">
          <div class="pattern-name">${(p.label || p.id || '').replace(/_/g,' ')}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span class="badge ${statusClass}">${statusLabel}</span>
            ${p.expected_12_24m ? `<span class="text-sm text-2">→ ${p.expected_12_24m} in 12–24mo</span>` : ''}
          </div>
          <div class="pattern-bar-bg">
            <div class="pattern-bar-inner" style="width:${Math.min(pct, 100)}%;background:${count >= tableStakesAt ? 'var(--accent)' : count >= 2 ? 'var(--yellow)' : 'var(--blue)'}"></div>
          </div>
          <div class="pattern-companies mt-2">${companyTags}</div>
        </div>
      </div>`;
  }).join('');

  // AI Maturity distribution
  const maturityCounts = {};
  complete.forEach(b => {
    const m = b.ai_maturity || 'Unknown';
    maturityCounts[m] = (maturityCounts[m] || 0) + 1;
  });

  const maturityChart = Object.entries(maturityCounts).map(([m, c]) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      ${maturityBadge(m)}
      <div style="flex:1">${scoreBar(c, complete.length, null)}</div>
      <div style="font-size:13px;font-weight:700">${c}</div>
    </div>`).join('');

  setContent(`
    <div class="two-col-grid-wide">
      <div>
        <div class="section-header">
          <div class="section-title">Pattern Tracker</div>
          <div class="section-sub">${patterns.length} patterns · Table Stakes threshold: ${tableStakesAt} companies</div>
        </div>
        ${patternRows}
      </div>
      <div>
        <div class="card mb-4">
          <h3>AI Maturity Distribution</h3>
          <div class="mt-3">${maturityChart || '<div class="text-2">No data yet</div>'}</div>
        </div>
        <div class="card">
          <h3>Escalation Rules</h3>
          <div class="space-y mt-3">
            <div class="text-sm"><span class="badge badge-yellow">Emerging Trend</span> 2–4 companies</div>
            <div class="text-sm"><span class="badge badge-accent">Table Stakes</span> 5+ companies</div>
            <div class="text-sm text-2 mt-2">When a pattern crosses Table Stakes, it becomes a <strong>Must Have</strong> for Saudia regardless of effort.</div>
          </div>
        </div>
      </div>
    </div>`);
}

// ─── Page: Saudia Opportunities ───────────────────────────────────────────────
async function renderSaudia() {
  setTitle('Saudia Opportunities');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const data = await api.get('/api/saudia');
  const { gap, briefs, key_insights } = data;

  // The matrix's gap severity lives in the free-text `gap` field (values like
  // "Critical", "High — Saudia has all data needed…") — not `priority`, which
  // instead holds an execution tag (P0/P1/P2/✅ Done/🟢 Own It). Bucketing by
  // `priority` (its exact values never match Critical/High/Medium/Low) left
  // every row unbucketed and this entire section rendered as "No gap data
  // yet" despite always having real records. Classify by matching a known
  // severity word at the start of `gap` instead; anything else (e.g. "Saudia
  // uniquely positioned to own this") is a strength, not a gap, so it gets
  // its own bucket rather than being silently dropped.
  const SEVERITY_WORDS = ['Critical', 'High', 'Medium', 'Low', 'None'];
  function gapSeverity(text) {
    const t = String(text || '');
    return SEVERITY_WORDS.find(w => t.startsWith(w)) || 'Opportunity';
  }

  const PRIORITY_CLASS = {
    'Critical': 'badge-red', 'High': 'badge-accent', 'Medium': 'badge-yellow', 'Low': 'badge-gray',
    'Opportunity': 'badge-purple', 'None': 'badge-green',
  };

  const gapEntries = Object.entries(gap);
  const bySeverity = {};
  gapEntries.forEach(([id, g]) => {
    const s = gapSeverity(g.gap);
    if (!bySeverity[s]) bySeverity[s] = [];
    bySeverity[s].push([id, g]);
  });

  const severityOrder = ['Critical', 'High', 'Medium', 'Low', 'Opportunity', 'None'];
  let gapHtml = '';
  for (const severity of severityOrder) {
    const items = bySeverity[severity] || [];
    if (!items.length) continue;
    gapHtml += `
      <div class="section-header mt-4">
        <div>${badge(severity, PRIORITY_CLASS[severity] || 'badge-gray')} Severity</div>
        <div class="section-sub">${items.length} area${items.length === 1 ? '' : 's'}</div>
      </div>`;
    gapHtml += items.map(([id, g]) => {
      // saudia_today is sometimes descriptive text ("None") rather than a
      // number — fall back to 0 for color/math, but still display the
      // original text via fmt() rather than coercing it to "0".
      const todayNum = typeof g.saudia_today === 'number' ? g.saudia_today : 0;
      return `
      <div class="gap-row">
        <div class="gap-header">
          <div class="gap-label">${g.label || id.replace(/_/g,' ')}</div>
          <div class="gap-best">Best: <strong>${g.best_in_class || '—'}</strong> (${fmt(g.best_score)}/5)</div>
          ${g.priority ? `<span class="badge badge-gray">${g.priority}</span>` : ''}
          <span class="badge badge-gray">${g.timeline || '—'}</span>
        </div>
        <div class="gap-body">
          <div class="gap-item">
            <label>Saudia Today</label>
            <span style="color:${scoreColor(todayNum)}">${fmt(g.saudia_today)} / 5</span>
            ${scoreBar(todayNum)}
          </div>
          <div class="gap-item">
            <label>Gap to Best</label>
            <span style="color:var(--red)">−${fmt((g.best_score || 0) - todayNum)}</span>
          </div>
          ${g.gap ? `<div class="text-2 text-sm" style="grid-column:1/-1">${g.gap}</div>` : ''}
          ${g.saudia_action ? `<div class="gap-action">${g.saudia_action}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  // Opportunity briefs (MD files)
  const briefsHtml = briefs.map(b => `
    <div class="card mt-4">
      <div class="text-2 text-sm mb-3">${b.file}</div>
      <div class="md-content">${marked.parse(b.content)}</div>
    </div>`).join('');

  setContent(`
    <div class="section-header">
      <div>
        <div class="section-title">Saudia Gap Analysis</div>
        <div class="section-sub">${gapEntries.length} strategic opportunity areas identified</div>
      </div>
    </div>
    ${gapHtml || '<div class="empty-state"><h3>No gap data yet</h3></div>'}

    ${briefs.length > 0 ? `
    <div class="section-header mt-4">
      <div class="section-title">Strategic Briefs by Benchmark</div>
    </div>
    ${briefsHtml}` : ''}`);
}

// ─── Global Search (topbar) ──────────────────────────────────────────────────
let _search_debounce = null;

function setupGlobalSearch() {
  const wrap = document.getElementById('global-search');
  const input = document.getElementById('global-search-input');
  const results = document.getElementById('global-search-results');
  if (!wrap || !input || !results) return;

  input.addEventListener('input', () => {
    clearTimeout(_search_debounce);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove('open'); results.innerHTML = ''; return; }
    _search_debounce = setTimeout(async () => {
      try {
        const data = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
        renderSearchResults(data.results || []);
      } catch { /* server unreachable — leave dropdown as-is */ }
    }, 250);
  });

  input.addEventListener('focus', () => {
    if (results.innerHTML.trim()) results.classList.add('open');
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) results.classList.remove('open');
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.activeElement === input) { results.classList.remove('open'); input.blur(); }
  });
}

function renderSearchResults(items) {
  const results = document.getElementById('global-search-results');
  if (!results) return;
  if (items.length === 0) {
    results.innerHTML = `<div class="search-empty">No matches</div>`;
    results.classList.add('open');
    return;
  }
  const TYPE_LABELS = { company: 'Companies', feature: 'Features', ai_capability: 'AI Capabilities', ux_pattern: 'UX Patterns', pattern: 'Patterns', document: 'Documents' };
  const groups = {};
  items.forEach(it => { (groups[it.type] = groups[it.type] || []).push(it); });

  results.innerHTML = Object.entries(groups).map(([type, group]) => `
    <div class="search-group-label">${TYPE_LABELS[type] || type}</div>
    ${group.map(r => `
      <a href="${r.link}" class="search-result-item" onclick="closeGlobalSearch()">
        <div class="search-result-label">${r.label}</div>
        ${r.snippet ? `<div class="search-result-snippet">${r.snippet}</div>` : ''}
      </a>`).join('')}
  `).join('');
  results.classList.add('open');
}

window.closeGlobalSearch = function() {
  document.getElementById('global-search-results').classList.remove('open');
  document.getElementById('global-search-input').value = '';
};

// ─── Lightbox ─────────────────────────────────────────────────────────────────
window.openLightbox = function(url, name) {
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = `
    <div id="lightbox-close" role="button" tabindex="0" aria-label="Close" onclick="document.getElementById('lightbox').remove()">✕</div>
    <img src="${url}" alt="${name}"/>
    <div id="lightbox-caption">${name}</div>`;
  lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
  document.body.appendChild(lb);
};

function setupLightbox() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.getElementById('lightbox')?.remove();
  });
}

// ─── Mobile sidebar drawer ────────────────────────────────────────────────────
function setupMobileSidebar() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const backdrop = document.getElementById('sidebar-backdrop');
  const sidebar = document.getElementById('sidebar');
  if (!toggleBtn || !backdrop || !sidebar) return;

  function close() {
    document.body.classList.remove('sidebar-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }
  function open() {
    document.body.classList.add('sidebar-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  toggleBtn.addEventListener('click', () => {
    document.body.classList.contains('sidebar-open') ? close() : open();
  });
  backdrop.addEventListener('click', close);
  // Any in-sidebar navigation (nav item, company link) should also close the
  // drawer — otherwise it stays open covering the page after navigating.
  sidebar.addEventListener('click', e => { if (e.target.closest('a')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// Sprint 27 (P1-2): same open/close pattern as setupMobileSidebar() above —
// toggles a body class the CSS uses to drop the existing search bar down as
// an overlay row, reusing the same #global-search markup/logic untouched.
function setupMobileSearch() {
  const toggleBtn = document.getElementById('mobile-search-toggle-btn');
  const input = document.getElementById('global-search-input');
  if (!toggleBtn || !input) return;

  function close() {
    document.body.classList.remove('mobile-search-open');
    toggleBtn.setAttribute('aria-expanded', 'false');
  }
  function open() {
    document.body.classList.add('mobile-search-open');
    toggleBtn.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  toggleBtn.addEventListener('click', () => {
    document.body.classList.contains('mobile-search-open') ? close() : open();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    setupLightbox();
    await initSidebar();
    await route(location.hash);
  } catch (e) {
    document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <h3>Could not connect to the server</h3>
        <p>Start it with <code>node 10_Dashboard/server.js</code>, then reload.</p>
      </div>`;
  }
}

init();
