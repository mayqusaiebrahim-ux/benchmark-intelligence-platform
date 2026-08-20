/**
 * screenshotStage — reuses the live page/browser Navigation Stage produced
 * (threaded in via Runtime's existing previousOutput mechanism — no Runtime
 * changes). Never launches a browser, never navigates. Translates
 * PlaywrightScreenshotProvider's resolved {success:false, error} shape into
 * a thrown Error, matching navigationStage.js's exact pattern, which is
 * the only way Runtime understands a stage as failed.
 *
 * Deliberately does NOT return page/browser in its own output — nothing
 * downstream needs them, and keeping them out avoids a closed session
 * handle sitting in lastOutput/report data after this stage completes.
 *
 * Sprint 21: forwards url/title from Navigation's own previousOutput into
 * THIS stage's own returned object. Screenshot's own capture behavior is
 * completely unchanged — this only affects what gets reported upward.
 * Necessary because Runtime's previousOutput only ever carries the
 * immediately preceding stage's output (see runtime/Runtime.js); without
 * this, visionStage/reasoningStage would have no way to see Navigation's
 * url/title once Screenshot's output becomes their previousOutput.
 */
import { getScreenshotProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

export const screenshotStage = new Stage(
  'screenshot',
  'Screenshot Capture',
  async ({ jobId, previousOutput }) => {
    const { page, browser, url, title } = previousOutput || {};
    if (!page || !browser) {
      throw new Error('Screenshot stage requires an active page/browser from the Navigation stage.');
    }

    const parts = typeof jobId === 'string' ? jobId.split(':') : [];
    const companySlug = parts[1];
    if (!companySlug) {
      console.warn(`[screenshotStage] Could not derive companySlug from jobId "${jobId}" — falling back to "unknown".`);
    }

    const result = await getScreenshotProvider().capture({ page, browser, companySlug });
    if (!result.success) throw new Error(result.error || 'Screenshot capture failed');

    return {
      success: true,
      url: url ?? null,
      title: title ?? null,
      screenshots: result.screenshots, // { fullPage: {path,width,height}, viewport: {path,width,height} }
      timing: result.timing,
      error: null,
    };
  },
);
