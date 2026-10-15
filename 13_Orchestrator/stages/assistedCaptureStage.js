/**
 * assistedCaptureStage — the Feature Benchmark's "Capture manually" mode.
 *
 * Replaces Discovery + Feature Navigation Plan + Navigation Runner with one
 * step: open a visible browser on the target site, let the analyst navigate
 * to the requested feature themselves, and capture it when they press
 * "Capture this page". Its output has the same shape as the Navigation
 * Runner's ({ run_id, steps[], summary, manifest_path }), so Feature Vision,
 * Reasoning, the Report Writer and the completion gate run unchanged.
 *
 * Integrity is kept, not relaxed:
 *  - the capture must be on the target's own registrable domain;
 *  - a bot-protection / access-restricted page is refused at capture time
 *    (the analyst is told, can solve the challenge, and capture again).
 *
 * Needs a desktop session: it only works when the Dashboard server runs on
 * the analyst's own computer, never on the hosted (Render) server.
 */
import { platform } from 'os';
import { runAssistedCapture } from '../../12_Provider_Layer/capabilities/navigation/AssistedCaptureProvider.js';
import { Stage } from '../runtime/Stage.js';
import { resolveFeatureIntent } from '../featureNavigation/featureIntent.js';
import { registrableDomain, sameRegistrableDomain, targetLogFields } from '../runtime/benchmarkTarget.js';
import { detectBlockedPage } from '../runtime/pageBlockDetector.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export function assistedCaptureAvailability(env = process.env, os = platform()) {
  if (env.ASSISTED_CAPTURE_HEADLESS === '1') return { ok: true };
  if (env.RENDER || env.RENDER_SERVICE_ID) {
    return { ok: false, reason: 'Capture manually opens a browser window on your own computer, so it only works when the dashboard runs locally (npm start), not on the hosted server.' };
  }
  if (os === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return { ok: false, reason: 'Capture manually needs a desktop to open a browser window on, and this server has no display.' };
  }
  return { ok: true };
}

/** The validation run on every "Capture this page" click. Exported for tests. */
export function validateAssistedCapture(target, { url, title, html }) {
  if (!url || !/^https?:/i.test(url)) {
    return { ok: false, message: 'Open a page of the website first, then press Capture.' };
  }
  if (!sameRegistrableDomain(target.url, url)) {
    return {
      ok: false,
      message: `This page is on ${registrableDomain(url) || url}, not ${target.domain}. Capture a page on ${target.company}'s own site.`,
    };
  }
  const verdict = detectBlockedPage({ url, title, html });
  if (verdict.blocked) {
    return {
      ok: false,
      message: `This is a bot-protection / blocked page, not the real site (${verdict.id}). Complete the check or reload, then capture again.`,
    };
  }
  return { ok: true };
}

export const assistedCaptureStage = new Stage(
  'assisted_capture',
  'Analyst-assisted capture',
  async ({ cwd, target }) => {
    return withLogContext({ stage: 'assisted_capture' }, async () => {
      if (!target) throw new Error('assistedCaptureStage requires a benchmark target.');
      const avail = assistedCaptureAvailability();
      if (!avail.ok) throw new Error(`ASSISTED_CAPTURE_UNAVAILABLE: ${avail.reason}`);

      const intent = resolveFeatureIntent(target.feature);
      const stepId = intent.stepId || 'step_feature';
      // 15 min: stays inside the 20-min pipeline lock so a retry can never double-run.
      const timeoutMs = Number(process.env.ASSISTED_CAPTURE_TIMEOUT_MS) || 15 * 60 * 1000;

      logInfo('Assisted capture: opening a browser window for the analyst', { ...targetLogFields(target), stepId, timeoutMs });
      let result;
      try {
        result = await runAssistedCapture({
          startUrl: target.url,
          companyName: target.company,
          companySlug: target.slug,
          feature: target.feature,
          stepId,
          projectRoot: cwd,
          timeoutMs,
          headless: process.env.ASSISTED_CAPTURE_HEADLESS === '1',
          validate: (c) => validateAssistedCapture(target, c),
          onReady: assistedCaptureStage.onReadyHook || undefined,
        });
      } catch (err) {
        logError('Assisted capture did not produce a page', err, targetLogFields(target));
        throw err;
      }
      logInfo('Assisted capture finished', { ...targetLogFields(target), page_url: result.steps[0]?.page_url, runId: result.run_id });
      return result;
    });
  },
);
