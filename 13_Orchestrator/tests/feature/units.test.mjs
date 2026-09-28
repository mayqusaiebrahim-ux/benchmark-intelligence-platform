/**
 * Pure-unit proofs — no providers, no mocks needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url); // a path that definitely exists on disk

import { createBenchmarkTarget, TargetIntegrityError, assertObservedUrl, sameRegistrableDomain, nameRefersToTarget } from '../../runtime/benchmarkTarget.js';
import { resolveFeatureIntent, buildFeatureJourneyPlan, mapFeatureToStepId } from '../../featureNavigation/featureIntent.js';
import { selectEvidence } from '../../stages/featureVisionStage.js';
import { verifyFeatureCompletion, checkReportGrounding } from '../../runtime/featureCompletion.js';
import { resolveOfficialUrl } from '../../../10_Dashboard/lib/companyUrls.js';

const T = { company: 'Qatar Airways', slug: 'qatar_airways', url: 'https://www.qatarairways.com/', feature: 'Homepage', requestId: 'r1' };

test('URL pre-flight: target creation throws BEFORE any browser work when URL is missing/invalid', () => {
  assert.throws(
    () => createBenchmarkTarget({ ...T, url: null }),
    (e) => e instanceof TargetIntegrityError && /no valid official website URL/i.test(e.message),
  );
  assert.throws(() => createBenchmarkTarget({ ...T, url: 'ftp://x' }), /no valid official website URL/i);
  assert.throws(() => createBenchmarkTarget({ ...T, company: '' }), /company is blank/i);
  const ok = createBenchmarkTarget(T);
  assert.equal(ok.domain, 'qatarairways.com');
  assert.throws(() => { ok.company = 'x'; }, TypeError); // frozen
});

test('domain integrity: www / path variations OK, other companies rejected', () => {
  const t = createBenchmarkTarget(T);
  assert.doesNotThrow(() => assertObservedUrl(t, 'https://www.qatarairways.com/en/homepage.html', 'x'));
  assert.doesNotThrow(() => assertObservedUrl(t, 'https://qatarairways.com/', 'x'));
  assert.doesNotThrow(() => assertObservedUrl(t, null, 'x')); // capture gap, not drift
  assert.throws(() => assertObservedUrl(t, 'https://www.turkishairlines.com/', 'x'), /not on the benchmark target's domain/i);
  assert.equal(sameRegistrableDomain('https://www.qatarairways.com', 'http://qatarairways.com/x'), true);
  assert.equal(sameRegistrableDomain('https://qatarairways.com', 'https://mindtrip.ai'), false);
});

test('feature navigation: Homepage → 1 homepage step, never the generic journey', () => {
  const t = createBenchmarkTarget(T);
  const intent = resolveFeatureIntent('Homepage');
  assert.equal(intent.stepId, 'step_01_entry');
  assert.equal(intent.homepageOnly, true);

  const plan = buildFeatureJourneyPlan({ discoveryReport: { resolved_url: 'https://www.qatarairways.com/' }, target: t, intent });
  assert.equal(plan.feature_scoped, true);
  assert.equal(plan.recommended_journey.length, 1);
  assert.equal(plan.recommended_journey[0].step_id, 'step_01_entry');
  assert.equal(plan.starting_url, 'https://www.qatarairways.com/');

  // a mapped non-homepage feature is still ONE scoped step, not 12
  assert.equal(mapFeatureToStepId('Payment'), 'step_09_payment');
  const payPlan = buildFeatureJourneyPlan({
    discoveryReport: { resolved_url: 'https://www.qatarairways.com/' },
    target: { ...t, feature: 'Payment' },
    intent: resolveFeatureIntent('Payment'),
  });
  assert.equal(payPlan.recommended_journey.length, 1);

  // an unmapped custom feature is now a GENERIC agent-driven navigation target
  // (universal web navigation) — not homepage-only, no known detector, arrival
  // verified generically.
  const custom = resolveFeatureIntent('Refund flow');
  assert.equal(custom.homepageOnly, false);
  assert.equal(custom.goalDriven, true);
  assert.equal(custom.detectorKey, null);
  assert.match(custom.note, /custom feature|verified generically/i);

  // a mapped non-homepage feature is agent-driven with a known detector for verification
  const pay = resolveFeatureIntent('Payment');
  assert.equal(pay.goalDriven, true);
  assert.equal(pay.detectorKey, 'payment');
  assert.equal(pay.homepageOnly, false);
});

test('feature navigation: buildFeatureJourneyPlan ignores an off-domain resolved_url', () => {
  const t = createBenchmarkTarget(T);
  const plan = buildFeatureJourneyPlan({
    discoveryReport: { resolved_url: 'https://evil.example.com/' },
    target: t,
    intent: resolveFeatureIntent('Homepage'),
  });
  assert.equal(plan.starting_url, 'https://www.qatarairways.com/'); // target's own URL, not the resolved one
});

test('evidence integrity: only the target homepage is accepted; unrelated screenshots are refused', () => {
  const t = createBenchmarkTarget(T);
  const intent = resolveFeatureIntent('Homepage');
  const shotDir = mkdtempSync(join(tmpdir(), 'ev-'));
  const shot = join(shotDir, 's.png');
  writeFileSync(shot, 'x');
  try {
    // Payment screenshot for a Homepage benchmark → REFUSE
    assert.throws(
      () => selectEvidence({ steps: [{ step_id: 'step_09_payment', status: 'success', page_url: 'https://www.qatarairways.com/pay', screenshot_path: shot }], target: t, intent }),
      /Refusing to analyse an unrelated screenshot/i,
    );
    // homepage screenshot on the target domain → accept (direct)
    const ok = selectEvidence({ steps: [{ step_id: 'step_01_entry', status: 'success', page_url: 'https://www.qatarairways.com/', screenshot_path: shot }], target: t, intent });
    assert.equal(ok.evidence.relevance, 'direct');
    assert.equal(ok.evidence.company, 'qatar_airways');
    assert.equal(ok.evidence.feature, 'Homepage');
    // homepage screenshot on the WRONG domain → REFUSE
    assert.throws(
      () => selectEvidence({ steps: [{ step_id: 'step_01_entry', status: 'success', page_url: 'https://www.turkishairlines.com/', screenshot_path: shot }], target: t, intent }),
      /Refusing to analyse an unrelated screenshot/i,
    );
    // no screenshot at all → REFUSE
    assert.throws(
      () => selectEvidence({ steps: [{ step_id: 'step_01_entry', status: 'failed', page_url: 'https://www.qatarairways.com/', screenshot_path: null }], target: t, intent }),
      /Refusing to analyse an unrelated screenshot/i,
    );
  } finally {
    rmSync(shotDir, { recursive: true, force: true });
  }
});

test('completion gate: fails (does not throw) on missing report / wrong evidence / wrong company', () => {
  const t = createBenchmarkTarget(T);
  const base = {
    targetCompany: 'Qatar Airways', targetFeature: 'Homepage', url: 'https://www.qatarairways.com/',
    evidence: { company: 'qatar_airways', feature: 'Homepage', url: 'https://www.qatarairways.com/', screenshotPath: THIS_FILE, relevance: 'direct' },
    visionFindings: {}, reasoningData: { feature_found: true, analyzed_company: 'Qatar Airways', summary_markdown: 'Qatar Airways homepage' },
    reportPath: '/does/not/exist.md',
  };
  const r1 = verifyFeatureCompletion({ output: base, target: t });
  assert.equal(r1.verification_status, 'failed');
  assert.ok(r1.verification_errors.some((e) => /report markdown file was not written/i.test(e)));

  const r2 = verifyFeatureCompletion({ output: { ...base, evidence: { ...base.evidence, company: 'turkish_airlines' } }, target: t });
  assert.equal(r2.verification_status, 'failed');
  assert.ok(r2.verification_errors.some((e) => /evidence company/i.test(e)));

  const r3 = verifyFeatureCompletion({ output: { ...base, reasoningData: { feature_found: true, analyzed_company: 'Mindtrip', summary_markdown: 'Mindtrip homepage AI chat' } }, target: t });
  assert.equal(r3.verification_status, 'failed');
  assert.ok(r3.verification_errors.some((e) => /does not correspond to the target/i.test(e)));
});

test('report grounding: unsupported acquisition / interaction / absence claims are caught', () => {
  // acquisition channel stated as fact — no referrer metadata exists
  assert.ok(checkReportGrounding('The user arrived from a branded Google ad and sees a hero image.').length > 0);
  assert.ok(checkReportGrounding('This is a paid-search landing page for the campaign.').length > 0);
  assert.ok(checkReportGrounding('The visitor came from an ad campaign before reaching this screen.').length > 0);

  // outcome of an interaction that was never performed
  assert.ok(checkReportGrounding('After you click the menu, it reveals six destinations.').length > 0);
  assert.ok(checkReportGrounding('Hovering over the nav reveals a mega-menu.').length > 0);

  // site-wide absence from one viewport, not scoped to the capture
  assert.ok(checkReportGrounding('The homepage has no booking widget anywhere.').length > 0);
  assert.ok(checkReportGrounding('Qatar Airways does not offer fare alerts.').length > 0);

  // GOOD phrasings — must pass clean
  assert.equal(checkReportGrounding('No booking widget is visible in the captured viewport.').length, 0);
  assert.equal(checkReportGrounding('A fare-alert entry point was not visible in the captured evidence.').length, 0);
  assert.equal(checkReportGrounding('A cookie-consent dialog covers much of the above-the-fold view, which adds friction at entry.').length, 0);
  assert.equal(checkReportGrounding('The captured viewport shows a flight search widget and a Privilege Club promo.').length, 0);

  // acquisition claim is allowed only when navigation metadata proves it
  assert.equal(checkReportGrounding('The user arrived from a Google ad.', { hasReferrerMetadata: true }).length, 0);
});

test('report grounding: correctly-scoped absence is accepted, global absence still rejected', () => {
  // ACCEPTED — scoped to the one capture (the production false-positive)
  assert.equal(checkReportGrounding(
    'This absence is scoped strictly to this one capture and does not indicate that Emirates lacks a Passenger Details step.').length, 0);
  assert.equal(checkReportGrounding('No Passenger Details step was visible in this captured viewport.').length, 0);
  assert.equal(checkReportGrounding('The booking widget was not present in the observed state.').length, 0);
  assert.equal(checkReportGrounding('A loyalty entry point is not visible in this screenshot.').length, 0);
  assert.equal(checkReportGrounding('The Passenger Details surface was not reached in this run.').length, 0);
  assert.equal(checkReportGrounding('Emirates has no visible search field in the captured viewport.').length, 0);

  // STILL REJECTED — unscoped global absence claims
  assert.ok(checkReportGrounding('Passenger Details is absent.').length > 0);
  assert.ok(checkReportGrounding('The website does not provide fare alerts.').length > 0);
  assert.ok(checkReportGrounding('Emirates has no loyalty tier for new customers.').length > 0);
  assert.ok(checkReportGrounding('There is no dedicated Passenger Details page.').length > 0);
});

test('evidence selection: a failed non-homepage step is NOT direct feature evidence', () => {
  const t = createBenchmarkTarget({ ...T, feature: 'Passenger Details' });
  const intent = resolveFeatureIntent('Passenger Details'); // -> step_07_booking, not homepage-only
  assert.equal(intent.homepageOnly, false);

  const shotDir = mkdtempSync(join(tmpdir(), 'ev2-'));
  const shot = join(shotDir, 's.png');
  writeFileSync(shot, 'x');
  try {
    // the feature's step reached the target domain but its click FAILED
    const blocked = selectEvidence({
      steps: [{ step_id: 'step_07_booking', status: 'failed', error: 'OneTrust intercepts pointer events',
        page_url: 'https://www.qatarairways.com/', screenshot_path: shot }],
      target: t, intent,
    });
    assert.equal(blocked.evidence.relevance, 'base_page');       // never "direct"
    assert.equal(blocked.evidence.evidenceType, 'blocked_state');
    assert.equal(blocked.evidence.navBlocked, true);
    assert.match(blocked.evidence.navBlockReason, /OneTrust|pointer events/i);

    // a genuinely successful step IS direct
    const ok = selectEvidence({
      steps: [{ step_id: 'step_07_booking', status: 'success',
        page_url: 'https://www.qatarairways.com/book', screenshot_path: shot }],
      target: t, intent,
    });
    assert.equal(ok.evidence.relevance, 'direct');
    assert.equal(ok.evidence.evidenceType, 'feature_page');
    assert.equal(ok.evidence.navBlocked, false);
  } finally {
    rmSync(shotDir, { recursive: true, force: true });
  }
});

test('completion gate: an ungrounded report or one with no stated limitations fails verification', () => {
  const t = createBenchmarkTarget(T);
  const dir = mkdtempSync(join(tmpdir(), 'grounding-'));
  try {
    const base = {
      targetCompany: 'Qatar Airways', targetFeature: 'Homepage', url: 'https://www.qatarairways.com/',
      evidence: { company: 'qatar_airways', feature: 'Homepage', url: 'https://www.qatarairways.com/', screenshotPath: THIS_FILE, relevance: 'direct' },
      visionFindings: {},
      reasoningData: { feature_found: true, analyzed_company: 'Qatar Airways', summary_markdown: 'x', evidence_limitations: 'Single viewport, one state.' },
    };
    const marker = `<!-- benchmark-target: company=${t.company} | slug=${t.slug} | url=${t.url} | feature=${t.feature} | request=${t.requestId} -->`;

    // ungrounded: acquisition claim, but limitations stated
    const bad = join(dir, 'bad.md');
    writeFileSync(bad, `## Qatar Airways\n${marker}\nThe user arrived from a branded Google ad. Based on a single captured viewport with no interactions performed.\n`);
    const r1 = verifyFeatureCompletion({ output: { ...base, reportPath: bad }, target: t });
    assert.equal(r1.verification_status, 'failed');
    assert.ok(r1.verification_errors.some((e) => /acquisition channel|referrer/i.test(e)));

    // grounded + limitations stated → passes
    const good = join(dir, 'good.md');
    writeFileSync(good, `## Qatar Airways\n${marker}\nThe captured viewport shows a flight search widget. No AI assistant is visible in the captured evidence.\n\n## Evidence limitations\nBased on one captured viewport, one page state, with no interactions performed.\n`);
    const r2 = verifyFeatureCompletion({ output: { ...base, reportPath: good }, target: t });
    assert.equal(r2.verification_status, 'passed', r2.verification_summary);

    // grounded but limitations NOT stated anywhere → fails
    const noLimits = join(dir, 'nolimits.md');
    writeFileSync(noLimits, `## Qatar Airways\n${marker}\nThe captured viewport shows a flight search widget.\n`);
    const r3 = verifyFeatureCompletion({
      output: { ...base, reportPath: noLimits, reasoningData: { ...base.reasoningData, evidence_limitations: '' } },
      target: t,
    });
    assert.equal(r3.verification_status, 'failed');
    assert.ok(r3.verification_errors.some((e) => /evidence limitations/i.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Completion gate: target reached is REQUIRED ───────────────────────────
// Live trace: targetReached=false, navigation unrecoverable_blocker, then
// Vision + Reasoning + report all succeeded and the run was marked Complete.
// Every stage succeeding is not target success.
function reachedFixture(t, dir, overrides = {}) {
  const marker = `<!-- benchmark-target: company=${t.company} | slug=${t.slug} | url=${t.url} | feature=${t.feature} | request=${t.requestId} -->`;
  const report = join(dir, 'report.md');
  writeFileSync(report, `## Qatar Airways\n${marker}\nThe captured viewport shows a passenger form.\n\n## Evidence limitations\nBased on one captured viewport, one page state.\n`);
  return {
    targetCompany: t.company, targetFeature: t.feature, url: 'https://www.qatarairways.com/book',
    evidence: {
      company: t.slug, feature: t.feature, url: 'https://www.qatarairways.com/book', screenshotPath: THIS_FILE,
      evidenceType: 'feature_page', relevance: 'direct', navBlocked: false, targetStatus: 'target_reached',
    },
    navBlocked: false,
    visionFindings: {},
    reasoningData: { feature_found: true, analyzed_company: 'Qatar Airways', summary_markdown: 'Qatar Airways passenger form', evidence_limitations: 'Single viewport.' },
    reportPath: report,
    ...overrides,
  };
}

test('completion gate: targetReached=true (direct evidence, target_reached, feature_found) → completion allowed', () => {
  const t = createBenchmarkTarget({ ...T, feature: 'Passenger Details' });
  const dir = mkdtempSync(join(tmpdir(), 'gate-ok-'));
  try {
    const r = verifyFeatureCompletion({ output: reachedFixture(t, dir), target: t });
    assert.equal(r.verification_status, 'passed', r.verification_summary);
    assert.equal(r.checks.target_reached, true);
    assert.equal(r.checks.feature_found, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completion gate: targetReached=false → completion rejected', () => {
  const t = createBenchmarkTarget({ ...T, feature: 'Passenger Details' });
  const dir = mkdtempSync(join(tmpdir(), 'gate-notreached-'));
  try {
    const base = reachedFixture(t, dir);
    // a goal status other than target_reached, even with otherwise-direct evidence
    const r = verifyFeatureCompletion({
      output: { ...base, evidence: { ...base.evidence, targetStatus: 'budget_exhausted' } },
      target: t,
    });
    assert.equal(r.verification_status, 'failed');
    assert.equal(r.checks.target_reached, false);
    assert.ok(r.verification_errors.some((e) => /was not reached/i.test(e) && /budget_exhausted/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completion gate: navigation blocker → verification_failed carrying the blocker, never Complete', () => {
  const t = createBenchmarkTarget({ ...T, feature: 'Passenger Details' });
  const dir = mkdtempSync(join(tmpdir(), 'gate-blocker-'));
  try {
    const base = reachedFixture(t, dir);
    const reason = 'automated navigation to "Passenger Details" stopped at: unrecoverable_blocker — connect ECONNREFUSED 127.0.0.1:36355';
    const r = verifyFeatureCompletion({
      output: {
        ...base,
        navBlocked: true,
        navBlockReason: reason,
        evidence: { ...base.evidence, evidenceType: 'blocked_state', relevance: 'base_page', navBlocked: true, navBlockReason: reason, targetStatus: 'unrecoverable_blocker' },
      },
      target: t,
    });
    assert.equal(r.verification_status, 'failed');
    assert.equal(r.checks.target_reached, false);
    assert.ok(r.verification_errors.some((e) => e.includes('ECONNREFUSED 127.0.0.1:36355')), 'the original blocker is preserved in the failure reason');
    assert.match(r.verification_summary, /cannot be marked complete/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completion gate: Vision + Reasoning + report all succeeding after a navigation failure is still NOT Complete', () => {
  const t = createBenchmarkTarget({ ...T, feature: 'Passenger Details' });
  const dir = mkdtempSync(join(tmpdir(), 'gate-postnav-'));
  try {
    const base = reachedFixture(t, dir);
    // The exact live shape: nav blocked, Vision ran, Reasoning returned a
    // valid report with feature_found=false / NOT FOUND, report written.
    const output = {
      ...base,
      navBlocked: true,
      navBlockReason: 'stopped at: unrecoverable_blocker',
      evidence: { ...base.evidence, evidenceType: 'blocked_state', relevance: 'base_page', navBlocked: true, targetStatus: 'unrecoverable_blocker' },
      visionFindings: { layout: 'homepage' },
      reasoningData: { ...base.reasoningData, feature_found: false, evidence_source: 'NOT FOUND' },
    };
    const r = verifyFeatureCompletion({ output, target: t });
    assert.equal(r.checks.vision_ran, true, 'precondition: Vision succeeded');
    assert.equal(r.checks.reasoning_ran, true, 'precondition: Reasoning succeeded');
    assert.equal(r.checks.report_written, true, 'precondition: report persisted');
    assert.equal(r.verification_status, 'failed');
    assert.equal(r.checks.target_reached, false);
    assert.equal(r.checks.feature_found, false);

    // Reasoning alone saying NOT FOUND also blocks Complete, even if nav claimed success
    const r2 = verifyFeatureCompletion({ output: { ...base, reasoningData: { ...base.reasoningData, feature_found: false } }, target: t });
    assert.equal(r2.verification_status, 'failed');
    assert.ok(r2.verification_errors.some((e) => /feature_found=false/.test(e)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('completion gate: a homepage-scoped feature with homepage_base evidence counts as reached', () => {
  const t = createBenchmarkTarget(T); // feature: Homepage
  const dir = mkdtempSync(join(tmpdir(), 'gate-home-'));
  try {
    const base = reachedFixture(t, dir);
    const r = verifyFeatureCompletion({
      output: { ...base, url: 'https://www.qatarairways.com/', evidence: { ...base.evidence, url: 'https://www.qatarairways.com/', evidenceType: 'homepage_base', relevance: 'base_page', targetStatus: undefined } },
      target: t,
    });
    assert.equal(r.checks.target_reached, true, r.verification_summary);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('contamination heuristic: names another brand but not the target → rejected', () => {
  const t = createBenchmarkTarget(T);
  assert.equal(nameRefersToTarget(t, 'The Qatar Airways homepage has a booking widget.').ok, true);
  assert.equal(nameRefersToTarget(t, "Mindtrip's homepage is an AI chat.").ok, false);
  assert.equal(nameRefersToTarget(t, 'This is a generic writeup with no company named at all.').ok, false);
});


test('collision-safe request IDs + curated URL resolution', () => {
  // import here so the file's own imports stay pure/static above
  return import('../../../10_Dashboard/lib/requestsStore.js').then((store) => {
    const tmp = mkdtempSync(join(tmpdir(), 'reqids-'));
    writeFileSync(join(tmp, 'Master_Benchmark_Matrix.json'), JSON.stringify({ benchmark_plan: [], _meta: {} }));
    try {
      const seen = new Set();
      for (let i = 0; i < 100; i++) {
        const r = store.createRequest(tmp, {
          benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: ['UX/UI only'],
          competitors: [{ name: 'Qatar Airways' }], // no URL supplied
        });
        assert.match(r.id, /^req_\d{13,}_[0-9a-f]{8}$/, `id: ${r.id}`);
        assert.ok(!seen.has(r.id), 'unique');
        seen.add(r.id);
        assert.equal(r.items[0].url, 'https://www.qatarairways.com/'); // resolved from curated table
        assert.equal(r.items[0].url_source, 'resolved:companyUrls');
      }
      // an unknown company with no URL stays unresolved (pipeline will refuse)
      const unknown = store.createRequest(tmp, {
        benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: [],
        competitors: [{ name: 'Totally Unknown Startup XYZ' }],
      });
      assert.equal(unknown.items[0].url, null);
      assert.equal(unknown.items[0].url_source, 'unresolved');
      // an explicit URL is always kept
      const explicit = store.createRequest(tmp, {
        benchmark_type: 'Feature Benchmark', feature: 'Homepage', scope: [],
        competitors: [{ name: 'Whatever', url: 'https://example.org/' }],
      });
      assert.equal(explicit.items[0].url, 'https://example.org/');
      assert.equal(explicit.items[0].url_source, 'request');
      // old-format id string: getRequest doesn't crash
      assert.equal(store.getRequest(tmp, 'req_20260707_001'), null);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

test('company URL resolution table', () => {
  assert.equal(resolveOfficialUrl('Qatar Airways'), 'https://www.qatarairways.com/');
  assert.equal(resolveOfficialUrl('qatar_airways'), 'https://www.qatarairways.com/');
  assert.equal(resolveOfficialUrl('Booking.com'), 'https://www.booking.com/');
  assert.equal(resolveOfficialUrl('Nonexistent Co'), null);
});
