/**
 * goal_navigator/calendarPicker — operate a custom date picker generically.
 *
 * Live finding (Qatar Airways): the departure date is an Angular
 * <input role="combobox"> rendered INSIDE an open shadow root, and its
 * calendar renders inside that shadow root too. The previous picker searched
 * only `document` (which cannot see into shadow roots), returned "no grid"
 * immediately, then typed an ISO date into the combobox — never confirmed, so
 * the search form was abandoned. It also looked for "next month" buttons
 * across the WHOLE page, so on other sites it could click unrelated controls
 * (e.g. a hero carousel "next").
 *
 * This picker:
 *  - searches from the date field's own root node (its shadow root) first,
 *    then the document, then every other open shadow root;
 *  - only considers visible day grids (>= 28 numeric day cells);
 *  - matches the target day by accessible label / data-date, or by the
 *    month header that precedes the grid plus the day number;
 *  - advances months ONLY with a "next" control found inside the picker
 *    (an ancestor of the visible grid, never the page body);
 *  - lets the caller confirm the selection from the field's rendered value.
 * No site-specific selectors.
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MAX_MONTH_ADVANCES = 13;

/**
 * In-page function (serialised by Playwright): one step of operating the
 * picker opened from `field`. Returns { state: 'clicked'|'advanced'|'no-grid'|'stuck', via? }.
 */
export function calendarStep(field, { iso, day, month, year, months }) {
  const T = (s) => (s == null ? '' : String(s)).replace(/\s+/g, ' ').trim().toLowerCase();
  const vis = (el) => !!(el && el.getClientRects && el.getClientRects().length);
  const monthName = months[month - 1];
  const abbr = monthName.slice(0, 3);

  const roots = [];
  const seen = new Set();
  const addRoot = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
  addRoot(field && field.getRootNode ? field.getRootNode() : null);
  addRoot(document);
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) addRoot(el.shadowRoot);
  }

  const isDisabled = (c) => c.getAttribute('aria-disabled') === 'true' || c.hasAttribute('disabled')
    || /\b(disabled|unavailable|is-disabled)\b/i.test(typeof c.className === 'string' ? c.className : '');
  const dayCells = (grid) => Array.from(grid.querySelectorAll('[role="gridcell"],td,button,[role="button"]'))
    .filter((c) => /^\d{1,2}$/.test(T(c.innerText || c.textContent)));
  const clickCell = (c) => { (c.querySelector('button,a,[role="button"]') || c).click(); };

  // Visible day grids, innermost only (a wrapper holding two month tables would duplicate them).
  const GRID = '[role="grid"],table,[class*="calendar" i],[class*="datepicker" i],[class*="date-picker" i]';
  const grids = [];
  for (const r of roots) {
    for (const g of r.querySelectorAll(GRID)) {
      if (!grids.includes(g) && vis(g) && dayCells(g).length >= 28) grids.push(g);
    }
  }
  const leaf = grids.filter((g) => !grids.some((o) => o !== g && g.contains(o)));
  if (!leaf.length) return { state: 'no-grid' };

  // 1 — the day carries its full date in an accessible label or data attribute.
  const labels = [`${monthName} ${day}, ${year}`, `${day} ${monthName} ${year}`, `${abbr} ${day}, ${year}`, `${day} ${abbr} ${year}`];
  for (const g of leaf) {
    for (const c of g.querySelectorAll('[aria-label],[data-date],[data-day],[data-value]')) {
      if (!vis(c) || isDisabled(c)) continue;
      const a = T(c.getAttribute('aria-label'));
      const attrs = [c.getAttribute('data-date'), c.getAttribute('data-day'), c.getAttribute('data-value')].map(T);
      if ((a && (labels.some((l) => a.includes(l)) || a.includes(iso))) || attrs.includes(iso)) {
        clickCell(c);
        return { state: 'clicked', via: 'label' };
      }
    }
  }

  // 2 — month header ("November 2026" / "Nov 2026") preceding a grid, then the day number.
  const headerRe = new RegExp(`^(${months.join('|')}|${months.map((m) => m.slice(0, 3)).join('|')})\\.?\\s+(\\d{4})$`);
  const gridOfHeader = (h) => {
    const own = leaf.find((g) => g.contains(h)); // e.g. a <caption> inside its own table
    if (own) return own;
    // otherwise the first visible leaf grid that follows the header in the same tree
    for (const g of leaf) {
      if (g.getRootNode() !== h.getRootNode() || g.contains(h)) continue;
      if (h.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) return g;
    }
    return null;
  };
  const headers = [];
  for (const r of roots) {
    for (const el of r.querySelectorAll('*')) {
      if (!vis(el) || el.children.length > 2) continue;
      const t = T(el.innerText || el.textContent);
      if (t.length <= 20 && headerRe.test(t)) headers.push({ el, t });
    }
  }
  const shown = [];
  for (const { el, t } of headers) {
    const [, mo, yr] = t.match(headerRe);
    const mIdx = months.findIndex((m) => m === mo || m.slice(0, 3) === mo) + 1;
    shown.push({ mIdx, yr: Number(yr), el });
    if (mIdx === month && Number(yr) === year) {
      const g = gridOfHeader(el);
      if (!g) continue;
      const cell = dayCells(g).find((c) => T(c.innerText || c.textContent) === String(day) && !isDisabled(c) && vis(c));
      if (cell) { clickCell(cell); return { state: 'clicked', via: 'header' }; }
    }
  }

  // 3 — target month not on screen: advance with a "next" control INSIDE the picker only.
  const visibleKey = shown.length ? Math.max(...shown.map((s) => s.yr * 12 + s.mIdx)) : null;
  if (visibleKey !== null && visibleKey >= year * 12 + month) return { state: 'stuck' }; // month shown but day not selectable
  const NEXT = '[aria-label*="next" i],[title*="next" i],button[class*="next" i],[role="button"][class*="next" i],a[class*="next" i],[class*="next" i][tabindex]';
  let n = leaf[0];
  for (let i = 0; i < 6 && n && n.parentElement; i++) {
    n = n.parentElement;
    if (n === document.body || n === document.documentElement) break;
    const next = Array.from(n.querySelectorAll(NEXT)).find((b) => vis(b) && !isDisabled(b));
    if (next) { next.click(); return { state: 'advanced' }; }
  }
  return { state: 'stuck' };
}

/** Does a rendered date-field value represent the requested date? Generic, format-tolerant. */
export function dateValueMatches(value, iso) {
  const v = String(value || '').toLowerCase();
  if (!v) return false;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return false;
  if (v.includes(iso)) return true;
  const abbr = MONTHS[m - 1].slice(0, 3);
  const hasDay = new RegExp(`(^|\\D)0?${d}(\\D|$)`).test(v);
  const hasMonth = v.includes(abbr) || new RegExp(`(^|\\D)0?${m}(\\D|$)`).test(v);
  return hasDay && hasMonth;
}

/** Does a rendered value look like an already-selected calendar date (the site's own default)? */
export function looksLikeSelectedDate(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return false;
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(v) && /\b\d{1,2}\b/.test(v);
  const numeric = /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}\b/.test(v);
  return named || numeric;
}

/**
 * Operate the picker opened from `fieldLocator` until the target day is
 * clicked. Returns { clicked: boolean, via?: string, steps: number }.
 */
export async function pickCalendarDate(page, iso, fieldLocator) {
  const [year, month, day] = String(iso).split('-').map(Number);
  if (!year || !month || !day) return { clicked: false, steps: 0 };
  const args = { iso: String(iso), day, month, year, months: MONTHS };
  // Without a field handle, start from <body> (its root node is the document).
  const anchor = fieldLocator || page.locator('body');
  for (let step = 0; step <= MAX_MONTH_ADVANCES; step++) {
    let r;
    try {
      r = await anchor.evaluate(calendarStep, args);
    } catch { return { clicked: false, steps: step }; }
    if (r.state === 'clicked') return { clicked: true, via: r.via, steps: step };
    if (r.state !== 'advanced') return { clicked: false, steps: step, state: r.state };
    await page.waitForTimeout(250);
  }
  return { clicked: false, steps: MAX_MONTH_ADVANCES, state: 'too-many-advances' };
}
