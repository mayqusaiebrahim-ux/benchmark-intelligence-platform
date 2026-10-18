/**
 * Calendar picker — regression for the live Qatar Airways failure: the
 * departure date is an <input role="combobox"> INSIDE an open shadow root
 * whose calendar renders inside that shadow root. The old picker searched only
 * `document`, found no grid, typed an ISO date into the combobox and the
 * search form was abandoned ("depart_date could not be confirmed").
 *
 * Real headless Chromium against a local fixture (page.setContent — no
 * network, no AI). Skipped where no Chromium is installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ENGINE = join(HERE, '..', '..', '..', '11_Benchmark_Engine');
const { pickCalendarDate, dateValueMatches, looksLikeSelectedDate } = await import(pathToFileURL(join(ENGINE, 'modules', 'goal_navigator', 'calendarPicker.js')).href);
const { playwrightAdapter } = await import(pathToFileURL(join(ENGINE, 'modules', 'goal_navigator', 'playwrightAdapter.js')).href);

async function loadChromium() {
  try {
    const { chromium } = await import(pathToFileURL(join(ENGINE, 'node_modules', 'playwright', 'index.mjs')).href);
    return existsSync(chromium.executablePath()) ? chromium : null;
  } catch { return null; }
}
const chromium = await loadChromium();
const SKIP = !chromium && 'no Chromium for this platform';

// A booking widget whose date field + two-month calendar live in a shadow root.
// Day buttons carry only a number (no aria-label) — the hard case.
const FIXTURE = `<!doctype html><html><body>
<div class="hero"><button class="carousel-next" id="decoy">next slide</button></div>
<booking-widget></booking-widget>
<script>
window.__decoyClicks = 0;
document.getElementById('decoy').addEventListener('click', () => { window.__decoyClicks++; });
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
class BookingWidget extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<label>Departure date <input id="bw-depart" role="combobox" aria-label="Departure date" value="18 Oct 2026"></label><div id="picker"></div>';
    this.first = { y: 2026, m: 9 }; // October (0-based)
    const input = root.getElementById('bw-depart');
    input.addEventListener('click', () => this.render(root, input));
  }
  render(root, input) {
    const picker = root.getElementById('picker');
    const month = (off) => { const d = new Date(this.first.y, this.first.m + off, 1); return { y: d.getFullYear(), m: d.getMonth() }; };
    const block = ({ y, m }) => {
      const days = new Date(y, m + 1, 0).getDate();
      let cells = '';
      for (let i = 1; i <= days; i++) cells += '<td><button data-y="' + y + '" data-m="' + m + '" data-d="' + i + '">' + i + '</button></td>';
      return '<div class="month"><div class="month-title">' + MONTHS[m] + ' ' + y + '</div><table role="grid"><tr>' + cells + '</tr></table></div>';
    };
    picker.innerHTML = '<div class="cal-popup"><button class="next" aria-label="Next month">›</button>' + block(month(0)) + block(month(1)) + '</div>';
    picker.querySelector('button.next').addEventListener('click', () => { const n = month(1); this.first = n; this.render(root, input); });
    picker.querySelectorAll('td button').forEach((b) => b.addEventListener('click', () => {
      input.value = b.dataset.d + ' ' + MONTHS[Number(b.dataset.m)].slice(0, 3) + ' ' + b.dataset.y;
      picker.innerHTML = '';
    }));
  }
}
customElements.define('booking-widget', BookingWidget);
</script></body></html>`;

async function withPage(fn) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(FIXTURE);
    return await fn(page);
  } finally { await browser.close(); }
}

test('dateValueMatches / looksLikeSelectedDate: format-tolerant, no false matches', () => {
  assert.equal(dateValueMatches('15 Dec 2026', '2026-12-15'), true);
  assert.equal(dateValueMatches('12/15/2026', '2026-12-15'), true);
  assert.equal(dateValueMatches('2026-12-15', '2026-12-15'), true);
  assert.equal(dateValueMatches('18 Oct 2026', '2026-12-15'), false);
  assert.equal(dateValueMatches('', '2026-12-15'), false);
  assert.equal(looksLikeSelectedDate('18 Oct 2026'), true);
  assert.equal(looksLikeSelectedDate('15/12/2026'), true);
  assert.equal(looksLikeSelectedDate(''), false);
  assert.equal(looksLikeSelectedDate('Select date'), false);
});

test('shadow-DOM combobox calendar: picks the day after advancing a month, never clicks controls outside the picker', { skip: SKIP }, async () => {
  await withPage(async (page) => {
    const field = page.locator('#bw-depart'); // Playwright CSS pierces open shadow roots
    await field.click();
    const r = await pickCalendarDate(page, '2026-12-15', field);
    assert.equal(r.clicked, true, JSON.stringify(r));
    assert.equal(await field.inputValue(), '15 Dec 2026');
    assert.equal(await page.evaluate(() => window.__decoyClicks), 0, 'the page-level "next" decoy must never be clicked');
  });
});

test('shadow-DOM combobox calendar: a visible month is picked without advancing', { skip: SKIP }, async () => {
  await withPage(async (page) => {
    const field = page.locator('#bw-depart');
    await field.click();
    const r = await pickCalendarDate(page, '2026-11-14', field);
    assert.equal(r.clicked, true, JSON.stringify(r));
    assert.equal(r.steps, 0);
    assert.equal(await field.inputValue(), '14 Nov 2026');
  });
});

test('adapter.fill(depart_date) on the shadow-DOM widget: CONFIRMED via the rendered field value', { skip: SKIP }, async () => {
  await withPage(async (page) => {
    const adapter = playwrightAdapter(page);
    const r = await adapter.fill({ semantic: 'depart_date', id: 'bw-depart', label: 'Departure date' }, '2026-12-15', 'date');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.selectionConfirmed, true, JSON.stringify(r));
    assert.match(r.via, /^calendar/);
    assert.equal(await page.locator('#bw-depart').inputValue(), '15 Dec 2026');
  });
});

test('no operable picker but the site already shows a valid date → kept as the site default, never overwritten with ISO text', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<input id="dep" role="combobox" aria-label="Departure date" value="18 Oct 2026">');
    const r = await playwrightAdapter(page).fill({ semantic: 'depart_date', id: 'dep', label: 'Departure date' }, '2026-12-15', 'date');
    assert.equal(r.ok, true);
    assert.equal(r.selectionConfirmed, true);
    assert.equal(r.via, 'site-default');
    assert.equal(await page.locator('#dep').inputValue(), '18 Oct 2026', 'the site value must be left intact');
  } finally { await browser.close(); }
});

test('no picker and no existing date → typed, but NOT confirmed unless the field shows the date', { skip: SKIP }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // A field that reformats/ignores typed input (shows nothing useful afterwards).
    await page.setContent('<input id="dep" aria-label="Departure date" value="" oninput="this.value=\'\'">');
    const r = await playwrightAdapter(page).fill({ semantic: 'depart_date', id: 'dep', label: 'Departure date' }, '2026-12-15', 'date');
    assert.equal(r.selectionConfirmed, false);
  } finally { await browser.close(); }
});
