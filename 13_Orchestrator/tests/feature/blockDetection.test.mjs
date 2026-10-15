/**
 * Bot-protection pages must never count as a captured page.
 *
 * Real cases from this repo's own run history:
 *  - Emirates: navigation landed on /error/accessrestricted.html ("The page
 *    you're trying to access is restricted. Reference number: 18.a78…") and
 *    the run was recorded as step status 'success'.
 *  - Qatar Airways: 8 of 8 runs recorded 'success' on an Akamai
 *    "Access Denied … Reference #18.d65e3356…" page (298 bytes of HTML).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectBlockedPage } from '../../runtime/pageBlockDetector.js';
import { markBlockedSteps } from '../../stages/navigationRunnerStage.js';
import { selectEvidence } from '../../stages/featureVisionStage.js';
import { resolveFeatureIntent } from '../../featureNavigation/featureIntent.js';
import { createBenchmarkTarget } from '../../runtime/benchmarkTarget.js';
import { makeWorkspace } from './_pipelineHelper.mjs';

const QATAR_AKAMAI = '<HTML><HEAD>\n<TITLE>Access Denied</TITLE>\n</HEAD><BODY>\n<H1>Access Denied</H1>\n \nYou don\'t have permission to access "http&#58;&#47;&#47;www&#46;qatarairways&#46;com&#47;" on this server.<P>\nReference&#32;&#35;18&#46;d65e3356&#46;1788072974&#46;6a982082\n<P>https&#58;&#47;&#47;errors&#46;edgesuite&#46;net&#47;18&#46;d65e3356&#46;1788072974&#46;6a982082</P>\n</BODY>\n</HTML>';
const QATAR_AKAMAI_DECODED = '<html><head><title>Access Denied</title></head><body><h1>Access Denied</h1>You don\'t have permission to access "http://www.qatarairways.com/" on this server.<p>Reference #18.d65e3356.1788072974.6a982082</p></body></html>';
const EMIRATES_RESTRICTED = '<html><head><title>Book Flights | Find Hotels and Car Rental | Emirates</title></head><body><h1>We’re Sorry</h1><p>The page you’re trying to access is restricted. Reference number: 18.a78ad7d4.1788244964.207c99df.&nbsp;</p><p>Please go to emirates.com if you’d like to search, book or manage flights.</p></body></html>';
const REAL_HOMEPAGE = `<html><head><title>Saudia | Book flights</title><script src="https://www.google.com/recaptcha/api.js"></script><script>var captcha = "recaptcha"; // access denied handler</script></head><body>${'<section><h2>Book a flight</h2><p>From Jeddah to Riyadh, Dubai, Doha and 100+ destinations. Choose your fare, add baggage, select a seat and check in online. </p></section>'.repeat(60)}<footer>This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.</footer></body></html>`;

test('detectBlockedPage: Akamai "Access Denied" (Qatar Airways) is blocked', () => {
  assert.equal(detectBlockedPage({ url: 'https://www.qatarairways.com/', html: QATAR_AKAMAI_DECODED }).blocked, true);
});

test('detectBlockedPage: Emirates "page … is restricted / Reference number" is blocked, by text alone', () => {
  const r = detectBlockedPage({ url: 'https://www.emirates.com/sa/english/', html: EMIRATES_RESTRICTED });
  assert.equal(r.blocked, true);
  assert.match(r.id, /access_restricted|akamai_reference/);
});

test('detectBlockedPage: an access-restricted URL is blocked even with no HTML', () => {
  assert.equal(detectBlockedPage({ url: 'https://www.emirates.com/error/accessrestricted.html?refid=18.a' }).blocked, true);
});

test('detectBlockedPage: Cloudflare "Just a moment" interstitial is blocked', () => {
  const html = '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing flynas.com. Cloudflare Ray ID: 8c1</body></html>';
  assert.equal(detectBlockedPage({ url: 'https://www.flynas.com/', html }).blocked, true);
});

test('detectBlockedPage: a real long page that loads reCAPTCHA is NOT blocked', () => {
  const r = detectBlockedPage({ url: 'https://www.saudia.com/', html: REAL_HOMEPAGE });
  assert.equal(r.blocked, false, r.reason);
});

test('markBlockedSteps downgrades a "success" step on a block page to blocked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'blk-'));
  try {
    const html = join(dir, 'page.html');
    writeFileSync(html, QATAR_AKAMAI_DECODED);
    const steps = [
      { step_id: 'step_01_entry', status: 'success', page_url: 'https://www.qatarairways.com/', html_snapshot_path: html },
      { step_id: 'step_02', status: 'failed', page_url: 'https://www.qatarairways.com/' },
    ];
    const blocked = markBlockedSteps(steps);
    assert.equal(blocked.length, 1);
    assert.equal(steps[0].status, 'blocked');
    assert.equal(steps[0].goal.targetStatus, 'blocked_bot_protection');
    assert.equal(steps[1].status, 'failed', 'failed steps are left alone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('selectEvidence never accepts a blocked homepage as homepage_base evidence', () => {
  const { cwd, shot } = makeWorkspace();
  try {
    const target = createBenchmarkTarget({ company: 'Qatar Airways', slug: 'qatar_airways', url: 'https://www.qatarairways.com/', feature: 'Homepage', scope: [], requestId: 'req_b' });
    const steps = [{ step_id: 'step_01_entry', status: 'blocked', page_url: 'https://www.qatarairways.com/', screenshot_path: shot, goal: { targetStatus: 'blocked_bot_protection', blocker: 'bot protection detected' } }];
    const { evidence } = selectEvidence({ steps, target, intent: resolveFeatureIntent('Homepage') });
    assert.notEqual(evidence.evidenceType, 'homepage_base');
    assert.notEqual(evidence.relevance, 'direct');
    assert.equal(evidence.navBlocked, true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

