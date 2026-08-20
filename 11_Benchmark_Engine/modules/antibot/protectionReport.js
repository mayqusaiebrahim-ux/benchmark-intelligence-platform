/**
 * protectionReport.js — writes a "Protection Detection Report" for every
 * company the Anti-Bot Layer could not get past before Discovery. This is a
 * distinct artifact from modules/reports/homepageReport.js's homepage
 * benchmark report (which is untouched) — it lives under its own
 * _Protection_Reports/ folder, saved immediately, same "don't wait for the
 * whole batch" principle Sprint 13 already established.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

function summarizeAttempt(a) {
  const outcome = a.type === 'clean' ? 'clean' : a.id;
  const evidence = (a.evidence || []).join('; ');
  return `- **${a.strategyId}** (${(a.durationMs / 1000).toFixed(1)}s${a.delayMs ? `, ${a.delayMs}ms pre-delay` : ''}): ${outcome}${a.status ? ` — HTTP ${a.status}` : ''}${evidence ? ` — ${evidence}` : ''}`;
}

function renderMarkdown({ companyName, url, probeResult }) {
  const verdict = probeResult.permanent
    ? '🔴 Permanent — no further attempts are expected to succeed'
    : '🟡 Blocked after exhausting all fallback strategies — may succeed on a later Scheduler-level retry';

  return `# Protection Detection Report — ${companyName}

**URL:** ${url}
**Detected at:** ${new Date().toISOString()}
**Classification:** \`${probeResult.classification}\`${probeResult.vendor ? ` (vendor signature: **${probeResult.vendor}**)` : ''}
**Verdict:** ${verdict}

> Produced by the Sprint 14 Smart Anti-Bot Layer, before Discovery ever ran.
> Discovery, Reports, and the Scheduler were not modified to produce this —
> this report only exists because the probe could not find a strategy that
> got a clean read of the homepage.

## Strategies attempted (in order)

${probeResult.attempts.map(summarizeAttempt).join('\n')}

## What this means

${probeResult.permanent
  ? 'The first attempt already returned a signal that no amount of browser-launch or timing variation can work around (e.g. the domain does not resolve, a TLS/certificate error, or explicit "banned" language in the response). Remaining strategies were skipped deliberately — retrying them would not change the outcome.'
  : `All ${probeResult.attempts.length} fallback strategies were tried — varying launch flags, wait conditions, navigation speed, and randomized delay — and none produced a clean, unprotected read of the homepage. This site's bot defense (${probeResult.vendor || 'vendor unidentified'}) is either consistently strict regardless of these signals, or the block is scoped to something this probe can't vary (e.g. the source IP itself). Discovery was not run for this company on this attempt.`}
`;
}

export function writeProtectionReport({ companyName, companySlug, url, probeResult }) {
  const dir = join(PROJECT_ROOT, '02_Benchmark_Repository', '_Protection_Reports', companySlug);
  mkdirSync(dir, { recursive: true });

  const report = {
    company_name: companyName,
    company_slug: companySlug,
    url,
    detected_at: new Date().toISOString(),
    classification: probeResult.classification,
    vendor: probeResult.vendor || null,
    permanent: probeResult.permanent,
    strategies_attempted: probeResult.attempts.map((a) => ({
      strategy_id: a.strategyId,
      duration_ms: a.durationMs,
      pre_delay_ms: a.delayMs,
      outcome: a.type,
      classification_id: a.type === 'clean' ? null : a.id,
      http_status: a.status ?? null,
      evidence: a.evidence || [],
    })),
  };

  const jsonPath = join(dir, 'report.json');
  const mdPath = join(dir, 'report.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  writeFileSync(mdPath, renderMarkdown({ companyName, url, probeResult }), 'utf8');

  return { dir, jsonPath, mdPath };
}
