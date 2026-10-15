/**
 * "Capture manually" provider in a REAL headless browser: toolbar → refused
 * capture → navigate → accepted capture → evidence files on disk.
 * Skipped where Playwright has no Chromium for this platform.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeWorkspace, installMocks, runFeaturePipeline } from './_pipelineHelper.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROVIDER = pathToFileURL(join(HERE, '..', '..', '..', '12_Provider_Layer', 'capabilities', 'navigation', 'AssistedCaptureProvider.js')).href;

// ── Real browser: the toolbar, the refusal message, and the saved evidence.
// Needs a Chromium build for this OS; skipped where none is installed.
async function chromiumAvailable() {
  try {
    const { chromium } = await import(pathToFileURL(join(HERE, '..', '..', '..', '12_Provider_Layer', 'node_modules', 'playwright', 'index.mjs')).href);
    return existsSync(chromium.executablePath());
  } catch { return false; }
}

test('provider (real headless browser): toolbar → refused capture → accepted capture → files on disk', { skip: !(await chromiumAvailable()) && 'no Chromium for this platform' }, async (t) => {
  const { runAssistedCapture } = await import(PROVIDER);
  const { cwd } = makeWorkspace();
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(req.url.startsWith('/passengers')
      ? `<html><head><title>Passenger details</title></head><body><h1>Passenger details</h1>${'<label>First name</label><input>'.repeat(30)}</body></html>`
      : '<html><head><title>Home</title></head><body><a href="/passengers">Continue</a></body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); rmSync(cwd, { recursive: true, force: true }); });

  const result = await runAssistedCapture({
    startUrl: `${base}/`, companyName: 'Test Air', companySlug: 'test_air', feature: 'Passenger Details',
    stepId: 'step_07_booking', projectRoot: cwd, headless: true, timeoutMs: 60000,
    validate: ({ url }) => (url.includes('/passengers') ? { ok: true } : { ok: false, message: 'Not the passenger page yet.' }),
    onReady: async ({ page }) => {
      const host = page.locator('#__benchmarq_capture_host');
      await host.locator('#cap').click({ timeout: 20000 });                  // on the homepage → refused
      await assert.doesNotReject(host.locator('#st', { hasText: 'Not the passenger page yet.' }).waitFor({ timeout: 10000 }));
      await page.click('text=Continue');                                       // the "analyst" navigates
      await page.waitForURL(/passengers/);
      await host.locator('#cap').click({ timeout: 20000 });                  // → accepted
    },
  });

  const step = result.steps[0];
  assert.equal(step.status, 'success');
  assert.match(step.page_url, /\/passengers$/);
  assert.equal(step.goal.navigator, 'analyst');
  assert.ok(existsSync(step.screenshot_path), 'viewport screenshot saved');
  assert.ok(existsSync(step.html_snapshot_path), 'HTML snapshot saved');
  assert.match(readFileSync(step.html_snapshot_path, 'utf8'), /Passenger details/);
  assert.ok(existsSync(result.manifest_path), 'run manifest saved');
});
