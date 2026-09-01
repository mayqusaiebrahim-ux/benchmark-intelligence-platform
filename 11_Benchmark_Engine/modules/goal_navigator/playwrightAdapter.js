/**
 * goal_navigator/playwrightAdapter — the one place goalNavigator.js touches a
 * real Playwright `page`. Reuses the existing Navigation Runner browser
 * session (no new browser infrastructure — spec §13): the caller passes the
 * same continuous `page` object.
 *
 * Real airline booking widgets are interactive: the "From"/"To" controls are
 * often buttons that open an autocomplete panel (not plain inputs), dates are
 * custom calendar grids (not <input type=date>), flight results render
 * asynchronously, and Select/Continue live inside dynamically-rendered cards.
 * This adapter is built for those patterns — all resolution is by accessible
 * name / role / label / placeholder, never nth-child or a vendor selector.
 */
import { resolveFieldSemantic } from './formAutofill.js';

const clip = (s, n = 200) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const lc = (s) => clip(s).toLowerCase();
// CSS.escape is a browser global — not defined in Node. Minimal id escaper.
const cssEscape = (s) => String(s).replace(/["\\\]#.:>~+*\s]/g, '\\$&');

const CLICKABLE = 'button, [role="button"], a[href], input[type="submit"], input[type="button"], [role="option"], [role="tab"]';
const FIELDISH = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="combobox"], [role="spinbutton"], [aria-haspopup="listbox"], [aria-autocomplete]';
const TRIP_TRIGGER_SEMANTICS = new Set(['origin', 'destination', 'depart_date', 'return_date', 'passengers', 'cabin']);

/**
 * waitForSettle — network quiet AND the DOM has stopped mutating. Bounded, but
 * generous enough for async flight-result rendering.
 */
async function settle(page, { maxMs = 12000 } = {}) {
  try { await page.waitForLoadState('networkidle', { timeout: Math.min(maxMs, 8000) }); } catch { /* never fully idle */ }
  try {
    await page.waitForFunction(
      () => {
        // eslint-disable-next-line no-undef
        const w = window;
        if (!w.__gnMut) return true;
        return (Date.now() - w.__gnMut) > 600;
      },
      { timeout: Math.min(maxMs, 4000), polling: 200 },
    ).catch(() => {});
  } catch { /* ignore */ }
  try { await page.waitForTimeout(250); } catch { /* ignore */ }
}

// Install a lightweight mutation stamp once per page so `settle` can tell when
// the DOM has quiesced (SPA route changes rarely fire load events).
async function ensureMutationStamp(page) {
  try {
    await page.evaluate(() => {
      // eslint-disable-next-line no-undef
      const w = window;
      if (w.__gnMutObs) return;
      w.__gnMut = Date.now();
      w.__gnMutObs = new MutationObserver(() => { w.__gnMut = Date.now(); });
      // eslint-disable-next-line no-undef
      w.__gnMutObs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  } catch { /* page may be mid-navigation */ }
}

async function countLoose(page, selector) {
  try { return Math.min(await page.locator(selector).count(), 999); }
  catch { return 0; }
}

/**
 * buildObservation — snapshot the current page into the plain shape the pure
 * detectors/planners consume. Bounded element counts.
 */
export async function buildObservation(page) {
  await ensureMutationStamp(page);
  const url = (() => { try { return page.url(); } catch { return null; } })();

  const headings = [];
  try {
    const hs = await page.locator('h1, h2, h3, [role="heading"], [aria-current="step"]').all();
    for (const h of hs.slice(0, 40)) {
      const t = lc(await h.innerText().catch(() => ''));
      if (t) headings.push(t);
    }
  } catch { /* ignore */ }

  let bodyText = '';
  try { bodyText = lc(await page.locator('body').innerText().catch(() => '')).slice(0, 10000); }
  catch { /* ignore */ }

  const buttons = [];
  try {
    const els = await page.locator(CLICKABLE).all();
    for (const el of els.slice(0, 160)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const name = clip((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('value').catch(() => '')));
      if (name && name.length <= 60) buttons.push(name.toLowerCase());
    }
  } catch { /* ignore */ }

  const fields = [];
  const seenFieldKeys = new Set();
  try {
    const els = await page.locator(FIELDISH).all();
    for (const el of els.slice(0, 90)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const desc = await describeField(page, el);
      const key = `${desc.semantic || ''}|${desc.name || ''}|${desc.id || ''}|${desc.placeholder || ''}`;
      if (seenFieldKeys.has(key)) continue;
      seenFieldKeys.add(key);
      fields.push(desc);
    }
  } catch { /* ignore */ }

  // Button-triggered trip controls (airport / date / passenger pickers that
  // are NOT <input>s) — surface them as fields so the planner can target them.
  try {
    const els = await page.locator('button, [role="button"], [role="combobox"]').all();
    for (const el of els.slice(0, 120)) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const name = clip((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')));
      if (!name || name.length > 50) continue;
      const semantic = resolveFieldSemantic({ label: name, ariaLabel: name });
      if (!semantic || !TRIP_TRIGGER_SEMANTICS.has(semantic)) continue;
      const key = `${semantic}|trigger|${name}`;
      if (seenFieldKeys.has(key)) continue;
      seenFieldKeys.add(key);
      fields.push({ label: name, ariaLabel: name, semantic, tag: 'trigger', trigger: true });
    }
  } catch { /* ignore */ }

  const counts = {
    flightCards: await countLoose(page, '[class*="flight" i][class*="card" i], [data-testid*="flight" i], [class*="result" i][class*="card" i], [class*="fare-option" i], [class*="journey" i][class*="option" i], [class*="itinerary" i]'),
    fareCards: await countLoose(page, '[class*="fare" i][class*="card" i], [class*="fare-family" i], [class*="cabin" i][class*="option" i], [data-testid*="fare" i], [class*="brand" i][class*="fare" i]'),
    seatCells: await countLoose(page, '[class*="seat" i]:not([class*="select" i]):not([class*="selector" i]), [data-testid*="seat" i], button[aria-label*="seat" i]'),
    priceTags: await countLoose(page, '[class*="price" i], [class*="amount" i], [class*="fare-price" i], [class*="total" i]'),
  };

  return { url, headings, bodyText, buttons, fields, counts };
}

async function describeField(page, el) {
  const [ariaLabel, placeholder, name, id, type, role, tag, autocomplete, ariaAutocomplete, haspopup] = await Promise.all([
    el.getAttribute('aria-label').catch(() => null),
    el.getAttribute('placeholder').catch(() => null),
    el.getAttribute('name').catch(() => null),
    el.getAttribute('id').catch(() => null),
    el.getAttribute('type').catch(() => null),
    el.getAttribute('role').catch(() => null),
    el.evaluate((n) => n.tagName.toLowerCase()).catch(() => null),
    el.getAttribute('autocomplete').catch(() => null),
    el.getAttribute('aria-autocomplete').catch(() => null),
    el.getAttribute('aria-haspopup').catch(() => null),
  ]);
  let label = null;
  if (id) label = await page.locator(`label[for="${cssEscape(id)}"]`).first().innerText().catch(() => null);
  if (!label) {
    // label wrapping the input, or an adjacent label
    label = await el.evaluate((n) => {
      const wrap = n.closest('label');
      if (wrap) return wrap.textContent;
      const prev = n.previousElementSibling;
      if (prev && prev.tagName === 'LABEL') return prev.textContent;
      return null;
    }).catch(() => null);
  }
  const desc = {
    label: label && clip(label), ariaLabel: ariaLabel && clip(ariaLabel), placeholder: placeholder && clip(placeholder),
    name, id, type, role, tag,
    autocomplete: autocomplete || ariaAutocomplete || null,
    combobox: role === 'combobox' || ariaAutocomplete === 'list' || haspopup === 'listbox' || undefined,
  };
  desc.semantic = resolveFieldSemantic(desc);
  return desc;
}

// ─── element resolution (stale-safe) ─────────────────────────────────────
async function resolveClickable(page, name) {
  const target = String(name || '').toLowerCase();
  // Prefer controls inside a result/fare/passenger card so "Select" picks the
  // right one on a page full of identical buttons.
  const scopes = [
    '[class*="card" i], [class*="result" i], [class*="fare" i], [class*="option" i], [role="listitem"], article',
    'body',
  ];
  for (const scope of scopes) {
    let containers;
    try { containers = await page.locator(scope).all(); } catch { containers = []; }
    for (const c of containers.slice(0, 40)) {
      let els;
      try { els = await c.locator(CLICKABLE).all(); } catch { continue; }
      for (const el of els) {
        if (!(await el.isVisible().catch(() => false))) continue;
        const n = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || (await el.getAttribute('value').catch(() => ''))).toLowerCase().replace(/\s+/g, ' ').trim();
        if (n && (n === target || n.includes(target) || target.includes(n))) return el;
      }
    }
  }
  return null;
}

async function resolveField(page, descriptor) {
  const tries = [];
  if (descriptor.id) tries.push(`#${cssEscape(descriptor.id)}`);
  if (descriptor.name) tries.push(`[name="${descriptor.name}"]`);
  if (descriptor.ariaLabel) tries.push(`[aria-label="${descriptor.ariaLabel}"]`);
  if (descriptor.placeholder) tries.push(`[placeholder="${descriptor.placeholder}"]`);
  for (const sel of tries) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  // trigger buttons: match by accessible name
  if (descriptor.label || descriptor.ariaLabel) {
    const nm = (descriptor.label || descriptor.ariaLabel);
    const loc = page.getByRole('button', { name: new RegExp(nm.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (await loc.isVisible().catch(() => false)) return loc;
    const combo = page.getByRole('combobox', { name: new RegExp(nm.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (await combo.isVisible().catch(() => false)) return combo;
  }
  return null;
}

/** Pick a suggestion from an open autocomplete/listbox by matching `value`. */
async function pickSuggestion(page, value) {
  const needle = String(value).slice(0, 3).toLowerCase();
  const optionSel = '[role="option"], [role="listbox"] li, [class*="suggestion" i], [class*="autocomplete" i] li, [class*="typeahead" i] li, [class*="dropdown" i] [class*="item" i], [id*="listbox" i] li';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const opts = await page.locator(optionSel).all();
      for (const o of opts.slice(0, 30)) {
        if (!(await o.isVisible().catch(() => false))) continue;
        const t = lc(await o.innerText().catch(() => ''));
        if (t && (t.includes(needle) || t.includes(String(value).toLowerCase()))) {
          await o.click({ timeout: 3000 }).catch(() => {});
          return true;
        }
      }
      // no visible match yet — wait for async suggestions
      await page.waitForTimeout(500);
    } catch { /* retry */ }
  }
  return false;
}

/** Click a calendar cell matching an ISO date (YYYY-MM-DD) if a grid is open. */
async function pickCalendarDate(page, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = String(d);
  const gridSel = '[role="grid"], [class*="calendar" i], [class*="datepicker" i], [class*="date-picker" i]';
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const wantLabel = `${monthNames[m - 1]} ${d}, ${y}`;
  for (let nav = 0; nav < 14; nav++) {
    let grid;
    try { grid = page.locator(gridSel).first(); if (!(await grid.isVisible().catch(() => false))) return false; }
    catch { return false; }
    // exact aria-label match first (most reliable)
    const byLabel = grid.locator(`[aria-label*="${wantLabel}" i], [aria-label*="${iso}" i], td[data-date="${iso}"], button[data-date="${iso}"], [data-day="${iso}"]`).first();
    if (await byLabel.isVisible().catch(() => false)) {
      const disabled = await byLabel.getAttribute('aria-disabled').catch(() => null);
      if (disabled !== 'true') { await byLabel.click({ timeout: 3000 }).catch(() => {}); return true; }
    }
    // else: is the visible month header the target month? then click the day cell.
    const header = lc(await grid.locator('[class*="month" i], [class*="header" i], [role="heading"], caption').first().innerText().catch(() => ''));
    if (header.includes(monthNames[m - 1]) && header.includes(String(y))) {
      const cell = grid.locator('[role="gridcell"], td, button').filter({ hasText: new RegExp(`^\\s*${day}\\s*$`) }).first();
      if (await cell.isVisible().catch(() => false)) {
        const dis = await cell.getAttribute('aria-disabled').catch(() => null);
        if (dis !== 'true') { await cell.click({ timeout: 3000 }).catch(() => {}); return true; }
      }
    }
    // advance one month
    const next = page.locator('[aria-label*="next month" i], [aria-label*="next" i][class*="month" i], button[class*="next" i], [class*="calendar" i] [class*="next" i]').first();
    if (!(await next.isVisible().catch(() => false))) return false;
    await next.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  return false;
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

    async fill(descriptor, value, method) {
      const loc = await resolveField(page, descriptor);
      if (!loc) return { ok: false, error: 'field not locatable' };

      if (method === 'date' || descriptor.semantic === 'depart_date' || descriptor.semantic === 'return_date' || descriptor.semantic === 'date_of_birth') {
        try { await loc.click({ timeout: 3000 }); await page.waitForTimeout(300); } catch { /* ignore */ }
        if (await pickCalendarDate(page, String(value))) return { ok: true, via: 'calendar' };
        // fall back to typing an ISO / localized string
        try { await loc.fill(String(value), { timeout: 3000 }); return { ok: true, via: 'type' }; }
        catch { try { await loc.type(String(value), { delay: 20 }); return { ok: true, via: 'type' }; } catch (e) { return { ok: false, error: e.message }; } }
      }

      // autocomplete / combobox text field
      const isCombo = descriptor.combobox || descriptor.autocomplete || descriptor.tag === 'trigger' || method === 'combobox';
      try {
        await loc.click({ timeout: 3000 }).catch(() => {});
        if (isCombo) {
          // some triggers reveal a nested search input
          const nested = page.locator('input[type="text"]:visible, input[type="search"]:visible, [role="combobox"] input:visible').first();
          const typeInto = (await nested.isVisible().catch(() => false)) ? nested : loc;
          await typeInto.fill('').catch(() => {});
          await typeInto.type(String(value), { delay: 40 });
          await page.waitForTimeout(700);
          if (await pickSuggestion(page, value)) return { ok: true, via: 'suggestion' };
          await typeInto.press('Enter').catch(() => {});
          return { ok: true, via: 'enter' };
        }
        await loc.fill(String(value), { timeout: 4000 });
        return { ok: true, via: 'fill' };
      } catch (err) {
        try { await loc.type(String(value), { delay: 25, timeout: 4000 }); return { ok: true, via: 'type' }; }
        catch { return { ok: false, error: err.message }; }
      }
    },

    async selectOption(descriptor, value) {
      const loc = await resolveField(page, descriptor);
      if (!loc) return { ok: false, error: 'field not locatable' };
      try {
        if ((descriptor.tag || '').toLowerCase() === 'select') {
          await loc.selectOption({ label: String(value) }).catch(async () => loc.selectOption(String(value)));
          return { ok: true, via: 'select' };
        }
        await loc.click({ timeout: 3000 });
        await page.waitForTimeout(300);
        const nested = page.locator('input[type="text"]:visible, input[type="search"]:visible, [role="combobox"] input:visible').first();
        const typeInto = (await nested.isVisible().catch(() => false)) ? nested : loc;
        await typeInto.fill(String(value)).catch(() => typeInto.type(String(value), { delay: 30 }));
        await page.waitForTimeout(600);
        if (await pickSuggestion(page, value)) return { ok: true, via: 'suggestion' };
        await typeInto.press('Enter').catch(() => {});
        return { ok: true, via: 'enter' };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async click(name) {
      const before = (() => { try { return page.url(); } catch { return null; } })();
      for (let attempt = 0; attempt < 2; attempt++) {
        const el = await resolveClickable(page, name);
        if (!el) { if (attempt === 0) { await page.waitForTimeout(500); continue; } return { ok: false, error: `no visible control named "${name}"` }; }
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
          await el.click({ timeout: 6000 });
          await settle(page);
          const after = (() => { try { return page.url(); } catch { return null; } })();
          return { ok: true, navigated: before !== after };
        } catch (err) {
          if (/detached|not attached|stale|element is not/i.test(err.message) && attempt === 0) { await page.waitForTimeout(400); continue; }
          return { ok: false, error: err.message };
        }
      }
      return { ok: false, error: `could not click "${name}"` };
    },

    async waitForSettle() {
      await settle(page);
    },

    async validationErrors() {
      const out = [];
      try {
        const els = await page.locator('[aria-invalid="true"], [class*="error" i]:not([class*="no-error" i]), [class*="invalid" i], [role="alert"], .field-error, [class*="validation" i]').all();
        for (const el of els.slice(0, 25)) {
          if (!(await el.isVisible().catch(() => false))) continue;
          const t = clip(await el.innerText().catch(() => ''));
          if (t && t.length > 2 && t.length < 180) out.push(t);
        }
      } catch { /* ignore */ }
      return [...new Set(out)];
    },
  };
}
