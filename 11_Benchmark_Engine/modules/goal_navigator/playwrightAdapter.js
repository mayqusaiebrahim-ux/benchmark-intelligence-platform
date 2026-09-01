/**
 * goal_navigator/playwrightAdapter — the one place goalNavigator.js touches a
 * real Playwright `page`. Reuses the existing Navigation Runner browser
 * session (no new browser infrastructure — spec §13): the caller passes the
 * same continuous `page` object. The goal navigator NEVER closes the page,
 * context, or browser — the Navigation Runner owns that lifecycle.
 *
 * Performance (production hotfix): DOM extraction is ONE page.evaluate() that
 * walks the document in-browser and returns a plain JSON snapshot, instead of
 * iterating hundreds of ElementHandles with sequential awaits over CDP (that
 * cost ~95s per observation against Browserbase). Everything else stays
 * generic: resolution is by accessible name / role / label / container
 * context, never nth-child or a vendor selector.
 */
import { resolveFieldSemantic } from './formAutofill.js';

const cssEscape = (s) => String(s).replace(/["\\\]#.:>~+*\s]/g, '\\$&');
const rxEscape = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const now = () => Date.now();

// Trip semantics that get de-duplicated to ONE best control per observation.
const TRIP_TRIGGER_SEMANTICS = new Set(['origin', 'destination', 'depart_date', 'return_date', 'passengers', 'cabin']);

// ─── the single in-browser DOM snapshot ─────────────────────────────────────
// Runs entirely in the page. Returns bounded plain data. No Playwright calls.
/* eslint-disable */
function DOM_SNAPSHOT(LIMITS) {
  const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
  const lc = (s) => T(s).toLowerCase();
  const vis = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const accName = (el) => {
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return T(al);
    const lb = el.getAttribute && el.getAttribute('aria-labelledby');
    if (lb) {
      const parts = lb.split(/\s+/).map((id) => { const n = document.getElementById(id); return n ? n.textContent : ''; });
      const j = T(parts.join(' '));
      if (j) return j;
    }
    const it = T(el.innerText || el.textContent);
    if (it) return it;
    const v = el.getAttribute && el.getAttribute('value');
    if (v) return T(v);
    const ti = el.getAttribute && el.getAttribute('title');
    return ti ? T(ti) : '';
  };
  const isVisibleEl = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const contextOf = (el) => {
    let n = el;
    for (let i = 0; i < 14 && n; i++, n = n.parentElement) {
      const tag = n.tagName;
      const role = (n.getAttribute && n.getAttribute('role')) || '';
      const idc = lc((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''));
      // A visible dialog / modal / overlay wins — it is what the user must act on.
      if ((role === 'dialog' || role === 'alertdialog' || (n.getAttribute && n.getAttribute('aria-modal') === 'true')
        || /(^|[^a-z])(modal|dialog|lightbox|overlay-panel|popup-panel)([^a-z]|$)/.test(idc)) && isVisibleEl(n)) {
        return /(login|log-in|signin|sign-in|auth|password|account)/.test(idc) ? 'auth' : 'modal';
      }
      // An actual login / sign-in surface.
      if (/(^|[^a-z])(login|log-in|signin|sign-in|authentication|auth-)([^a-z]|$)|account-menu|account-dropdown|member-login|user-login/.test(idc)) return 'auth';
      if (tag === 'HEADER' || /(^|[^a-z])(site-)?header([^a-z]|$)|masthead|topbar|top-bar/.test(idc)) return 'header';
      if (tag === 'NAV' || /(^|[^a-z])nav([^a-z]|$)|navbar|navigation|megamenu|mega-menu/.test(idc)) return 'nav';
      if (tag === 'FOOTER' || /(^|[^a-z])footer([^a-z]|$)/.test(idc)) return 'footer';
      if (/booking|flight-search|flightsearch|search-widget|searchwidget|search-panel|book-a-flight|bookaflight|fare-finder|farefinder|search-flights|searchflights|trip-search|journey-search|ibe|dib-|widget-booking/.test(idc)) return 'booking';
      if (tag === 'FORM' && /(login|signin|sign-in|log-in|password|auth)/.test(idc || lc((n.getAttribute && (n.getAttribute('name') || n.getAttribute('action'))) || ''))) return 'auth';
      if (tag === 'FORM' && /(search|book|flight|trip|fare)/.test(idc || lc((n.getAttribute && (n.getAttribute('name') || n.getAttribute('action'))) || ''))) return 'booking';
      if (tag === 'FORM') return 'form';
    }
    return 'other';
  };
  const isGlobalSearch = (el) => {
    let n = el;
    for (let i = 0; i < 10 && n; i++, n = n.parentElement) {
      const role = n.getAttribute && n.getAttribute('role');
      const idc = lc((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''));
      if (role === 'search' || /site-search|sitesearch|global-search|globalsearch|search-form|searchform|search-box|searchbox|header-search|nav-search/.test(idc)) return true;
    }
    return false;
  };

  const url = location.href;

  // headings
  const headings = [];
  document.querySelectorAll('h1,h2,h3,[role="heading"],[aria-current="step"]').forEach((h) => {
    if (headings.length >= LIMITS.headings) return;
    if (!vis(h)) return;
    const t = lc(h.innerText || h.textContent);
    if (t) headings.push(t.slice(0, 120));
  });

  const bodyText = lc(document.body ? document.body.innerText : '').slice(0, 10000);

  // clickable controls
  const controls = [];
  const buttonNames = [];
  const CLICK_SEL = 'button,[role="button"],a[href],input[type="submit"],input[type="button"],[role="tab"]';
  const clickEls = Array.from(document.querySelectorAll(CLICK_SEL));
  for (const el of clickEls) {
    if (controls.length >= LIMITS.controls) break;
    if (!vis(el)) continue;
    const name = accName(el);
    if (!name || name.length > 60) continue;
    const ctx = isGlobalSearch(el) ? 'header' : contextOf(el);
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
    controls.push({ name: name.toLowerCase(), context: ctx, disabled });
    buttonNames.push(name.toLowerCase());
  }

  // form fields (+ button-triggered trip pickers)
  const fields = [];
  const FIELD_SEL = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]),select,textarea,[role="combobox"],[role="spinbutton"],[aria-haspopup="listbox"],[aria-autocomplete]';
  const fieldEls = Array.from(document.querySelectorAll(FIELD_SEL));
  const seen = new Set();
  const fieldDesc = (el, forceTrigger) => {
    let label = '';
    if (el.labels && el.labels.length) label = T(el.labels[0].textContent);
    if (!label) {
      const w = el.closest && el.closest('label');
      if (w) label = T(w.textContent);
    }
    if (!label) {
      const p = el.previousElementSibling;
      if (p && p.tagName === 'LABEL') label = T(p.textContent);
    }
    const g = (a) => (el.getAttribute ? el.getAttribute(a) : null);
    return {
      label: label.slice(0, 80) || null,
      ariaLabel: T(g('aria-label')).slice(0, 80) || null,
      placeholder: T(g('placeholder')).slice(0, 80) || null,
      name: g('name') || null,
      id: el.id || null,
      type: g('type') || null,
      role: g('role') || null,
      tag: forceTrigger ? 'trigger' : el.tagName.toLowerCase(),
      autocomplete: g('autocomplete') || g('aria-autocomplete') || null,
      haspopup: g('aria-haspopup') || null,
      context: contextOf(el),
      visible: vis(el),
      disabled: !!(el.disabled || g('aria-disabled') === 'true' || g('readonly') != null),
      hasValue: !!(el.value && String(el.value).trim()),
    };
  };
  for (const el of fieldEls) {
    if (fields.length >= LIMITS.fields) break;
    if (!vis(el)) continue;
    const d = fieldDesc(el, false);
    const k = (d.name || '') + '|' + (d.id || '') + '|' + (d.ariaLabel || d.placeholder || d.label || '');
    if (seen.has(k)) continue;
    seen.add(k);
    fields.push(d);
  }
  // button-triggered trip controls (airport/date/passenger pickers that are not <input>)
  for (const el of clickEls) {
    if (fields.length >= LIMITS.fields) break;
    if (!vis(el)) continue;
    const nm = accName(el);
    if (!nm || nm.length > 50) continue;
    const d = fieldDesc(el, true);
    d.label = nm.slice(0, 80); d.ariaLabel = d.ariaLabel || nm.slice(0, 80);
    const k = 'trig|' + nm.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    fields.push(d);
  }

  const cnt = (sel) => { try { return Math.min(document.querySelectorAll(sel).length, 999); } catch (e) { return 0; } };
  const counts = {
    flightCards: cnt('[class*="flight" i][class*="card" i],[data-testid*="flight" i],[class*="result" i][class*="card" i],[class*="fare-option" i],[class*="journey" i][class*="option" i],[class*="itinerary" i]'),
    fareCards: cnt('[class*="fare" i][class*="card" i],[class*="fare-family" i],[class*="cabin" i][class*="option" i],[data-testid*="fare" i],[class*="brand" i][class*="fare" i]'),
    seatCells: cnt('[class*="seat" i]:not([class*="select" i]):not([class*="selector" i]),[data-testid*="seat" i],button[aria-label*="seat" i]'),
    priceTags: cnt('[class*="price" i],[class*="amount" i],[class*="fare-price" i],[class*="total" i]'),
  };

  return { url, headings, bodyText, controls, buttonNames, fields, counts, elementCount: clickEls.length + fieldEls.length };
}
/* eslint-enable */

// ─── Node-side: resolve semantics + de-duplicate to one control per trip field
export function normalizeObservation(raw) {
  const nameStrength = (d) => {
    // strongest accessible-name signal wins when de-duplicating
    let s = 0;
    if (d.ariaLabel) s += 3;
    if (d.label) s += 3;
    if (d.placeholder) s += 2;
    if (d.name) s += 1;
    if (d.id) s += 1;
    return s;
  };
  // An auth/modal-context control is the one that matters when several DOM
  // nodes share a semantic (a header account password vs. a live sign-in
  // modal password): the planner needs the blocking one.
  const contextScore = (c) => ({ auth: 6, modal: 4, booking: 5, form: 2, other: 0, footer: -3, nav: -4, header: -5 }[c] ?? 0);

  const scored = (raw.fields || []).map((d) => ({
    ...d,
    semantic: d.semantic || resolveFieldSemantic(d),
    _score: (d.visible === false ? -2 : 2) + (d.disabled ? -3 : 0) + contextScore(d.context) + nameStrength(d)
      + (d.tag === 'trigger' ? 0.5 : 0) + (d.combobox || d.role === 'combobox' || d.autocomplete ? 1 : 0)
      + (d.hasValue ? -1 : 0),
  }));

  // One best control PER SEMANTIC (spec: one semantic = one primary target).
  // Semantic-less fields are kept, deduped by a structural key.
  const bestBySemantic = new Map();
  const others = [];
  const otherKeys = new Set();
  for (const d of scored) {
    if (d.semantic) {
      const cur = bestBySemantic.get(d.semantic);
      if (!cur || d._score > cur._score) bestBySemantic.set(d.semantic, d);
    } else {
      const k = `${d.name || ''}|${d.id || ''}|${d.placeholder || d.label || d.ariaLabel || ''}`;
      if (otherKeys.has(k)) continue;
      otherKeys.add(k);
      others.push(d);
    }
  }
  const fields = [...bestBySemantic.values(), ...others].map((d) => { const { _score, ...rest } = d; return rest; });

  return {
    url: raw.url || null,
    headings: raw.headings || [],
    bodyText: raw.bodyText || '',
    buttons: raw.buttonNames || [],       // string names — for the pure detectors/tests
    controls: raw.controls || [],         // {name, context, disabled} — for CTA selection
    fields,
    counts: raw.counts || {},
    elementCount: raw.elementCount || 0,
  };
}

const SNAPSHOT_LIMITS = { headings: 30, controls: 140, fields: 60 };

// Hard cap for a whole logical settle. Individual sub-waits can never stack
// past this — Promise.race against a real wall-clock deadline (production saw
// a single settle phase burn 34s when sub-waits compounded).
const SETTLE_HARD_CAP_MS = 5000;

export async function settle(page, { maxMs = 4000 } = {}) {
  const cap = Math.min(Math.max(500, maxMs), SETTLE_HARD_CAP_MS);
  const deadline = Date.now() + cap;
  const left = () => Math.max(0, deadline - Date.now());
  const work = (async () => {
    // network quiet — capped to whatever budget remains
    await page.waitForLoadState('networkidle', { timeout: Math.min(left(), cap) }).catch(() => {});
    // DOM has stopped mutating for ~350ms — capped to remaining budget
    if (left() > 150) {
      await page.waitForFunction(
        () => { const w = window; return !w.__gnMut || (Date.now() - w.__gnMut) > 350; },
        { timeout: left(), polling: 150 },
      ).catch(() => {});
    }
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, cap))]);
}

async function ensureMutationStamp(page) {
  try {
    await page.evaluate(() => {
      const w = window;
      if (w.__gnMutObs) return;
      w.__gnMut = Date.now();
      w.__gnMutObs = new MutationObserver(() => { w.__gnMut = Date.now(); });
      w.__gnMutObs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  } catch { /* mid-navigation */ }
}

export async function buildObservation(page, { logger } = {}) {
  const t0 = now();
  await ensureMutationStamp(page);
  let raw;
  try {
    raw = await page.evaluate(DOM_SNAPSHOT, SNAPSHOT_LIMITS);
  } catch (err) {
    raw = { url: (() => { try { return page.url(); } catch { return null; } })(), headings: [], bodyText: '', controls: [], buttonNames: [], fields: [], counts: {}, elementCount: 0, _error: err.message };
  }
  const obs = normalizeObservation(raw);
  logger?.info?.('goal_nav_perf', { phase: 'observation', durationMs: now() - t0, elementCount: raw.elementCount || 0 });
  return obs;
}

// ─── clickable resolution — null-safe, container-context aware ───────────────
export const safeLc = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * resolveClickable — find a visible control whose accessible name matches
 * `name`. `preferContext` (e.g. ['booking','form']) and `avoidContext`
 * (e.g. ['header','nav','footer']) bias which one when several match. Never
 * throws on a null label.
 */
export async function resolveClickable(page, name, { preferContext = [], avoidContext = [] } = {}) {
  const target = safeLc(name);
  if (!target) return null;
  // One in-page pass: score every matching visible control by name + container
  // context, tag the winner, then hand back a locator for it.
  try {
    const picked = await page.evaluate(({ target, preferContext, avoidContext }) => {
      const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
      const vis = (el) => {
        if (!el.getClientRects || !el.getClientRects().length) return false;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') return false;
        const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
      };
      const ctxOf = (el) => {
        let n = el;
        for (let i = 0; i < 12 && n; i++, n = n.parentElement) {
          const tag = n.tagName; const idc = T((n.id || '') + ' ' + (typeof n.className === 'string' ? n.className : ''));
          if (tag === 'HEADER' || /header|masthead|topbar/.test(idc)) return 'header';
          if (tag === 'NAV' || /nav|navbar|navigation|megamenu/.test(idc)) return 'nav';
          if (tag === 'FOOTER' || /footer/.test(idc)) return 'footer';
          if (/booking|flight-search|flightsearch|search-widget|book-a-flight|fare-finder|search-flights|ibe/.test(idc)) return 'booking';
          if (n.getAttribute && n.getAttribute('role') === 'search') return 'header';
          if (tag === 'FORM') return 'form';
        }
        return 'other';
      };
      const accName = (el) => {
        const al = el.getAttribute('aria-label'); if (al) return T(al);
        const it = T(el.innerText || el.textContent); if (it) return it;
        const v = el.getAttribute('value'); if (v) return T(v);
        const ti = el.getAttribute('title'); return ti ? T(ti) : '';
      };
      document.querySelectorAll('[data-gn-pick]').forEach((n) => n.removeAttribute('data-gn-pick')); // clear stale marker
      const els = Array.from(document.querySelectorAll('button,[role="button"],a[href],input[type="submit"],input[type="button"],[role="option"],[role="tab"]'));
      let best = null, bestScore = -1e9, bestIdx = -1;
      els.forEach((el, idx) => {
        if (!vis(el)) return;
        const n = accName(el);
        if (!n) return;
        const isMatch = n === target || n.includes(target) || target.includes(n);
        if (!isMatch) return;
        const c = ctxOf(el);
        let score = 0;
        if (n === target) score += 5;
        if (preferContext.includes(c)) score += 8;
        if (avoidContext.includes(c)) score -= 12;
        if (c === 'booking') score += 4;
        if (c === 'header' || c === 'nav' || c === 'footer') score -= 6;
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') score -= 8;
        if (score > bestScore) { bestScore = score; best = el; bestIdx = idx; }
      });
      if (!best) return null;
      best.setAttribute('data-gn-pick', '1');
      return { idx: bestIdx, context: ctxOf(best), name: accName(best), score: bestScore };
    }, { target, preferContext, avoidContext });
    if (!picked) return null;
    const loc = page.locator('[data-gn-pick="1"]').first();
    if (await loc.count().catch(() => 0)) return { loc, meta: picked };
    return null;
  } catch {
    return null;
  }
  // NOTE: the [data-gn-pick] marker is intentionally left on the element — the
  // caller clicks via the returned locator, and the NEXT resolveClickable call
  // clears stale markers before scoring. Cleaning it here (finally) would strip
  // it before the caller could use the locator.
}

async function resolveField(page, descriptor) {
  const tries = [];
  if (descriptor.id) tries.push(`#${cssEscape(descriptor.id)}`);
  if (descriptor.name) tries.push(`[name="${cssEscape(descriptor.name)}"]`);
  if (descriptor.ariaLabel) tries.push(`[aria-label="${descriptor.ariaLabel.replace(/"/g, '\\"')}"]`);
  if (descriptor.placeholder) tries.push(`[placeholder="${descriptor.placeholder.replace(/"/g, '\\"')}"]`);
  for (const sel of tries) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc;
    } catch { /* bad selector — skip */ }
  }
  const nm = descriptor.label || descriptor.ariaLabel;
  if (nm) {
    const re = new RegExp(rxEscape(nm.slice(0, 24)), 'i');
    for (const role of ['button', 'combobox', 'textbox']) {
      try {
        const loc = page.getByRole(role, { name: re }).first();
        if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc;
      } catch { /* ignore */ }
    }
  }
  return null;
}

async function pickSuggestion(page, value) {
  const needle = String(value).slice(0, 3).toLowerCase();
  const optionSel = '[role="option"],[role="listbox"] li,[class*="suggestion" i],[class*="autocomplete" i] li,[class*="typeahead" i] li,[id*="listbox" i] li';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const clicked = await page.evaluate(({ optionSel, needle, value }) => {
        const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
        const opts = Array.from(document.querySelectorAll(optionSel)).slice(0, 40);
        for (const o of opts) {
          const r = o.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const t = T(o.innerText || o.textContent);
          if (t && (t.includes(needle) || t.includes(String(value).toLowerCase()))) { o.click(); return true; }
        }
        return false;
      }, { optionSel, needle, value });
      if (clicked) return true;
      await page.waitForTimeout(450);
    } catch { /* retry */ }
  }
  return false;
}

async function pickCalendarDate(page, iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const wantLabel = `${monthNames[m - 1]} ${d}, ${y}`;
  for (let nav = 0; nav < 14; nav++) {
    const done = await page.evaluate(({ iso, wantLabel, day, monthName, year }) => {
      const grid = document.querySelector('[role="grid"],[class*="calendar" i],[class*="datepicker" i],[class*="date-picker" i]');
      if (!grid || !grid.getClientRects().length) return 'no-grid';
      const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
      const byLabel = grid.querySelector(`[aria-label*="${wantLabel}" i],[aria-label*="${iso}" i],td[data-date="${iso}"],button[data-date="${iso}"],[data-day="${iso}"]`);
      if (byLabel && byLabel.getAttribute('aria-disabled') !== 'true') { byLabel.click(); return 'clicked'; }
      const header = T((grid.querySelector('[class*="month" i],[class*="header" i],[role="heading"],caption') || {}).textContent);
      if (header.includes(monthName) && header.includes(String(year))) {
        const cells = Array.from(grid.querySelectorAll('[role="gridcell"],td,button'));
        for (const c of cells) {
          if (T(c.textContent) === String(day) && c.getAttribute('aria-disabled') !== 'true') { c.click(); return 'clicked'; }
        }
      }
      const next = document.querySelector('[aria-label*="next month" i],[aria-label*="next" i][class*="month" i],button[class*="next" i]');
      if (next) { next.click(); return 'advanced'; }
      return 'stuck';
    }, { iso, wantLabel, day: d, monthName: monthNames[m - 1], year: y });
    if (done === 'clicked') return true;
    if (done === 'no-grid' || done === 'stuck') return false;
    await page.waitForTimeout(250);
  }
  return false;
}

/** Did the trip field actually accept a selection? Generic confirmation. */
async function confirmTripSelection(page, descriptor, value) {
  try {
    return await page.evaluate(({ id, name, val }) => {
      const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
      const target = T(val);
      let el = null;
      if (id) el = document.getElementById(id);
      if (!el && name) el = document.querySelector(`[name="${name}"]`);
      // a) the (or a nearby) input now displays the value / an airport code
      const near = el ? el.closest('[class*="field" i],[class*="input" i],[class*="control" i],fieldset,form') || el.parentElement : document.body;
      const displayed = T((near && near.innerText) || '');
      if (target && displayed.includes(target.slice(0, 3))) return true;
      // b) a hidden input holding an IATA code changed
      const hidden = near && near.querySelector('input[type="hidden"]');
      if (hidden && /^[A-Z]{3}$/.test(String(hidden.value || '').trim().toUpperCase())) return true;
      // c) no suggestion list is still open (collapsed combobox)
      const open = document.querySelector('[role="listbox"]:not([hidden]),[class*="suggestion" i]:not([hidden])');
      if (el && !open && T(el.value).length >= 3) return true;
      return false;
    }, { id: descriptor.id || null, name: descriptor.name || null, val: String(value) });
  } catch { return false; }
}

/**
 * playwrightAdapter — the object goalNavigator.runGoalNavigation() consumes.
 * `page` is the shared Navigation Runner page. `logger` receives goal_nav_perf
 * / goal_nav_field_result events (optional).
 */
export function playwrightAdapter(page, { logger } = {}) {
  const log = (event, fields) => { try { logger?.info?.(event, fields); } catch { /* logging must not break nav */ } };

  return {
    async observe() {
      return buildObservation(page, { logger });
    },

    async fill(descriptor, value, method, opts = {}) {
      const t0 = now();
      const attempt = opts.attempt || 1;
      const semantic = descriptor.semantic || null;
      // A REQUIRED airport must be genuinely selected — "text is in the box" is
      // not enough (production: destination success=true, selectionConfirmed=false).
      const requiredSelection = semantic === 'origin' || semantic === 'destination';
      const controlType = descriptor.tag === 'trigger' ? 'trigger'
        : (descriptor.combobox || descriptor.role === 'combobox' || descriptor.autocomplete ? 'combobox' : 'input');
      const done = (rawOk, selectionConfirmed, extra = {}) => {
        // For required-selection fields, ok tracks confirmation.
        const ok = requiredSelection ? (!!rawOk && !!selectionConfirmed) : !!rawOk;
        log('goal_nav_field_result', { semantic, success: ok, selectionConfirmed: !!selectionConfirmed, controlType, attempt, durationMs: now() - t0 });
        log('goal_nav_perf', { phase: 'fill', durationMs: now() - t0, elementCount: 1 });
        return { ok, selectionConfirmed: !!selectionConfirmed, ...extra };
      };

      const loc = await resolveField(page, descriptor);
      if (!loc) return done(false, false, { error: 'field not locatable' });

      // dates → calendar first
      if (method === 'date' || semantic === 'depart_date' || semantic === 'return_date' || semantic === 'date_of_birth') {
        try { await loc.click({ timeout: 2000 }); await page.waitForTimeout(200); } catch { /* ignore */ }
        if (await pickCalendarDate(page, String(value))) return done(true, true, { via: 'calendar' });
        try { await loc.fill(String(value), { timeout: 2000 }); return done(true, false, { via: 'type' }); }
        catch { return done(false, false, { error: 'date not settable' }); }
      }

      const isCombo = controlType !== 'input' || method === 'combobox';
      try {
        await loc.click({ timeout: 2000 }).catch(() => {});
        if (isCombo) {
          const nested = page.locator('input[type="text"]:visible, input[type="search"]:visible, [role="combobox"] input:visible').first();
          const typeInto = (await nested.isVisible({ timeout: 500 }).catch(() => false)) ? nested : loc;
          await typeInto.fill('').catch(() => {});
          await typeInto.type(String(value), { delay: 25 });
          await page.waitForTimeout(attempt >= 2 ? 800 : 450);

          let picked = await pickSuggestion(page, value);
          // Alternate strategy on retry: keyboard-select the first option.
          if (!picked && attempt >= 2) {
            await typeInto.press('ArrowDown').catch(() => {});
            await page.waitForTimeout(150);
            await typeInto.press('Enter').catch(() => {});
            await page.waitForTimeout(250);
            picked = await pickSuggestion(page, value); // may now be closed → false
          }
          if (!picked) await typeInto.press('Enter').catch(() => {});
          const confirmed = picked || await confirmTripSelection(page, descriptor, value);
          return done(true, confirmed, { via: picked ? 'suggestion' : 'keyboard' });
        }
        await loc.fill(String(value), { timeout: 2500 });
        return done(true, true, { via: 'fill' });
      } catch (err) {
        try { await loc.type(String(value), { delay: 20, timeout: 2500 }); return done(true, false, { via: 'type' }); }
        catch { return done(false, false, { error: err.message }); }
      }
    },

    async selectOption(descriptor, value, opts = {}) {
      // combobox trip fields route through fill()'s suggestion logic
      return this.fill(descriptor, value, 'combobox', opts);
    },

    async click(name, opts = {}) {
      const t0 = now();
      const before = (() => { try { return page.url(); } catch { return null; } })();
      const preferContext = opts.preferContext || [];
      const avoidContext = opts.avoidContext || [];
      let result = { ok: false, error: `no visible control named "${name}"` };
      for (let attempt = 0; attempt < 2; attempt++) {
        const found = await resolveClickable(page, name, { preferContext, avoidContext });
        if (!found) { if (attempt === 0) { await page.waitForTimeout(400); continue; } break; }
        try {
          await found.loc.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await found.loc.click({ timeout: 5000 });
          await settle(page);
          const after = (() => { try { return page.url(); } catch { return null; } })();
          result = { ok: true, navigated: before !== after, pickedContext: found.meta?.context || null };
          break;
        } catch (err) {
          if (/detached|not attached|stale|element is not/i.test(err.message || '') && attempt === 0) { await page.waitForTimeout(350); continue; }
          result = { ok: false, error: err.message };
          break;
        }
      }
      log('goal_nav_perf', { phase: 'click', durationMs: now() - t0, elementCount: 1 });
      return result;
    },

    async waitForSettle() {
      const t0 = now();
      await settle(page);
      log('goal_nav_perf', { phase: 'settle', durationMs: now() - t0, elementCount: 0 });
    },

    async validationErrors() {
      try {
        return await page.evaluate(() => {
          const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim();
          const out = new Set();
          const els = Array.from(document.querySelectorAll('[aria-invalid="true"],[class*="error" i],[class*="invalid" i],[role="alert"],[class*="validation" i]')).slice(0, 30);
          for (const el of els) {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            const t = T(el.innerText || el.textContent);
            if (t.length > 2 && t.length < 180) out.add(t);
          }
          return Array.from(out);
        });
      } catch { return []; }
    },
  };
}
