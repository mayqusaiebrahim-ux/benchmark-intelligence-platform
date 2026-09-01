/**
 * goal_navigator/playwrightAdapter — the one place goalNavigator.js touches a
 * real Playwright `page`. Reuses the existing Navigation Runner browser
 * session (no new browser infrastructure — spec §13): the caller passes the
 * same continuous `page` object.
 *
 * All element resolution is by accessible name / role / label / placeholder —
 * never nth-child or fixed DOM indexes (spec §3).
 */
import { resolveFieldSemantic } from './formAutofill.js';

const clip = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lc = (s) => clip(s).toLowerCase();

// CSS.escape is a browser global — not defined in Node. Minimal id escaper.
const cssEscape = (s) => String(s).replace(/["\\\]#.:>~+*\s]/g, '\\$&');

async function safeSettle(page) {
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); }
  catch { /* some pages never idle */ }
  try { await page.waitForTimeout(300); } catch { /* ignore */ }
}

/**
 * buildObservation — snapshot the current page into the plain shape the pure
 * detectors/planners consume. Bounded work: capped element counts, viewport
 * text only where practical.
 */
export async function buildObservation(page) {
  const url = (() => { try { return page.url(); } catch { return null; } })();

  const headings = [];
  try {
    const hs = await page.locator('h1, h2, h3, [role="heading"]').all();
    for (const h of hs.slice(0, 40)) {
      const t = lc(await h.innerText().catch(() => ''));
      if (t) headings.push(t);
    }
  } catch { /* ignore */ }

  let bodyText = '';
  try { bodyText = lc(await page.locator('body').innerText().catch(() => '')).slice(0, 8000); }
  catch { /* ignore */ }

  const buttons = [];
  try {
    const els = await page.locator('button, [role="button"], a[href], input[type="submit"], input[type="button"]').all();
    for (const el of els.slice(0, 120)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const name = clip((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('value').catch(() => '')));
      if (name && name.length <= 60) buttons.push(name.toLowerCase());
    }
  } catch { /* ignore */ }

  const fields = [];
  try {
    const els = await page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"], [role="spinbutton"]').all();
    for (const el of els.slice(0, 80)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const [ariaLabel, placeholder, name, id, type, role, tag, autocomplete] = await Promise.all([
        el.getAttribute('aria-label').catch(() => null),
        el.getAttribute('placeholder').catch(() => null),
        el.getAttribute('name').catch(() => null),
        el.getAttribute('id').catch(() => null),
        el.getAttribute('type').catch(() => null),
        el.getAttribute('role').catch(() => null),
        el.evaluate((n) => n.tagName.toLowerCase()).catch(() => null),
        el.getAttribute('autocomplete').catch(() => null),
      ]);
      let label = null;
      if (id) label = await page.locator(`label[for="${cssEscape(id)}"]`).first().innerText().catch(() => null);
      const desc = { label: label && clip(label), ariaLabel: ariaLabel && clip(ariaLabel), placeholder: placeholder && clip(placeholder), name, id, type, role, tag, autocomplete };
      desc.semantic = resolveFieldSemantic(desc);
      fields.push(desc);
    }
  } catch { /* ignore */ }

  const counts = {
    flightCards: await countLoose(page, '[class*="flight" i][class*="card" i], [data-testid*="flight" i], [class*="result" i][class*="card" i], [class*="fare-option" i]'),
    fareCards: await countLoose(page, '[class*="fare" i][class*="card" i], [class*="fare-family" i], [class*="cabin" i][class*="option" i], [data-testid*="fare" i]'),
    seatCells: await countLoose(page, '[class*="seat" i]:not([class*="select" i]), [data-testid*="seat" i], button[aria-label*="seat" i]'),
    priceTags: await countLoose(page, '[class*="price" i], [class*="amount" i], [class*="fare-price" i]'),
  };

  return { url, headings, bodyText, buttons, fields, counts };
}

async function countLoose(page, selector) {
  try { return Math.min(await page.locator(selector).count(), 999); }
  catch { return 0; }
}

/** Locate a clickable by accessible name (case-insensitive contains). */
async function findClickable(page, name) {
  const target = String(name || '').toLowerCase();
  const els = await page.locator('button, [role="button"], a[href], input[type="submit"], input[type="button"]').all();
  for (const el of els) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const n = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('value').catch(() => ''))).toLowerCase().replace(/\s+/g, ' ').trim();
    if (n && (n === target || n.includes(target) || target.includes(n))) return el;
  }
  return null;
}

async function locateField(page, descriptor) {
  const tries = [];
  if (descriptor.id) tries.push(`#${cssEscape(descriptor.id)}`);
  if (descriptor.name) tries.push(`[name="${descriptor.name}"]`);
  if (descriptor.ariaLabel) tries.push(`[aria-label="${descriptor.ariaLabel}"]`);
  if (descriptor.placeholder) tries.push(`[placeholder="${descriptor.placeholder}"]`);
  for (const sel of tries) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

/**
 * playwrightAdapter — the adapter object goalNavigator.runGoalNavigation()
 * consumes. `page` is the shared Navigation Runner page.
 */
export function playwrightAdapter(page) {
  return {
    async observe() {
      return buildObservation(page);
    },

    async fill(descriptor, value) {
      const loc = await locateField(page, descriptor);
      if (!loc) return { ok: false, error: 'field not locatable' };
      try {
        await loc.fill(String(value), { timeout: 4000 });
        return { ok: true };
      } catch (err) {
        // date pickers / masked inputs — try typing
        try { await loc.click({ timeout: 2000 }); await loc.type(String(value), { delay: 20, timeout: 4000 }); return { ok: true }; }
        catch { return { ok: false, error: err.message }; }
      }
    },

    async selectOption(descriptor, value) {
      const loc = await locateField(page, descriptor);
      if (!loc) return { ok: false, error: 'field not locatable' };
      try {
        if ((descriptor.tag || '').toLowerCase() === 'select') {
          await loc.selectOption({ label: String(value) }).catch(async () => loc.selectOption(String(value)));
          return { ok: true };
        }
        // combobox / autocomplete: type then pick the first matching option
        await loc.click({ timeout: 3000 });
        await loc.fill(String(value), { timeout: 3000 }).catch(() => loc.type(String(value), { delay: 25 }));
        await page.waitForTimeout(600);
        const opt = page.locator('[role="option"], [class*="option" i], li[class*="suggest" i]').filter({ hasText: new RegExp(String(value).slice(0, 3), 'i') }).first();
        if (await opt.isVisible().catch(() => false)) { await opt.click({ timeout: 3000 }); return { ok: true }; }
        await loc.press('Enter').catch(() => {});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async click(name) {
      const el = await findClickable(page, name);
      if (!el) return { ok: false, error: `no visible control named "${name}"` };
      const before = (() => { try { return page.url(); } catch { return null; } })();
      try {
        await el.click({ timeout: 5000 });
        await safeSettle(page);
        const after = (() => { try { return page.url(); } catch { return null; } })();
        return { ok: true, navigated: before !== after };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async waitForSettle() {
      await safeSettle(page);
    },

    async validationErrors() {
      const out = [];
      try {
        const els = await page.locator('[aria-invalid="true"], [class*="error" i], [class*="invalid" i], [role="alert"]').all();
        for (const el of els.slice(0, 20)) {
          if (!(await el.isVisible().catch(() => false))) continue;
          const t = clip(await el.innerText().catch(() => ''));
          if (t && t.length < 160) out.push(t);
        }
      } catch { /* ignore */ }
      return out;
    },
  };
}
