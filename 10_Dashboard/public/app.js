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
  queued:                 'Queued',
  preparing:              'Preparing',
  running:                'Running',
  opening_website:        'Opening Website',
  capturing_screenshots:  'Capturing Screenshots',
  analyzing_ux:           'Analyzing UX',
  extracting_patterns:    'Extracting Patterns',
  updating_matrix:        'Updating Matrix',
  generating_dashboard:   'Generating Dashboard',
  completed:              'Completed',
  failed:                 'Failed',
  // Sprint 24 — Output Verification Layer
  runtime_failed:         'Runtime Failed',
  reasoning_failed:       'Reasoning Failed',
  verification_failed:    'Verification Failed',
  // Sprint 26 — Live Runtime Progress: real Runtime stage ids, shown WHILE
  // that stage is running (see benchmarkService.js). Same ids Output
  // Verification's own error.stageId already used in Sprint 24 — reused
  // here as display labels rather than invented fresh.
  navigation:              'Navigation',
  screenshot:              'Screenshot',
  vision:                  'Vision Analysis',
  reasoning:               'Reasoning',
  output_verification:     'Output Verification',
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
let _library_filters = { q: '', category: 'All', status: 'All', feature: 'All', view: 'All', ai: false, dateSort: 'newest' };
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
  document.getElementById('page-title').textContent = t;
}

function setTopbarActions(html) {
  document.getElementById('topbar-actions').innerHTML = html || '';
}

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
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('href') === `#${activeRoute}` || el.dataset.slug === activeRoute);
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

  if (isPresentationMode() && (h === 'wizard' || h === 'queue')) {
    updateActiveNav(h);
    renderPresentationNotice(h === 'wizard' ? 'New Benchmark' : 'Benchmark Queue');
    return;
  }

  updateActiveNav(h);
  switch (h) {
    case 'home':        await renderHome(); break;
    case 'benchmarks':  await renderBenchmarks(query); break;
    case 'homepage-benchmarks': await renderHomepageBenchmarks(); break;
    case 'comparison':  await renderComparison(); break;
    case 'matrix':      await renderMatrix(); break;
    case 'trends':      await renderTrends(); break;
    case 'saudia':      await renderSaudia(); break;
    case 'wizard':      await renderWizard(); break;
    case 'queue':       await renderQueue(); break;
    default:            await renderHome();
  }
}

// ─── Presentation Mode ────────────────────────────────────────────────────────
function isPresentationMode() {
  return document.body.classList.contains('presentation-mode');
}

function renderPresentationNotice(pageName) {
  setTitle('Presentation Mode');
  setTopbarActions('');
  setContent(`
    <div class="presentation-notice">
      <div class="empty-icon">🎥</div>
      <h3>${pageName} is hidden in Presentation Mode</h3>
      <p>Turn off Presentation Mode in the sidebar to access workspace tools.</p>
    </div>`);
}

function setupPresentationMode() {
  if (localStorage.getItem('presentationMode') === 'true') {
    document.body.classList.add('presentation-mode');
  }
  const toggle = document.getElementById('presentation-toggle');
  if (!toggle) return;
  toggle.setAttribute('aria-pressed', document.body.classList.contains('presentation-mode') ? 'true' : 'false');
  toggle.addEventListener('click', () => {
    const on = document.body.classList.toggle('presentation-mode');
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
    localStorage.setItem('presentationMode', on ? 'true' : 'false');
    route(location.hash);
  });
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
async function initSidebar() {
  const benchmarks = await getBenchmarks();
  const complete = benchmarks.filter(b => b.status === 'complete');
  const total = benchmarks.length;

  document.getElementById('badge-count').textContent = complete.length;
  document.getElementById('progress-text').textContent = `${complete.length} / ${total} complete`;
  document.getElementById('progress-fill').style.width = `${(complete.length / total) * 100}%`;

  if (complete.length > 0) {
    document.getElementById('section-completed').style.display = '';
    const nav = document.getElementById('nav-companies');
    nav.innerHTML = complete.map(b => `
      <a href="#company/${b.slug}" class="nav-item" data-slug="${b.slug}">
        <span class="nav-icon">●</span>
        ${b.name}
        <span class="nav-company-score" style="color:${scoreColor(b.overall_score)}">${fmt(b.overall_score)}</span>
      </a>`).join('');
  }

  try {
    const { requests } = await getRequests();
    const activeItems = requests.filter(r => r.status !== 'complete').reduce((n, r) => n + r.items.filter(i => i.stage !== 'completed').length, 0);
    const queueBadge = document.getElementById('badge-queue');
    if (activeItems > 0) { queueBadge.textContent = activeItems; queueBadge.style.display = ''; }
  } catch { /* requests API not reachable — badge stays hidden */ }
}

// ─── Page: Home ──────────────────────────────────────────────────────────────
function recentlyAddedHtml(matrix) {
  const sorted = [...matrix.benchmark_plan].sort((a, b) => (b.rank || 0) - (a.rank || 0)).slice(0, 5);
  return `<div class="card">
    <h3>Recently Added Companies</h3>
    <div class="space-y mt-3">
      ${sorted.map(p => `<div class="flex items-center justify-between text-sm">
        <span>${p.name}</span>
        <span>${p.status === 'complete' ? badge('Complete', 'badge-green') : badge('Pending', 'badge-gray')}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function recentlyCompletedHtml(complete) {
  const sorted = [...complete].filter(b => b.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
  return `<div class="card">
    <h3>Recently Completed Benchmarks</h3>
    <div class="space-y mt-3">
      ${sorted.map(b => `<div class="flex items-center justify-between text-sm">
        <span>${b.name} <span class="text-2" style="font-size:11px">— ${new Date(b.date).toLocaleDateString()}</span></span>
        <span style="color:${scoreColor(b.overall_score)};font-weight:700">${fmt(b.overall_score)}</span>
      </div>`).join('') || '<div class="text-2 text-sm">No completed benchmarks yet.</div>'}
    </div>
  </div>`;
}

function trendingPatternsHomeHtml(patterns) {
  const top = [...patterns].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, 5);
  return `<div class="card">
    <h3>Trending UX Patterns</h3>
    <div class="space-y mt-3">
      ${top.map(p => `<div class="flex items-center justify-between text-sm">
        <span>${(p.label || p.id || '').replace(/_/g, ' ')}</span>
        <span class="badge ${p.count >= 5 ? 'badge-accent' : p.count >= 2 ? 'badge-yellow' : 'badge-gray'}">${p.count || 0}</span>
      </div>`).join('') || '<div class="text-2 text-sm">No patterns yet.</div>'}
    </div>
  </div>`;
}

function aiDiscoveriesHtml(matrix) {
  const found = [];
  for (const plan of matrix.benchmark_plan) {
    if (plan.status !== 'complete') continue;
    const co = matrix.companies[plan.slug];
    if (!co) continue;
    for (const [capId, cap] of Object.entries(co.ai_capabilities || {})) {
      if (cap.status === 'present' && (cap.score || 0) >= 5) {
        found.push({ company: plan.name, cap: capId.replace(/_/g, ' '), note: cap.notes || cap.label || '' });
        break;
      }
    }
  }
  return `<div class="card">
    <h3>Latest AI Discoveries</h3>
    <div class="space-y mt-3">
      ${found.slice(0, 5).map(f => `<div class="text-sm"><strong>${f.company}</strong> — ${f.cap}<div class="text-2 text-sm">${f.note}</div></div>`).join('') || '<div class="text-2 text-sm">No standout capabilities yet.</div>'}
    </div>
  </div>`;
}

function topScoresHtml(complete) {
  const top = [...complete].sort((a, b) => (b.overall_score || 0) - (a.overall_score || 0)).slice(0, 5);
  return `<div class="card">
    <h3>Top Innovation Scores</h3>
    <div class="space-y mt-3">
      ${top.map((b, i) => `<div class="flex items-center justify-between text-sm">
        <span>#${i + 1} ${b.name}</span>
        <span style="color:${scoreColor(b.overall_score)};font-weight:700">${fmt(b.overall_score)}</span>
      </div>`).join('') || '<div class="text-2 text-sm">No completed benchmarks yet.</div>'}
    </div>
  </div>`;
}

function upcomingHtml(requests, benchmarks) {
  const activeItems = [];
  requests.forEach(r => r.items.forEach(i => {
    if (i.stage !== 'completed') activeItems.push({ name: i.name, feature: r.feature, stage: STAGE_LABELS[i.stage] || i.stage });
  }));
  const pendingNoRequest = benchmarks
    .filter(b => b.status === 'pending' && !activeItems.some(a => a.name === b.name))
    .map(b => ({ name: b.name, feature: 'Complete Journey', stage: 'Not started' }));
  const combined = [...activeItems, ...pendingNoRequest].slice(0, 6);
  return `<div class="card">
    <h3>Upcoming Benchmarks</h3>
    <div class="space-y mt-3">
      ${combined.map(u => `<div class="flex items-center justify-between text-sm">
        <span>${u.name} <span class="text-2">— ${u.feature}</span></span>
        <span class="badge badge-gray">${u.stage}</span>
      </div>`).join('') || '<div class="text-2 text-sm">Nothing queued.</div>'}
    </div>
  </div>`;
}

function recentActivityHtml(requests) {
  const events = [];
  requests.forEach(r => {
    events.push({ at: r.created_at, text: `New request created — ${r.feature} (${r.items.length} competitor${r.items.length === 1 ? '' : 's'})` });
    r.items.forEach(i => {
      if (i.stage !== 'queued') events.push({ at: i.updated_at, text: `${i.name} → ${STAGE_LABELS[i.stage] || i.stage}` });
    });
  });
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return `<div class="card">
    <h3>Recent Activity</h3>
    <div class="space-y mt-3">
      ${events.slice(0, 6).map(e => `<div class="text-sm">${e.text}<div class="text-2" style="font-size:11px">${new Date(e.at).toLocaleString()}</div></div>`).join('') || '<div class="text-2 text-sm">No activity yet.</div>'}
    </div>
  </div>`;
}

function progressSummaryHtml(requests) {
  const allItems = requests.flatMap(r => r.items);
  const done = allItems.filter(i => i.stage === 'completed').length;
  const pct = allItems.length ? Math.round((done / allItems.length) * 100) : 0;
  return `<div class="card">
    <h3>Benchmark Progress</h3>
    <div class="mt-3 text-sm text-2">${done} / ${allItems.length} queued items completed</div>
    <div class="progress-bar mt-2" style="height:8px"><div class="progress-fill" style="width:${pct}%"></div></div>
  </div>`;
}

function roadmapSectionHtml() {
  return `
    <div class="section-header mt-4">
      <div><div class="section-title">Roadmap</div><div class="section-sub">Future Ready — coming soon</div></div>
    </div>
    <div class="roadmap-grid mb-4">
      ${ROADMAP_ITEMS.map(r => `<div class="roadmap-item"><div class="roadmap-item-title">${r.title}<span class="roadmap-soon-badge">Soon</span></div><div class="roadmap-item-desc">${r.desc}</div></div>`).join('')}
    </div>`;
}

// Sprint 28 — Product Identity: replaces Sprint 27's dismissible onboarding
// tip with a permanent hero. The two jobs are different — Sprint 27's panel
// was a one-time explainer; this is the page's actual identity and primary
// action, so it doesn't hide itself the way a tip should. Answers, in
// order, the three things GOAL asks for within 10 seconds: what this is
// (kicker + headline), why it's valuable (subheadline, in outcomes, not
// mechanism), what to do next (one primary CTA — "Start Benchmark", not
// two competing ones). The New Benchmark / Homepage Benchmark distinction
// Sprint 27 established is kept, but demoted to a small text line under the
// CTA — real information, not competing for the same visual weight as the
// primary action.
function heroSectionHtml(stats) {
  return `
    <div class="hero">
      <div class="hero-kicker">AI Travel Benchmark Platform</div>
      <h1 class="hero-title">See how travel’s best AI experiences actually work — automatically.</h1>
      <p class="hero-sub">Point it at a competitor and get back a scored, evidence-backed read on their AI: what they built, how it compares, and what Saudia should build next — no manual research pass required.</p>
      <div class="hero-actions">
        <a href="#wizard" class="btn btn-hero-primary">Start Benchmark →</a>
        <span class="hero-secondary-link">or run a <a href="#homepage-benchmarks">quick homepage scan</a> instead</span>
      </div>
      <div class="hero-proof">
        <span><strong>${stats.benchmarks_complete}</strong> products benchmarked</span>
        <span class="hero-proof-dot">·</span>
        <span><strong>${stats.patterns_discovered}</strong> AI patterns identified</span>
        <span class="hero-proof-dot">·</span>
        <span><strong>${stats.saudia_opportunities}</strong> opportunities for Saudia</span>
      </div>
    </div>`;
}

async function renderHome() {
  setTitle('AI Travel Benchmark 2026');
  setTopbarActions('');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const [stats, benchmarks, matrix, patternsData, requestsData] = await Promise.all([
    api.get('/api/stats'),
    getBenchmarks(),
    getMatrix(),
    api.get('/api/patterns').catch(() => ({ patterns: [] })),
    getRequests().catch(() => ({ requests: [] })),
  ]);

  const complete = benchmarks.filter(b => b.status === 'complete');
  const insights = matrix.key_insights || [];
  const patterns = patternsData.patterns || [];
  const requests = requestsData.requests || [];

  setContent(`
    ${heroSectionHtml(stats)}
    <div class="section-header">
      <div><div class="section-title">Platform Statistics</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card accent">
        <div class="stat-value">${stats.benchmarks_complete}</div>
        <div class="stat-label">Benchmarks Complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.benchmarks_planned}</div>
        <div class="stat-label">Total Planned</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-value">${stats.patterns_discovered}</div>
        <div class="stat-label">Patterns Discovered</div>
      </div>
      <div class="stat-card green">
        <div class="stat-value">${stats.saudia_opportunities}</div>
        <div class="stat-label">Saudia Opportunity Areas</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${fmt(stats.average_score)}</div>
        <div class="stat-label">Average Innovation Score</div>
      </div>
    </div>

    <div class="section-header">
      <div>
        <div class="section-title">Completed Benchmarks</div>
        <div class="section-sub">${complete.length} of ${stats.benchmarks_planned} companies benchmarked</div>
      </div>
      <a href="#benchmarks" class="btn btn-ghost">View All →</a>
    </div>

    <div class="card-grid mb-4">
      ${complete.map(b => benchmarkCardHtml(b)).join('')}
    </div>

    ${insights.length > 0 ? `
    <div class="section-header mt-4">
      <div class="section-title">Cross-Benchmark Insights</div>
    </div>
    <div class="insights-list">
      ${insights.map(ins => `
        <div class="insight-card">
          <div class="insight-after">${ins.after || ''}</div>
          <div class="insight-headline">${ins.headline || ''}</div>
          <div class="insight-synthesis">${ins.synthesis || ''}</div>
          ${ins.saudia_imperative ? `<div class="insight-imperative">→ ${ins.saudia_imperative}</div>` : ''}
        </div>`).join('')}
    </div>` : ''}

    <div class="section-header mt-4">
      <div class="section-title">Workspace</div>
      <div class="section-sub">Live view of what's in flight and what's trending</div>
    </div>
    <div class="card-grid mb-4">
      ${progressSummaryHtml(requests)}
      ${upcomingHtml(requests, benchmarks)}
      ${recentActivityHtml(requests)}
      ${recentlyAddedHtml(matrix)}
      ${recentlyCompletedHtml(complete)}
      ${trendingPatternsHomeHtml(patterns)}
      ${topScoresHtml(complete)}
      ${aiDiscoveriesHtml(matrix)}
    </div>

    ${roadmapSectionHtml()}
  `);

  attachCardClicks();
}

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
  setTopbarActions('');
  if (!_wizard) initWizard();
  renderWizardStep();
}

function wizardStepsHtml() {
  const labels = ['Feature', 'Competitors', 'Scope', 'Review'];
  return `<div class="wizard-steps">
    ${labels.map((l, i) => {
      const n = i + 1;
      const cls = n < _wizard.step ? 'done' : n === _wizard.step ? 'active' : '';
      return `<div class="wizard-step-node ${cls}">
        <div class="wizard-step-dot">${n < _wizard.step ? '✓' : n}</div>
        <div class="wizard-step-label">${l}</div>
      </div>`;
    }).join('')}
  </div>`;
}

function wizardErrorHtml() {
  return _wizard.error ? `<div class="text-sm" style="color:var(--red);margin-top:10px">${_wizard.error}</div>` : '';
}

function renderWizardStep() {
  const body = {
    1: wizardStep1, 2: wizardStep2, 3: wizardStep3, 4: wizardStep4,
  }[_wizard.step]();
  setContent(`<div class="wizard-shell">${wizardStepsHtml()}<div class="wizard-card">${body}</div></div>`);
}

function wizardStep1() {
  const customVal = _wizard.feature && !FEATURE_PRESETS.includes(_wizard.feature) ? _wizard.feature : '';
  return `
    <h2>Select Feature</h2>
    <div class="section-sub">What are we benchmarking? (Looking for a quick automated homepage-only scan instead — airlines only, no setup? Use <a href="#homepage-benchmarks" class="btn-link" style="font-size:inherit">Homepage Benchmark</a> from the sidebar instead of this wizard.)</div>
    <div class="chip-group">
      ${FEATURE_PRESETS.map(f => `<div class="chip ${_wizard.feature === f ? 'selected' : ''}" role="button" tabindex="0" aria-pressed="${_wizard.feature === f}" onclick="wizardSetFeature('${f}')">${f}</div>`).join('')}
    </div>
    <div class="form-group mt-4">
      <label class="form-label">Or enter a custom feature</label>
      <input type="text" class="form-input" placeholder="e.g. Refund Flow" value="${customVal}" oninput="wizardSetFeatureText(this.value)" />
    </div>
    ${wizardErrorHtml()}
    <div class="wizard-actions">
      <span></span>
      <button class="btn btn-primary" onclick="wizardNext()">Next →</button>
    </div>`;
}

function wizardStep2() {
  const rows = _wizard.competitors.map((c, i) => `
    <div class="competitor-row">
      <div class="competitor-name">${c.name}</div>
      <div class="competitor-url">${c.url || '—'}</div>
      <div class="competitor-remove" role="button" tabindex="0" aria-label="Remove ${c.name}" onclick="wizardRemoveCompetitor(${i})">✕</div>
    </div>`).join('');

  const suggestions = COMPETITOR_SUGGESTIONS.filter(s => !_wizard.competitors.some(c => c.name === s));

  return `
    <h2>Add Competitors</h2>
    <div class="section-sub">Add as many as you need — custom names and URLs are welcome.</div>
    <div class="form-row">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">Company name</label>
        <input type="text" class="form-input" id="wizard-competitor-name" placeholder="e.g. Mindtrip" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">URL (optional)</label>
        <input type="text" class="form-input" id="wizard-competitor-url" placeholder="https://…" />
      </div>
      <button class="btn btn-primary" onclick="wizardAddCompetitor()" style="flex:0 0 auto">+ Add</button>
    </div>
    ${suggestions.length ? `<div class="competitor-suggestions">
      ${suggestions.map(s => `<div class="competitor-suggestion" role="button" tabindex="0" onclick="wizardQuickAddCompetitor('${s}')">+ ${s}</div>`).join('')}
    </div>` : ''}
    <div class="competitor-list">${rows || '<div class="text-2 text-sm mt-2">No competitors added yet.</div>'}</div>
    ${wizardErrorHtml()}
    <div class="wizard-actions">
      <button class="btn btn-ghost" onclick="wizardBack()">← Back</button>
      <button class="btn btn-primary" onclick="wizardNext()">Next →</button>
    </div>`;
}

function wizardStep3() {
  return `
    <h2>Benchmark Scope</h2>
    <div class="section-sub">Select all that apply.</div>
    <div class="chip-group" style="flex-direction:column;align-items:stretch">
      ${SCOPE_INFO.map(s => `
        <div class="chip ${_wizard.scope.includes(s.id) ? 'selected' : ''}" role="button" tabindex="0" aria-pressed="${_wizard.scope.includes(s.id)}" onclick="wizardToggleScope('${s.id}')" style="text-align:left">
          <div>${s.id}</div>
          <div class="chip-desc">${s.desc}</div>
        </div>`).join('')}
    </div>
    ${wizardErrorHtml()}
    <div class="wizard-actions">
      <button class="btn btn-ghost" onclick="wizardBack()">← Back</button>
      <button class="btn btn-primary" onclick="wizardNext()">Next →</button>
    </div>`;
}

function wizardStep4() {
  const scopeText = _wizard.scope.join(', ') || 'End-to-End Journey';
  const companyNames = _wizard.competitors.map(c => c.name).join(', ');

  return `
    <h2>Review &amp; Run</h2>
    <div class="section-sub">Runs automatically — no further steps needed. You'll see live progress in the Queue.</div>
    <div class="wizard-review-row"><label>Company</label><span class="value">${companyNames}</span></div>
    <div class="wizard-review-row"><label>Feature</label><span class="value">${_wizard.feature}</span></div>
    <div class="wizard-review-row"><label>Scope</label><span class="value">${scopeText}</span></div>
    <div class="form-group mt-4">
      <label class="form-label">Notes (optional)</label>
      <textarea class="form-textarea" oninput="wizardSetNotes(this.value)">${_wizard.notes || ''}</textarea>
    </div>
    ${wizardErrorHtml()}
    <div class="wizard-actions">
      <button class="btn btn-ghost" onclick="wizardBack()" ${_wizard.submitting ? 'disabled' : ''}>← Back</button>
      <button class="btn btn-primary" onclick="wizardSubmit()" ${_wizard.submitting ? 'disabled' : ''}>${_wizard.submitting ? 'Running…' : 'Run Benchmark'}</button>
    </div>`;
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
    _wizard = null;
    navigate('queue');
    showToast('Benchmark running — track live progress in the Queue below.');
  } catch (e) {
    _wizard.submitting = false;
    _wizard.error = e.message || 'Could not create the request.';
    renderWizardStep();
  }
};

// ─── Page: Benchmark Queue ────────────────────────────────────────────────────
const QUEUE_STATUS_BADGE = { complete: 'badge-green', in_progress: 'badge-accent', queued: 'badge-gray', cancelled: 'badge-red' };

// Sprint 26 — Live Runtime Progress: stages worth polling for, i.e. "this
// item might change again soon without a user action." Reuses the exact
// same Runtime stage ids already defined above — not a new vocabulary.
const ACTIVE_QUEUE_STAGES = new Set(['preparing', 'running', ...RUNTIME_STAGES_WITH_URL, ...FEATURE_PIPELINE_STAGES]);
let _queue_poll_timer = null;

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function renderQueue() {
  setTitle('Benchmark Queue');
  setTopbarActions(`<a href="#wizard" class="btn btn-primary workspace-only">+ New Benchmark</a>`);
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);
  clearInterval(_queue_poll_timer);

  let { requests, stages } = await getRequests(true);

  if (requests.length === 0) {
    setContent(`<div class="empty-state"><div class="empty-icon">▤</div><h3>No benchmark requests yet</h3><p>Start one from the New Benchmark wizard.</p></div>`);
    return;
  }

  function filterBarHtml() {
    const counts = { All: requests.length };
    ['queued', 'in_progress', 'complete', 'cancelled'].forEach(s => { counts[s] = requests.filter(r => r.status === s).length; });
    const labels = [['All', 'All'], ['queued', 'Queued'], ['in_progress', 'In Progress'], ['complete', 'Completed'], ['cancelled', 'Cancelled']];
    return `<div class="filter-bar">
      ${labels.map(([id, label]) => `<div class="filter-chip ${_queue_filter === id ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${_queue_filter === id}" onclick="queueStatusFilter('${id}')">${label} <span class="text-3">${counts[id] ?? 0}</span></div>`).join('')}
    </div>`;
  }

  function renderList() {
    const filtered = _queue_filter === 'All' ? requests : requests.filter(r => r.status === _queue_filter);
    const el = document.getElementById('queue-list');
    if (!el) return;
    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-state"><h3>No requests in this status</h3></div>`;
      return;
    }

    const sorted = [...filtered].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    el.innerHTML = sorted.map(r => {
      const doneCount = r.items.filter(i => i.stage === 'completed').length;
      const pct = r.items.length ? Math.round((doneCount / r.items.length) * 100) : 0;
      const badgeCls = QUEUE_STATUS_BADGE[r.status] || 'badge-gray';
      const isActive = r.status === 'queued' || r.status === 'in_progress';

      // V1.6: stages driven by the automated pipeline (benchmarkService ->
      // ClaudeProvider) — as opposed to the older granular stages a human
      // manually walks a dropdown through. These get a status badge instead
      // of the generic segment bar: mapping 'failed' onto a fixed position
      // in the granular STAGES list would render every earlier segment as
      // "done" (looks like it finished successfully), which is exactly
      // backwards. Reuses the badge classes/colors the Homepage Benchmark
      // run panel already defined — no new CSS.
      //
      // Sprint 24 — Output Verification Layer: three failure stages
      // (runtime_failed / reasoning_failed / verification_failed) all map
      // to the same red "failed" badge color — deliberately not inventing a
      // fourth badge color, since STAGE_LABELS already makes them
      // text-distinguishable ("Runtime Failed" vs "Reasoning Failed" vs
      // "Verification Failed"), which is what the Dashboard needed to
      // "clearly distinguish" them; a new color per failure type is a
      // bigger visual-design decision this sprint didn't ask for.
      const AUTOMATED_STAGES = {
        running: 'running',
        completed: 'succeeded',
        failed: 'failed',
        runtime_failed: 'failed',
        reasoning_failed: 'failed',
        verification_failed: 'failed',
      };
      const FAILURE_STAGES = new Set(['failed', 'runtime_failed', 'reasoning_failed', 'verification_failed']);

      const itemRows = r.items.map(item => {
        let stageCell;
        if (RUNTIME_STAGE_SET.has(item.stage)) {
          // Sprint 26 — Live Runtime Progress: item.stage is now one of the
          // real Runtime stage ids (set by benchmarkService.js's onProgress
          // handler as each stage actually starts) — reuses the exact same
          // segment-bar markup the legacy manual STAGES already render
          // with below, just against the Runtime's own fixed sequence
          // instead of the old 9-step manual one, plus a `.current` marker
          // on the in-flight segment (new, small CSS addition) so "current
          // stage" and "completed stages" are both visible at a glance.
          const seq = runtimeSequenceFor(r, item);
          const stageIdx = seq.indexOf(item.stage);
          const segs = seq.map((s, i) => `<div class="seg ${i < stageIdx ? 'done' : i === stageIdx ? 'current' : ''}"></div>`).join('');
          const pct = seq.length ? Math.round(((stageIdx + 1) / seq.length) * 100) : 0;
          const elapsed = item.started_at ? formatElapsed(Date.now() - new Date(item.started_at).getTime()) : null;
          stageCell = `
            <div class="queue-item-stage-bar" style="display:block">
              <div style="display:flex;gap:2px;margin-bottom:4px">${segs}</div>
              <span class="hb-stage-badge running">${STAGE_LABELS[item.stage] || item.stage}</span>
              <span class="text-3" style="font-size:11px;margin-left:8px">Step ${stageIdx + 1} of ${seq.length} · ~${pct}%${elapsed ? ` · ${elapsed} elapsed` : ''}</span>
            </div>`;
        } else if (AUTOMATED_STAGES[item.stage]) {
          const timing = [
            item.started_at ? `Started ${new Date(item.started_at).toLocaleTimeString()}` : null,
            item.completed_at ? `Finished ${new Date(item.completed_at).toLocaleTimeString()}` : null,
          ].filter(Boolean).join(' · ');
          // Sprint 26: "the stage where execution stopped" — item.failed_stage
          // is the raw Runtime stage id benchmarkService.js captured right
          // before overwriting item.stage with the classified failure state.
          const isFailure = FAILURE_STAGES.has(item.stage);
          const stoppedAt = isFailure && item.failed_stage
            ? `<div class="text-3" style="font-size:11px;margin-top:2px">Stopped at: ${STAGE_LABELS[item.failed_stage] || item.failed_stage}</div>`
            : '';
          // Sprint 27 (P0-3, Priority 4): a plain-language "what does this
          // mean" line under every failure badge (FAILURE_STAGE_DESC), not
          // just a hover tooltip — and, for a completed item, the success
          // message benchmarkService.js already writes
          // ("Completed successfully — output verified.") now actually
          // reaches the UI instead of being silently discarded (it was
          // only ever read for failure stages before this sprint).
          const explanation = isFailure
            ? `<div class="text-3" style="font-size:11px;margin-top:2px;line-height:1.5">${FAILURE_STAGE_DESC[item.stage] || ''}</div>`
            : item.stage === 'completed' && item.execution_message
              ? `<div class="text-3" style="font-size:11px;margin-top:2px;color:var(--green)">✓ ${item.execution_message}</div>`
              : '';
          stageCell = `
            <div class="queue-item-stage-bar" style="display:block">
              <span class="hb-stage-badge ${AUTOMATED_STAGES[item.stage]}" title="${isFailure ? (FAILURE_STAGE_DESC[item.stage] || '') : ''}">${STAGE_LABELS[item.stage]}</span>
              ${timing ? `<span class="text-3" style="font-size:11px;margin-left:8px">${timing}</span>` : ''}
              ${stoppedAt}
              ${explanation}
              ${isFailure && item.execution_message ? `<div class="text-sm" style="color:var(--red);margin-top:4px">${item.execution_message}</div>` : ''}
            </div>`;
        } else {
          const stageIdx = stages.indexOf(item.stage);
          const segs = stages.map((s, i) => `<div class="seg ${i <= stageIdx ? 'done' : ''}"></div>`).join('');
          stageCell = `<div class="queue-item-stage-bar">${segs}</div>`;
        }

        return `
          <div class="queue-item-row">
            <div class="queue-item-name">${item.name}${item.is_new_company ? ' <span class="badge badge-purple" style="font-size:9px">New</span>' : ''}</div>
            ${stageCell}
            <div class="queue-item-stage-label">${STAGE_LABELS[item.stage] || item.stage}</div>
            <div class="queue-item-actions workspace-only" style="display:flex;gap:6px;align-items:center">
              <button class="btn btn-ghost" style="font-size:11px;padding:5px 10px" onclick="openBenchmarkDetailsModal('${r.id}','${item.slug}')">Details</button>
            </div>
          </div>`;
      }).join('');

      const isCancelled = r.status === 'cancelled';
      return `
        <div class="queue-batch ${isCancelled ? 'cancelled' : ''}">
          <div class="queue-batch-header">
            <div>
              <div class="queue-batch-title">${r.feature} <span class="badge badge-gray" style="margin-left:6px">${r.benchmark_type}</span></div>
              <div class="queue-batch-sub tech-info">${r.id}</div>
              <div class="queue-meta-row">
                <span><strong>Created</strong> ${new Date(r.created_at).toLocaleDateString()}${r.created_by ? ` by ${r.created_by}` : ''}</span>
                <span><strong>Scope</strong> ${(r.scope || []).join(', ') || 'End-to-End Journey'}</span>
                <span><strong>Last updated</strong> ${lastUpdatedAt(r).toLocaleString()}</span>
                ${isActive && estimateCompletionDate(r) > new Date() ? `<span><strong>Est. completion</strong> ${estimateCompletionDate(r).toLocaleString()}</span>` : ''}
              </div>
            </div>
            <div style="text-align:right">
              <span class="badge ${badgeCls}">${r.status.replace('_', ' ')}</span>
              <div class="queue-progress-pct mt-2" style="color:${isCancelled ? 'var(--text-3)' : scoreColor(pct / 20)}">${pct}%</div>
              <div class="queue-batch-progress">${doneCount} / ${r.items.length} completed</div>
              ${r.status !== 'complete' && r.status !== 'cancelled' ? `<button class="btn btn-ghost workspace-only mt-2" style="font-size:11px;padding:4px 10px" onclick="cancelBatch('${r.id}')">Cancel</button>` : ''}
            </div>
          </div>
          ${itemRows}
        </div>`;
    }).join('');
  }

  window.queueStatusFilter = function(status) {
    _queue_filter = status;
    const bar = document.getElementById('queue-filter-bar');
    if (bar) bar.innerHTML = filterBarHtml();
    renderList();
  };

  setContent(`
    <div id="queue-filter-bar">${filterBarHtml()}</div>
    <div id="queue-list"></div>`);
  renderList();

  // Sprint 26 — Live Runtime Progress: poll while anything is actually in
  // flight, so a running benchmark's segment bar/elapsed time advance on
  // their own instead of only updating on the next manual navigation —
  // same 2s-interval idiom hbPollRun() already uses for the Homepage
  // Benchmark run panel, not a new polling mechanism.
  const hasActiveItem = () => requests.some(r => r.items.some(i => ACTIVE_QUEUE_STAGES.has(i.stage)));
  if (hasActiveItem()) {
    _queue_poll_timer = setInterval(async () => {
      try {
        const fresh = await getRequests(true);
        requests = fresh.requests;
        renderList();
        if (!hasActiveItem()) clearInterval(_queue_poll_timer);
      } catch {
        clearInterval(_queue_poll_timer);
      }
    }, 2000);
  }
}

window.cancelBatch = async function(requestId) {
  if (!(await showConfirmModal('Cancel this benchmark request? This cannot be undone.', { title: 'Cancel benchmark request', confirmLabel: 'Cancel Request' }))) return;
  try {
    await api.post(`/api/requests/${requestId}/cancel`, {});
    await renderQueue();
    await initSidebar();
  } catch (e) {
    showAlertModal(e.message || 'Could not cancel request.');
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
  const reportLink = item.stage === 'completed'
    ? `<div class="wizard-review-row"><label>Result</label><span class="value"><a href="#benchmarks?feature=${encodeURIComponent(request.feature)}" onclick="closeModal()">View report →</a></span></div>`
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

// ─── Page: All Benchmarks ─────────────────────────────────────────────────────
async function renderBenchmarks(query) {
  setTitle('Benchmark Library');
  setTopbarActions('');
  setContent(`<div class="loading-state"><div class="spinner"></div><div>Loading…</div></div>`);

  const queryFeature = query?.get('feature');
  if (queryFeature) { _library_filters.feature = queryFeature; _library_filters.view = 'All'; }

  const [benchmarks, featureData, requestsData] = await Promise.all([
    getBenchmarks(),
    api.get('/api/feature-benchmarks').catch(() => ({ items: [] })),
    getRequests().catch(() => ({ requests: [] })),
  ]);
  const categories = ['All', ...Array.from(new Set(benchmarks.map(b => b.category))).sort()];
  const CATEGORY_LABELS = { 'AI-first': 'AI Native' };
  const featureItems = featureData.items || [];
  const requests = requestsData.requests || [];

  const featureNames = Array.from(new Set([
    ...requests.map(r => r.feature),
    ...featureItems.map(fb => fb.request?.feature).filter(Boolean),
  ].filter(Boolean))).sort();

  function companiesForFeature(feature) {
    const names = new Set();
    requests.filter(r => r.feature === feature).forEach(r => r.items.forEach(i => names.add(i.name)));
    return names;
  }

  function filterBarHtml() {
    const f = _library_filters;
    return `
      <div class="filter-bar">
        <input type="text" class="form-input filter-search-input" placeholder="Search by company name…" value="${f.q}" oninput="libraryFilterChanged(this.value)" />
        ${categories.map(c => `<div class="filter-chip ${f.category === c ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.category === c}" onclick="libraryCategoryFilter('${c}')">${CATEGORY_LABELS[c] || c}</div>`).join('')}
        <div class="filter-chip ${f.ai ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.ai}" onclick="libraryToggleAI()">AI</div>
        <span style="width:1px;background:var(--border);align-self:stretch"></span>
        ${['All', 'Complete', 'Pending'].map(s => `<div class="filter-chip ${f.status === s ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.status === s}" onclick="libraryStatusFilter('${s}')">${s}</div>`).join('')}
      </div>
      <div class="filter-bar">
        <select class="form-select" style="max-width:220px" onchange="libraryFeatureFilter(this.value)">
          <option value="All" ${f.feature === 'All' ? 'selected' : ''}>All Features</option>
          ${featureNames.map(n => `<option value="${n}" ${f.feature === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
        ${['All', 'Complete Journey', 'Feature Benchmark'].map(v => `<div class="filter-chip ${f.view === v ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.view === v}" onclick="libraryViewFilter('${v}')">${v}</div>`).join('')}
        <span style="width:1px;background:var(--border);align-self:stretch"></span>
        <div class="filter-chip ${f.dateSort === 'newest' ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.dateSort === 'newest'}" onclick="libraryDateSort('newest')">Newest</div>
        <div class="filter-chip ${f.dateSort === 'oldest' ? 'active' : ''}" role="button" tabindex="0" aria-pressed="${f.dateSort === 'oldest'}" onclick="libraryDateSort('oldest')">Oldest</div>
      </div>`;
  }

  function renderFilterBar() {
    const el = document.getElementById('library-filter-bar');
    if (el) el.innerHTML = filterBarHtml();
  }

  function renderResults() {
    const f = _library_filters;
    const featureCompanySet = f.feature !== 'All' ? companiesForFeature(f.feature) : null;

    let filtered = benchmarks.filter(b => {
      if (f.category !== 'All' && b.category !== f.category) return false;
      if (f.status === 'Complete' && b.status !== 'complete') return false;
      if (f.status === 'Pending' && b.status !== 'pending') return false;
      if (f.ai && (!b.ai_maturity || b.ai_maturity === 'Absent')) return false;
      if (f.q && !b.name.toLowerCase().includes(f.q.toLowerCase())) return false;
      if (featureCompanySet && !featureCompanySet.has(b.name)) return false;
      return true;
    });

    filtered = filtered.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : -Infinity;
      const db = b.date ? new Date(b.date).getTime() : -Infinity;
      return f.dateSort === 'oldest' ? da - db : db - da;
    });

    const el = document.getElementById('library-results');
    if (!el) return;

    if (f.view === 'Feature Benchmark') { el.innerHTML = ''; return; }

    if (filtered.length === 0) {
      el.innerHTML = `<div class="empty-state"><h3>No benchmarks match these filters</h3></div>`;
      return;
    }
    const byCategory = {};
    filtered.forEach(b => { (byCategory[b.category] = byCategory[b.category] || []).push(b); });
    el.innerHTML = Object.entries(byCategory).map(([cat, items]) => `
      <div class="section-header mt-4">
        <div><div class="section-title">${CATEGORY_LABELS[cat] || cat}</div><div class="section-sub">${items.length} compan${items.length === 1 ? 'y' : 'ies'}</div></div>
      </div>
      <div class="card-grid mb-4">${items.map(b => benchmarkCardHtml(b)).join('')}</div>`).join('');
    attachCardClicks();
  }

  function renderFeatureSection() {
    const el = document.getElementById('library-feature-section');
    if (!el) return;
    const f = _library_filters;
    if (f.view === 'Complete Journey') { el.innerHTML = ''; return; }

    let items = featureItems;
    if (f.feature !== 'All') items = items.filter(fb => fb.request?.feature === f.feature);
    if (f.q) {
      const q = f.q.toLowerCase();
      items = items.filter(fb => (fb.request?.feature || fb.feature_slug).toLowerCase().includes(q)
        || (fb.request?.items || []).some(i => i.name.toLowerCase().includes(q)));
    }

    if (items.length === 0) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="section-header mt-4">
        <div><div class="section-title">Feature Benchmarks</div><div class="section-sub">${items.length} focused comparison${items.length === 1 ? '' : 's'}</div></div>
      </div>
      <div class="card-grid mb-4">
        ${items.map(fb => `
          <div class="card">
            <div class="bc-name">${fb.request?.feature || fb.feature_slug}</div>
            <div class="bc-category">Feature Benchmark${fb.request ? ` · ${fb.request.status.replace('_', ' ')}` : ''}</div>
            <div class="mt-3 text-sm text-2">${(fb.request?.items || []).map(i => i.name).join(', ') || '—'}</div>
          </div>`).join('')}
      </div>`;
  }

  window.libraryFilterChanged = function(q) { _library_filters.q = q; renderResults(); renderFeatureSection(); };
  window.libraryCategoryFilter = function(cat) { _library_filters.category = cat; renderFilterBar(); renderResults(); };
  window.libraryStatusFilter = function(status) { _library_filters.status = status; renderFilterBar(); renderResults(); };
  window.libraryToggleAI = function() { _library_filters.ai = !_library_filters.ai; renderFilterBar(); renderResults(); };
  window.libraryFeatureFilter = function(feature) { _library_filters.feature = feature; renderFilterBar(); renderResults(); renderFeatureSection(); };
  window.libraryViewFilter = function(view) { _library_filters.view = view; renderFilterBar(); renderResults(); renderFeatureSection(); };
  window.libraryDateSort = function(sort) { _library_filters.dateSort = sort; renderFilterBar(); renderResults(); };

  setContent(`
    <div id="library-filter-bar">${filterBarHtml()}</div>
    <div id="library-results"></div>
    <div id="library-feature-section"></div>`);

  renderResults();
  renderFeatureSection();
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
    setupPresentationMode();
    setupGlobalSearch();
    setupMobileSidebar();
    setupMobileSearch();
    await initSidebar();
    await route(location.hash);
  } catch (e) {
    document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠</div>
        <h3>Could not connect to dashboard server</h3>
        <p>Make sure the server is running:<br><code>cd 10_Dashboard && npm install && node server.js</code></p>
        <p style="margin-top:8px">Then open <a href="http://localhost:3000" style="color:var(--accent)">http://localhost:3000</a></p>
      </div>`;
  }
}

init();
