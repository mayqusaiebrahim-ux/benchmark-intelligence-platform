/**
 * navigationStage — reaches the company's URL before Reasoning runs. Wraps
 * getNavigationProvider().navigate() and translates a resolved
 * {success:false} into a thrown Error — the only failure signal Runtime
 * understands — same pattern as reasoningStage.js.
 *
 * Only included in the pipeline when a URL is available at all; see
 * pipelines/fullPipeline.js, which decides that. This stage has no "skip"
 * branch of its own — kept a plain Stage like any other.
 *
 * Sprint 20: requests keepOpen so the live page/browser survives into the
 * Screenshot stage instead of being closed here — see
 * PlaywrightNavigationProvider.js and stages/screenshotStage.js, which is
 * now responsible for closing that session.
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

export const navigationStage = new Stage(
  'navigation',
  'Navigation',
  async ({ url }) => {
    const result = await getNavigationProvider().navigate(url, { keepOpen: true });
    if (!result.success) {
      throw new Error(result.error || `Navigation to ${url} failed`);
    }
    return result; // { success, requestedUrl, url, title, timing, error: null, page, browser }
  },
);
