/**
 * navigationRunnerStage — Sprint Reset: wraps the existing, unmodified
 * Navigation Runner module (11_Benchmark_Engine/modules/navigation_runner)
 * via NavigationProvider.runJourney(), the same capability call
 * PlaywrightNavigationProvider.js already exposes. No Navigation Runner
 * code is changed here.
 *
 * Executes the previous stage's JourneyPlan step by step in its own,
 * self-contained Playwright session (it opens and closes its own browser —
 * unlike navigationStage.js, there is no live page/browser handle to pass
 * forward). Its own capture.js already writes a full-page screenshot per
 * step to disk and returns each step's screenshot_path — that evidence is
 * consumed directly by featureVisionStage next; no separate capture stage
 * duplicates what Navigation Runner already does.
 */
import { getNavigationProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

export const navigationRunnerStage = new Stage(
  'navigation_runner',
  'Navigation Runner',
  async ({ company, jobId, previousOutput }) => {
    const journeyPlan = previousOutput;
    if (!journeyPlan) {
      throw new Error('Navigation Runner requires a JourneyPlan from the Journey Mapper stage.');
    }
    const companySlug = typeof jobId === 'string' ? jobId.split(':')[1] : undefined;
    const result = await getNavigationProvider().runJourney({ journeyPlan, companyName: company || null, companySlug });
    if (!result.steps || result.steps.length === 0) {
      throw new Error('Navigation Runner produced no steps — the JourneyPlan may have been empty.');
    }
    return result; // { run_id, company_slug, steps[], summary, manifest_path, ... }
  },
);
