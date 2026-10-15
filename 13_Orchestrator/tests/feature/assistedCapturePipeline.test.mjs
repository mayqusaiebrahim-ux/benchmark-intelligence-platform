/**
 * "Capture manually" (captureMode: 'assisted') end to end with mocked
 * providers: no automated navigation, the analyst capture is analysed, and
 * the unchanged completion gate passes. Own process.
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

test('pipeline (assisted): skips automated navigation, analyses the analyst capture, passes the gate', async (t) => {
  const { cwd, shot } = makeWorkspace();
  const { rec, restore } = installMocks({ shot });
  const calls = [];
  const m = mock.module(PROVIDER, {
    namedExports: {
      async runAssistedCapture(args) {
        calls.push(args);
        // the stage hands the provider a validator — it must refuse an off-domain page
        assert.equal(args.validate({ url: 'https://www.emirates.com/', title: '', html: '' }).ok, false);
        return {
          run_id: 'assisted_test', company_slug: args.companySlug, manifest_path: null,
          summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
          steps: [{
            step_id: args.stepId, status: 'success', page_url: 'https://booking.qatarairways.com/passengers',
            screenshot_path: shot, html_snapshot_path: null,
            goal: { navigator: 'analyst', targetStatus: 'target_reached', targetReached: true, interactionsPerformed: ['A human analyst navigated the site manually and captured this page'] },
          }],
        };
      },
    },
  });
  const prev = process.env.ASSISTED_CAPTURE_HEADLESS;
  process.env.ASSISTED_CAPTURE_HEADLESS = '1';
  t.after(() => { m.restore(); restore(); process.env.ASSISTED_CAPTURE_HEADLESS = prev; rmSync(cwd, { recursive: true, force: true }); });

  const { out, events } = await runFeaturePipeline({ cwd, requestId: 'req_assisted', overrides: { feature: 'Passenger Details', captureMode: 'assisted' } });

  assert.equal(rec.discover.length, 0, 'no automated Discovery');
  assert.equal(rec.runJourney.length, 0, 'no automated navigation');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startUrl, 'https://www.qatarairways.com/');
  assert.equal(calls[0].feature, 'Passenger Details');
  assert.deepEqual(events.filter((e) => e.status === 'running').map((e) => e.stage),
    ['assisted_capture', 'feature_vision', 'feature_reasoning', 'feature_report_writer']);
  assert.equal(rec.describe[0].screenshotPath, shot);
  assert.equal(out.evidence.relevance, 'direct');
  assert.equal(out.evidence.capturedBy, 'analyst');
  assert.equal(rec.reasoning[0].previousOutput.capturedBy, 'analyst');
  assert.equal(out.verification_status, 'passed', out.verification_summary);
});

