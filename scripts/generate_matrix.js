/**
 * generate_matrix.js
 *
 * Reads Master_Benchmark_Matrix.json and regenerates Master_Benchmark_Matrix.md.
 * Run after every benchmark update: node scripts/generate_matrix.js
 *
 * The JSON is the source of truth. Never edit the Markdown directly.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const data = JSON.parse(readFileSync(join(ROOT, 'Master_Benchmark_Matrix.json'), 'utf8'));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DISPLAY_COLUMNS = [
  ...data.benchmark_plan.map(p => p.slug),
  'saudia'
];

function companyName(slug) {
  if (slug === 'saudia') return '**Saudia** (baseline)';
  const plan = data.benchmark_plan.find(p => p.slug === slug);
  return plan ? plan.name : slug;
}

function isPending(slug) {
  if (slug === 'saudia') return false;
  const plan = data.benchmark_plan.find(p => p.slug === slug);
  return !plan || plan.status !== 'complete';
}

function get(slug, path) {
  if (isPending(slug)) return '—';
  const co = data.companies[slug];
  if (!co) return '—';
  const parts = path.split('.');
  let val = co;
  for (const p of parts) {
    if (val == null) return '—';
    val = val[p];
  }
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? '✅' : '❌';
  return String(val);
}

function getLabel(slug, section, id) {
  if (isPending(slug)) return '—';
  const co = data.companies[slug];
  if (!co || !co[section] || !co[section][id]) return '—';
  return co[section][id].label || '—';
}

function getScore(slug, step) {
  if (isPending(slug)) return '—';
  const co = data.companies[slug];
  if (!co?.journey_scores?.[step]) return '—';
  const s = co.journey_scores[step];
  if (s.applicable === false) return 'N/A';
  return s.score != null ? String(s.score) : '—';
}

function getInnovation(slug, dim) {
  if (isPending(slug)) return '—';
  const co = data.companies[slug];
  if (!co?.innovation_scores) return '—';
  const v = co.innovation_scores[dim];
  return v != null ? String(v) : '—';
}

// ─── Table builder ───────────────────────────────────────────────────────────

function table(headers, rows) {
  const all = [headers, headers.map(() => '---'), ...rows];
  return all.map(row => '| ' + row.join(' | ') + ' |').join('\n');
}

// ─── Sections ────────────────────────────────────────────────────────────────

function legend() {
  return `## Legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Strong / Present / Best-in-class |
| ⚡ | Partial / Emerging / In development |
| ❌ | Absent / Not present |
| — | Not yet benchmarked |
| **Bold** | Best in class for this capability |

**Saudia column** = current estimated baseline, not formally benchmarked.`;
}

function section1() {
  const dims = data.schema.overview_dimensions;
  const headers = ['Dimension', ...DISPLAY_COLUMNS.map(companyName)];
  const rows = dims.map(dim => {
    const cells = DISPLAY_COLUMNS.map(slug => {
      if (isPending(slug)) return '—';
      const co = data.companies[slug];
      if (!co) return '—';
      const v = co.overview[dim.id];
      if (v === undefined || v === null) return '—';
      if (typeof v === 'boolean') {
        if (dim.id === 'has_loyalty' && co.overview.loyalty_name) {
          return v ? `✅ ${co.overview.loyalty_name}` : '❌';
        }
        if (dim.id === 'b2b_platform' && co.overview.b2b_platform_name) {
          return v ? `✅ ${co.overview.b2b_platform_name}` : '❌';
        }
        return v ? '✅' : '❌';
      }
      return String(v);
    });
    return [`**${dim.label}**`, ...cells];
  });
  return `## SECTION 1 — PRODUCT OVERVIEW\n\n${table(headers, rows)}`;
}

function section2() {
  const caps = data.schema.ai_capabilities;
  const headers = ['AI Capability', ...DISPLAY_COLUMNS.map(companyName)];
  const rows = caps.map(cap => {
    const cells = DISPLAY_COLUMNS.map(slug => getLabel(slug, 'ai_capabilities', cap.id));
    return [`**${cap.label}**`, ...cells];
  });
  return `## SECTION 2 — AI CAPABILITIES\n\n${table(headers, rows)}`;
}

function section3() {
  const patterns = data.schema.ux_patterns;
  const headers = ['UX Pattern', ...DISPLAY_COLUMNS.map(companyName)];
  const rows = patterns.map(pat => {
    const cells = DISPLAY_COLUMNS.map(slug => getLabel(slug, 'ux_patterns', pat.id));
    return [`**${pat.label}**`, ...cells];
  });
  return `## SECTION 3 — CORE UX PATTERNS\n\n${table(headers, rows)}`;
}

function section4() {
  const steps = data.schema.journey_steps;
  const scoredSlugs = DISPLAY_COLUMNS.filter(s => s === 'saudia' || !isPending(s));
  const headers = ['Journey Step', ...scoredSlugs.map(companyName)];
  const rows = [
    ...steps.map(step => {
      const cells = scoredSlugs.map(slug => getScore(slug, step.id));
      return [`**${step.label}**`, ...cells];
    }),
    ['**Overall**', ...scoredSlugs.map(slug => {
      if (isPending(slug)) return '—';
      const co = data.companies[slug];
      return co?.journey_scores?.overall != null ? String(co.journey_scores.overall) : '—';
    })],
    ['**Applicable Steps Score**', ...scoredSlugs.map(slug => {
      if (isPending(slug)) return '—';
      const co = data.companies[slug];
      return co?.journey_scores?.applicable_steps_score != null
        ? String(co.journey_scores.applicable_steps_score)
        : '—';
    })],
  ];
  return `## SECTION 4 — JOURNEY STEP SCORES (1–5)\n\n${table(headers, rows)}`;
}

function section5() {
  const dims = data.schema.innovation_dimensions;
  const scoredSlugs = DISPLAY_COLUMNS.filter(s => s === 'saudia' || !isPending(s));
  const headers = ['Dimension', ...scoredSlugs.map(companyName)];
  const rows = [
    ...dims.map(dim => {
      const cells = scoredSlugs.map(slug => getInnovation(slug, dim.id));
      return [`**${dim.label}**`, ...cells];
    }),
    ['**Overall Score**', ...scoredSlugs.map(slug => {
      if (isPending(slug)) return '—';
      return getInnovation(slug, 'overall');
    })],
    ['**Innovation Count** *(steps scoring 4+ on Innovation)*', ...scoredSlugs.map(slug => {
      if (isPending(slug)) return '—';
      const co = data.companies[slug];
      const c = co?.innovation_scores?.innovation_count;
      const total = co?.journey_scores?.applicable_steps_count;
      return c != null ? `${c}${total ? ' / ' + total : ''}` : '—';
    })],
  ];
  return `## SECTION 5 — INNOVATION SCORES (1–5 per Dimension)\n\n${table(headers, rows)}`;
}

function section6() {
  const tracker = data.pattern_tracker;
  const benchmarked = DISPLAY_COLUMNS.filter(s => !isPending(s) && s !== 'saudia');
  const headers = ['Pattern', ...benchmarked.map(companyName), 'Count', 'Status'];
  const rows = Object.entries(tracker).map(([id, pat]) => {
    const cells = benchmarked.map(slug => pat.companies.includes(slug) ? '✅' : '❌');
    const thresh = pat.table_stakes_at || 5;
    const pct = pat.count >= thresh ? '🔴 **TABLE STAKES**' : pat.status;
    return [`**${pat.label}**`, ...cells, String(pat.count), pct];
  });
  return `## SECTION 6 — PATTERN CLASSIFICATION TRACKER

*3+ companies = Emerging Trend. 5+ companies = Table Stakes (Must Have for Saudia).*

${table(headers, rows)}`;
}

function section7() {
  const gap = data.saudia_gap;
  const headers = ['Capability / Pattern', 'Best in Class', 'Best Score', 'Saudia Today', 'Gap', 'Priority', 'Timeline'];
  const rows = Object.values(gap).map(g => {
    const bic = g.best_in_class === 'saudia' ? '**Saudia leads**'
      : g.best_in_class === 'not_benchmarked_yet' ? '—'
      : g.best_in_class === 'saudia_opportunity' ? 'Saudia opportunity'
      : g.best_in_class;
    return [
      `**${g.label}**`,
      bic,
      g.best_score != null ? String(g.best_score) : '—',
      g.saudia_today,
      g.gap,
      g.priority,
      g.timeline,
    ];
  });
  return `## SECTION 7 — SAUDIA GAP ANALYSIS

*Where is Saudia today vs. best-in-class? Priority and timeline to close each gap.*

${table(headers, rows)}`;
}

function section8() {
  const headers = ['#', 'Company', 'Category', 'Status', 'Date', 'Overall Score'];
  const rows = data.benchmark_plan.map(p => {
    const statusIcon = p.status === 'complete' ? '✅ Complete'
      : p.status === 'next' ? '⏳ Next'
      : '🔲 Queued';
    return [
      String(p.rank),
      `**${p.name}**`,
      p.category,
      statusIcon,
      p.date || '—',
      p.overall_score != null ? String(p.overall_score) : '—',
    ];
  });
  const complete = data.benchmark_plan.filter(p => p.status === 'complete').length;
  const total = data.benchmark_plan.length;
  return `## SECTION 8 — BENCHMARK PROGRESS\n\n**${complete} / ${total} complete**\n\n${table(headers, rows)}`;
}

function section9() {
  const insights = data.key_insights;
  const blocks = insights.map(i => {
    const watchList = (i.watch_for_in_next_benchmarks || [])
      .map(w => `- ${w}`).join('\n');
    return `### After Benchmark #${i.after_benchmark} (${i.company}) — ${i.date}

**${i.headline}**

${i.synthesis}

**Saudia imperative:** ${i.saudia_imperative}

**Watch for in upcoming benchmarks:**
${watchList}`;
  }).join('\n\n---\n\n');

  return `## SECTION 9 — KEY INSIGHTS\n\n*Synthesis layer. Updated after every benchmark.*\n\n${blocks}`;
}

// ─── Full document ────────────────────────────────────────────────────────────

function statusBar() {
  const complete = data.benchmark_plan.filter(p => p.status === 'complete').length;
  const names = data.benchmark_plan.map(p => {
    const done = p.status === 'complete';
    return done ? `${p.name} ✓` : p.name;
  }).join(' | ');
  return `**Last updated:** ${data._meta.last_updated}
**Benchmarks complete:** ${complete} / ${data._meta.total_benchmarks_planned}
**Companies:** ${names}`;
}

const md = `# AI Travel Experience — Master Benchmark Matrix

**Primary artifact of this project.**
Every benchmark updates the JSON source of truth first. This Markdown is auto-generated — do not edit it directly.
Run \`node scripts/generate_matrix.js\` to regenerate after any JSON update.

${statusBar()}

---

${legend()}

---

${section1()}

---

${section2()}

---

${section3()}

---

${section4()}

---

${section5()}

---

${section6()}

---

${section7()}

---

${section8()}

---

${section9()}
`;

writeFileSync(join(ROOT, 'Master_Benchmark_Matrix.md'), md, 'utf8');
console.log('✅ Master_Benchmark_Matrix.md regenerated successfully.');
console.log(`   Benchmarks complete: ${data.benchmark_plan.filter(p => p.status === 'complete').length} / ${data.benchmark_plan.length}`);
console.log(`   Last updated: ${data._meta.last_updated}`);
