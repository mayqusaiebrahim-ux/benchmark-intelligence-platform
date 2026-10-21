/**
 * Screenshot capture is real and truthful. Live finding
 * (req_1792589857523_449d1afe, Saudia Homepage): page.screenshot() timed out
 * after 30s waiting for web fonts, no screenshot was saved, and the step was
 * still recorded status "success" ("no shot"). Real headless Chromium against
 * a local server whose font request never answers. Skipped without Chromium.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const ENGINE = join(ROOT, '11_Benchmark_Engine');
const { takeViewportScreenshot } = await import(pathToFileURL(join(ENGINE, 'modules', 'navigation_runner', 'capture.js')).href);
const { executeStep } = await import(pathToFileURL(join(ENGINE, 'modules', 'navigation_runner', 'runner.js')).href);

async function loadChromium() {
  try {
    const { chromium } = await import(pathToFileURL(join(ENGINE, 'node_modules', 'playwright', 'index.mjs')).href);
    return existsSync(chromium.executablePath()) ? chromium : null;
  } catch { return null; }
}
const chromium = await loadChromium();
const SKIP = !chromium && 'no Chromium for this platform';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isPng = (p) => existsSync(p) && readFileSync(p).subarray(0, 8).equals(PNG_SIGNATURE) && readFileSync(p).length > 500;

// /hang-font: the font request is accepted and never answered, so
// document.fonts.ready never resolves — exactly what made page.screenshot() hang.
const PAGE = (font) => `<!doctype html><html><head><style>
  ${font ? "@font-face{font-family:Hang;src:url('/hang-font.woff2') format('woff2');font-display:swap}" : ''}
  body{font-family:${font ? 'Hang,' : ''}sans-serif;margin:40px}</style></head>
  <body><h1>Welcome to Example Air</h1><p>Book flights to more than 100 destinations with our award-winning service.</p></body></html>`;
let server, base;
if (chromium) {
  server = createServer((req, res) => {
    if (req.url.startsWith('/hang-font')) return; // never respond
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE(req.url.startsWith('/fonts')));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = chromium ? await chromium.launch() : null;
const SLUG = '_test_capture_reliability';
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  server?.close();
  rmSync(join(ROOT, '03_Screenshots', SLUG), { recursive: true, force: true });
  rmSync(join(ROOT, '02_Benchmark_Repository', '_Navigation_Runs', SLUG), { recursive: true, force: true });
});

const STEP = { id: 'step_01_entry', title: 'Entry' };
const plan = (url) => ({ starting_url: url, recommended_journey: [STEP] });

test('font loading that never settles: page.screenshot times out, a real viewport screenshot is still captured', { skip: SKIP }, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/fonts`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => document.fonts.status), 'loading', 'precondition: a font is still loading');
  const shot = join(ROOT, '03_Screenshots', SLUG, 'font_hang.png');
  (await import('node:fs')).mkdirSync(join(ROOT, '03_Screenshots', SLUG), { recursive: true });
  const t0 = Date.now();
  const r = await takeViewportScreenshot(page, shot, { timeoutMs: 1500 });
  assert.equal(r.method, 'cdp', 'fell back past the font wait');
  assert.match(r.fallbackReason, /timeout/i);
  assert.ok(Date.now() - t0 < 10000, 'bounded, not 30s');
  assert.ok(isPng(shot), 'a real PNG was written');
  await page.close();
});

test('a normal page: real screenshot via page.screenshot, step success with a screenshot path', { skip: SKIP }, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/plain`, { waitUntil: 'domcontentloaded' });
  const r = await executeStep({ page, step: STEP, index: 0, journeyPlan: plan(`${base}/plain`), companySlug: SLUG, runId: 'run_ok', previousStepFailed: false });
  assert.equal(r.status, 'success');
  assert.equal(r.capture_failed, false);
  assert.ok(r.screenshot_path && isPng(r.screenshot_path), 'a real screenshot was saved');
  await page.close();
});

test('a capture that fails: the step is reported failed with the capture error — never "success" with no shot', { skip: SKIP }, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/plain`, { waitUntil: 'domcontentloaded' });
  page.screenshot = async () => { throw new Error('Target page, context or browser has been closed'); };
  const r = await executeStep({ page, step: STEP, index: 0, journeyPlan: plan(`${base}/plain`), companySlug: SLUG, runId: 'run_fail', previousStepFailed: false });
  assert.equal(r.status, 'failed');
  assert.equal(r.capture_failed, true);
  assert.equal(r.screenshot_path, null);
  assert.match(r.error, /Screenshot capture failed: Target page/);
  const meta = JSON.parse(readFileSync(r.metadata_path, 'utf8'));
  assert.equal(meta.status, 'failed', 'step metadata agrees');
  await page.close();
});

test('block detection: the Imperva challenge iframe is a block even without its fallback text', async () => {
  const { detectBlockedPage } = await import('../../runtime/pageBlockDetector.js');
  // Saudia's page as served to headless Chromium, with the iframe's fallback text removed.
  const html = '<html style="height:100%"><head><meta name="ROBOTS" content="NOINDEX, NOFOLLOW"><script type="text/javascript" src="/_Incapsula_Resource?SWJIYLWA=719d34d31c8e3a6e6fffd425f7e032f3"></script></head>' +
    '<body style="margin:0px;height:100%"><iframe id="main-iframe" src="/_Incapsula_Resource?SWUDNSAI=31&amp;xinfo=44-1&amp;incident_id=526000480220619170-73222535231966252&amp;edet=12" frameborder="0" width="100%" height="100%"></iframe></body></html>';
  const v = detectBlockedPage({ url: 'https://www.saudia.com/', html });
  assert.equal(v.blocked, true);
  assert.equal(v.id, 'imperva_challenge');
  // A normal Imperva-fronted page that merely loads an _Incapsula_Resource script is not a block.
  const normal = `<html><head><script src="/_Incapsula_Resource?SWJIYLWA=719d"></script></head><body><h1>Saudia</h1>${'<p>Book flights, manage bookings, check in online. </p>'.repeat(40)}</body></html>`;
  assert.equal(detectBlockedPage({ url: 'https://www.saudia.com/', html: normal }).blocked, false);
});

test('a block page whose screenshot failed is still reported as a block, not a generic failure', async () => {
  const { markBlockedSteps } = await import('../../stages/navigationRunnerStage.js');
  const dir = join(ROOT, '03_Screenshots', SLUG);
  (await import('node:fs')).mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, 'blocked.html');
  (await import('node:fs')).writeFileSync(htmlPath, '<html><body><iframe id="main-iframe" src="/_Incapsula_Resource?SWUDNSAI=31&amp;incident_id=1-2"></iframe></body></html>');
  const steps = [{ step_id: 'step_01_entry', status: 'failed', capture_failed: true, page_url: 'https://www.saudia.com/', screenshot_path: null, html_snapshot_path: htmlPath }];
  assert.equal(markBlockedSteps(steps).length, 1);
  assert.equal(steps[0].status, 'blocked');
  // An ordinary failed step (the action itself failed) is left alone, as before.
  const plain = [{ step_id: 'step_03_search', status: 'failed', page_url: 'https://www.saudia.com/', html_snapshot_path: htmlPath }];
  assert.equal(markBlockedSteps(plain).length, 0);
});
