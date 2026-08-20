/**
 * visionStage — sends the full-page screenshot Screenshot Stage already
 * captured to the configured Vision Provider for structural detection only
 * (page type, UI sections, nav/cards/forms/buttons/banners/search/filters/
 * AI features, confidence). Never re-captures a screenshot. Never asks for
 * recommendations, reports, or comparisons — see OpenAIVisionProvider.js's
 * describe() system prompt.
 *
 * Reuses the SAME jobId.split(':')[1] companySlug-derivation precedent
 * screenshotStage.js already established (jobId = `${requestId}:${slug}`,
 * both requestId and slug are colon-safe).
 *
 * Own returned object accumulates screenshotStage's forwarded {url, title,
 * screenshots} alongside this stage's own findings — see
 * screenshotStage.js's url/title-forwarding addition and
 * reasoningStage.js's consumption of this stage's output as its
 * previousOutput. No Runtime/Pipeline/Stage changes required — Runtime's
 * existing previousOutput threading already supports this.
 */
import { getVisionProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

export const visionStage = new Stage(
  'vision',
  'Vision Analysis',
  async ({ jobId, previousOutput }) => {
    const { screenshots, url, title } = previousOutput || {};
    const screenshotPath = screenshots?.fullPage?.path;
    if (!screenshotPath) {
      throw new Error('Vision stage requires a full-page screenshot from the Screenshot stage.');
    }

    const parts = typeof jobId === 'string' ? jobId.split(':') : [];
    const companySlug = parts[1];
    if (!companySlug) {
      console.warn(`[visionStage] Could not derive companySlug from jobId "${jobId}" — falling back to "unknown".`);
    }

    const result = await getVisionProvider().describe({ screenshotPath, companySlug, url, title });
    if (!result.success) throw new Error(result.error || 'Vision analysis failed');

    return {
      success: true,
      url: url ?? null,
      title: title ?? null,
      screenshots,
      visionFindings: result.findings,
      visionJsonPath: result.jsonPath,
      timing: result.timing,
      error: null,
    };
  },
);
