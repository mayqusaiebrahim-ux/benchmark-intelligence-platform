/**
 * AssistedCaptureProvider — "a human drives, the engine analyses".
 *
 * Opens a VISIBLE browser window on the target site with a small floating
 * Benchmarq toolbar. The analyst clicks through the site themselves (search,
 * pick a fare, fill dummy passenger data — whatever the flow needs), and
 * presses "Capture this page" when the requested experience is on screen.
 * The provider then saves a viewport screenshot (what Vision analyses), a
 * full-page screenshot, the HTML snapshot and a run manifest in the same
 * shape and folders the Navigation Runner uses, and closes the window.
 *
 * Why: bot protection (Akamai, Imperva, Cloudflare) blocks automated
 * browsers on exactly the airline sites this product benchmarks. A real
 * person in a real browser window gets through, and every stage after
 * navigation (Vision, Reasoning, Report, the completion gate) runs unchanged.
 *
 * The browser profile is persisted per company under
 * <projectRoot>/.assisted-browser-profile/<slug>, so cookie-consent choices
 * and "I'm human" checks survive between captures.
 *
 * Validation (is this page on the target's domain? is it a block page?) is
 * passed in by the caller as `validate(capture)`, so this provider never
 * imports orchestration logic (imports stay downward-only).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const TOOLBAR_HOST_ID = '__benchmarq_capture_host';

function toolbarInitScript({ hostId, company, feature }) {
  if (window.top !== window) return; // top frame only
  const state = { msg: null, tone: 'info', busy: false };
  window.__bmSetStatus = (msg, tone = 'info', busy = false) => {
    state.msg = msg; state.tone = tone; state.busy = busy; render();
  };
  let host = null; let root = null;

  function render() {
    if (!root) return;
    const status = root.getElementById('st');
    const btn = root.getElementById('cap');
    if (status) {
      status.textContent = state.msg || `Go to the "${feature}" page, scroll so the part you want analysed is in view, then press Capture.`;
      status.dataset.tone = state.tone;
    }
    if (btn) btn.disabled = state.busy;
  }

  function mount() {
    if (host && host.isConnected) return;
    if (!document.documentElement) return;
    host = document.createElement('div');
    host.id = hostId;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar{font:13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;border:1px solid #cbd5e1;border-radius:14px;
             box-shadow:0 10px 30px rgba(15,23,42,.18);padding:12px 14px;width:320px;display:flex;flex-direction:column;gap:8px}
        .top{display:flex;align-items:center;gap:8px;font-weight:700}
        .dot{width:8px;height:8px;border-radius:50%;background:#0f766e}
        .who{font-weight:500;color:#475569}
        #st{color:#334155} #st[data-tone=error]{color:#b91c1c;font-weight:600} #st[data-tone=ok]{color:#047857;font-weight:600}
        .row{display:flex;gap:8px}
        button{font:600 13px/1 inherit;border-radius:9px;padding:9px 12px;cursor:pointer;border:1px solid transparent}
        #cap{flex:1;background:#0f766e;color:#fff} #cap:disabled{opacity:.55;cursor:wait}
        #cancel{background:#fff;color:#475569;border-color:#cbd5e1}
        .min{margin-left:auto;background:none;border:none;color:#94a3b8;padding:0 2px;font-size:16px}
      </style>
      <div class="bar" role="dialog" aria-label="Benchmarq capture">
        <div class="top"><span class="dot"></span>Benchmarq capture <span class="who" id="who"></span>
          <button class="min" id="min" title="Move to the other corner">⇆</button></div>
        <div id="st"></div>
        <div class="row"><button id="cap">Capture this page</button><button id="cancel">Cancel</button></div>
      </div>`;
    root.getElementById('who').textContent = `· ${company}`;
    root.getElementById('cap').onclick = () => window.__bmAssistedCapture && window.__bmAssistedCapture('capture');
    root.getElementById('cancel').onclick = () => window.__bmAssistedCapture && window.__bmAssistedCapture('cancel');
    root.getElementById('min').onclick = () => {
      const left = host.style.left === '16px';
      host.style.left = left ? '' : '16px'; host.style.right = left ? '16px' : '';
    };
    document.documentElement.appendChild(host);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  setInterval(mount, 800); // SPAs re-render <body>; keep the toolbar attached
}

async function launchContext({ profileDir, headless }) {
  const opts = {
    headless,
    viewport: headless ? { width: 1440, height: 900 } : null,
    args: headless ? [] : ['--start-maximized'],
    // Don't advertise automation — a real person is driving this window.
    ignoreDefaultArgs: ['--enable-automation'],
  };
  // Prefer the analyst's installed Google Chrome (far less likely to be
  // challenged than bundled Chromium); fall back to Playwright's Chromium.
  if (!headless && process.env.ASSISTED_CAPTURE_CHANNEL !== 'chromium') {
    try {
      return await chromium.launchPersistentContext(profileDir, { ...opts, channel: process.env.ASSISTED_CAPTURE_CHANNEL || 'chrome' });
    } catch { /* Chrome not installed — use bundled Chromium */ }
  }
  return chromium.launchPersistentContext(profileDir, opts);
}

/**
 * @param {object} a
 * @param {string} a.startUrl
 * @param {string} a.companyName
 * @param {string} a.companySlug
 * @param {string} a.feature
 * @param {string} a.stepId          journey step id the evidence is filed under
 * @param {string} a.projectRoot
 * @param {(c: {url,title,html}) => {ok: boolean, message?: string}} [a.validate]
 * @param {number} [a.timeoutMs]     default 20 min
 * @param {boolean} [a.headless]     tests only
 * @param {(h: {context, page}) => void} [a.onReady] tests only
 */
export async function runAssistedCapture({
  startUrl, companyName, companySlug, feature, stepId, projectRoot,
  validate = () => ({ ok: true }), timeoutMs = 20 * 60 * 1000, headless = false, onReady,
}) {
  const runId = `assisted_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const shotDir = join(projectRoot, '03_Screenshots', companySlug, '_navigation_runs', runId);
  const runDir = join(projectRoot, '02_Benchmark_Repository', '_Navigation_Runs', companySlug, runId);
  const stepDir = join(runDir, `01_${stepId}`);
  const profileDir = join(projectRoot, '.assisted-browser-profile', companySlug);
  mkdirSync(profileDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const context = await launchContext({ profileDir, headless });

  let settle;
  const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  let finished = false;
  let capturing = false;
  const finish = (fn, v) => { if (!finished) { finished = true; fn(v); } };

  const status = (page, msg, tone, busy) =>
    page.evaluate(([m, t, b]) => window.__bmSetStatus && window.__bmSetStatus(m, t, b), [msg, tone, busy]).catch(() => {});

  await context.exposeBinding('__bmAssistedCapture', async ({ page }, action) => {
    if (finished || capturing) return;
    if (action === 'cancel') {
      finish(settle.reject, new Error('ASSISTED_CAPTURE_CANCELLED: the analyst cancelled the capture.'));
      return;
    }
    capturing = true;
    try {
      await status(page, 'Capturing…', 'info', true);
      const url = page.url();
      const title = await page.title().catch(() => '');
      const html = await page.content().catch(() => '');
      const verdict = validate({ url, title, html }) || { ok: true };
      if (!verdict.ok) {
        await status(page, verdict.message || 'This page cannot be captured.', 'error', false);
        return;
      }
      mkdirSync(shotDir, { recursive: true });
      mkdirSync(stepDir, { recursive: true });
      const hide = `#${TOOLBAR_HOST_ID}{display:none !important}`;
      const viewportPath = join(shotDir, `01_${stepId}.png`);
      const fullPagePath = join(shotDir, `01_${stepId}_fullpage.png`);
      await page.screenshot({ path: viewportPath, style: hide });
      let fullPageSaved = true;
      try { await page.screenshot({ path: fullPagePath, fullPage: true, style: hide, timeout: 30000 }); } catch { fullPageSaved = false; }
      const htmlPath = join(stepDir, 'page.html');
      writeFileSync(htmlPath, html, 'utf8');
      const capturedAt = new Date().toISOString();
      const viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight })).catch(() => null);
      await status(page, 'Captured ✓ — analysis has started in the dashboard. This window will close.', 'ok', true);
      finish(settle.resolve, { url, title, viewportPath, fullPagePath: fullPageSaved ? fullPagePath : null, htmlPath, capturedAt, viewport });
    } catch (err) {
      await status(page, `Capture failed: ${err.message}. Try again.`, 'error', false);
    } finally {
      capturing = false;
    }
  });
  await context.addInitScript(toolbarInitScript, { hostId: TOOLBAR_HOST_ID, company: companyName, feature });

  context.on('close', () => finish(settle.reject, new Error('ASSISTED_CAPTURE_CLOSED: the capture window was closed before a page was captured.')));
  const timer = setTimeout(() => finish(settle.reject, new Error(`ASSISTED_CAPTURE_TIMEOUT: no page was captured within ${Math.round(timeoutMs / 60000)} minutes.`)), timeoutMs);

  const page = context.pages()[0] || await context.newPage();
  page.goto(startUrl, { waitUntil: 'commit', timeout: 60000 }).catch(() => { /* the analyst can navigate manually */ });
  if (page.bringToFront) page.bringToFront().catch(() => {});
  if (onReady) onReady({ context, page });

  let capture;
  try {
    capture = await done;
  } finally {
    clearTimeout(timer);
    if (capture) await new Promise((r) => setTimeout(r, headless ? 0 : 2500));
    await context.close().catch(() => {});
  }

  const step = {
    step_id: stepId,
    title: `${feature} (captured by analyst)`,
    step_index: 0,
    status: 'success',
    action_taken: 'A human analyst navigated the live site in a visible browser window and captured this page.',
    error: null,
    recovered: false,
    page_url: capture.url,
    page_title: capture.title,
    screenshot_path: capture.viewportPath,
    full_page_screenshot_path: capture.fullPagePath,
    html_snapshot_path: capture.htmlPath,
    captured_at: capture.capturedAt,
    navigation_mode: 'assisted',
    goal: {
      navigator: 'analyst',
      feature,
      targetStatus: 'target_reached',
      targetReached: true,
      deepestUrl: capture.url,
      interactionsPerformed: ['A human analyst navigated the site manually and captured this page'],
    },
  };
  writeFileSync(join(stepDir, 'metadata.json'), JSON.stringify(step, null, 2));
  const manifest = {
    schema_version: '0.1.0',
    run_id: runId,
    company_slug: companySlug,
    company_name: companyName,
    starting_url: startUrl,
    primary_goal: `Capture evidence for "${feature}" on ${companyName}.`,
    navigation_mode: 'assisted',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    steps: [step],
    summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
  };
  const manifestPath = join(runDir, 'run_manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { ...manifest, manifest_path: manifestPath };
}
