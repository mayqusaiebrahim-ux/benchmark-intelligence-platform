/**
 * Cookie / consent overlay handling in the Navigation Runner.
 *
 *  1. a OneTrust overlay is dismissed (known selector + generic accessible name)
 *  2. no banner  -> handler is a no-op, the planned step action still runs
 *  3. a banner that can't be dismissed is reported cleanly, never throws
 *
 * No real browser: a tiny fake `page` drives the exact Playwright surface the
 * handler uses (locator / first / isVisible / click / all / waitForTimeout).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dismissConsentOverlay, performStepAction } from '../../../11_Benchmark_Engine/modules/navigation_runner/actions.js';

// ── fake page ─────────────────────────────────────────────────────────────
function makePage({ visible = [], clickable = [], nameButtons = [] } = {}) {
  const visSet = new Set(visible);
  const clickSet = new Set(clickable);
  const clicks = [];

  const el = (b) => ({
    _b: b,
    async innerText() { return b.name ?? ''; },
    async getAttribute(a) { return a === 'aria-label' ? (b.ariaLabel ?? null) : a === 'value' ? (b.value ?? null) : null; },
    async isVisible() { return b.visible !== false; },
    async click() {
      if (b.throws) throw new Error('intercepts pointer events');
      clicks.push(b.name ?? '(button)');
    },
  });

  function locator(sel) {
    const self = {
      first() { return self; },
      async isVisible() { return visSet.has(sel); },
      async click() {
        if (!clickSet.has(sel)) throw new Error(`element for ${sel} intercepts pointer events`);
        clicks.push(sel);
      },
      async all() {
        // the generic control query used by the accessible-name fallback
        if (/button/.test(sel)) return nameButtons.map(el);
        return [];
      },
    };
    return self;
  }

  return {
    _clicks: clicks,
    locator,
    async waitForTimeout() {},
    async waitForLoadState() {},
  };
}

test('1: a OneTrust overlay is dismissed via its known accept selector', async () => {
  const page = makePage({
    visible: ['#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '#onetrust-accept-btn-handler'],
    clickable: ['#onetrust-accept-btn-handler'],
  });
  const r = await dismissConsentOverlay(page);
  assert.equal(r.handled, true);
  assert.equal(r.method, 'known-selector');
  assert.equal(r.detail, '#onetrust-accept-btn-handler');
  assert.ok(page._clicks.includes('#onetrust-accept-btn-handler'));
});

test('1b: a generic GDPR banner is dismissed by an accept-labelled button (no force)', async () => {
  const page = makePage({
    visible: ['[class*="cookie-consent" i]'],
    clickable: [],   // no known selector is clickable
    nameButtons: [
      { name: 'Cookie preferences' },        // must be skipped (reject/manage)
      { name: 'Accept all cookies' },        // <- this one
      { name: 'Decline' },
    ],
  });
  const r = await dismissConsentOverlay(page);
  assert.equal(r.handled, true);
  assert.equal(r.method, 'accessible-name');
  assert.equal(r.detail, 'Accept all cookies');
  assert.ok(page._clicks.includes('Accept all cookies'));
  assert.ok(!page._clicks.includes('Cookie preferences'));
});

test('2: no consent overlay -> handler is a clean no-op and the step still runs', async () => {
  const page = makePage({ visible: [], clickable: [] });
  const r = await dismissConsentOverlay(page);
  assert.equal(r.handled, false);
  assert.equal(r.method, null);
  assert.match(r.detail, /no consent overlay/i);

  // performStepAction (observe) must still succeed and thread the consent result
  const step = { id: 'step_01_entry', title: 'x' };
  const res = await performStepAction(page, step);
  assert.equal(res.success, true);
  assert.equal(res.consent.handled, false);
});

test('3: a banner present but not dismissable is reported cleanly, never throws', async () => {
  const page = makePage({
    visible: ['#onetrust-banner-sdk', '.onetrust-pc-dark-filter'],
    clickable: [],                    // nothing clickable
    nameButtons: [{ name: 'Manage settings' }, { name: 'Reject all' }],  // no accept control
  });
  const r = await dismissConsentOverlay(page);   // must not throw
  assert.equal(r.handled, false);
  assert.equal(r.method, null);
  assert.match(r.detail, /no accept control/i);

  // and the step action still completes (reporting the consent outcome)
  const res = await performStepAction(page, { id: 'step_01_entry', title: 'x' });
  assert.equal(res.success, true);
  assert.equal(res.consent.handled, false);
});

test('handler never throws even if the page surface errors', async () => {
  const brokenPage = {
    locator() { throw new Error('page closed'); },
    async waitForTimeout() {},
    async waitForLoadState() {},
  };
  const r = await dismissConsentOverlay(brokenPage);
  assert.equal(r.handled, false);
});
