/**
 * featureVisionStage — Sprint Reset: selects which of Navigation Runner's
 * already-captured per-step screenshots is most relevant to the requested
 * Feature, then sends it to the existing, unmodified Vision capability
 * (VisionProvider.describe(), the same call visionStage.js already makes
 * for the Full Benchmark pipeline).
 *
 * Combined into one stage — rather than a separate "selection" stage plus
 * reusing visionStage.js as-is — because Runtime's previousOutput only ever
 * carries the immediately preceding stage's output (see screenshotStage.js's
 * own note on this). visionStage.js's return shape does not forward
 * arbitrary extra fields, so featureStepId/featureStepFound/selectedStep
 * would be lost by the time Reasoning ran if this were split in two. This
 * stage still calls the exact same Vision Provider — nothing about the
 * Vision capability itself is reimplemented.
 *
 * Feature -> CLAUDE.md journey step mapping is intentionally a small,
 * explicit keyword table: Journey Mapper's own JourneyStepId enum
 * (contracts/journey_plan.schema.json) already matches CLAUDE.md's 12 step
 * names, so this only has to bridge free-text feature input to that
 * existing vocabulary, not invent a new taxonomy.
 */
import { getVisionProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';

const FEATURE_KEYWORD_MAP = [
  [['entry', 'landing', 'homepage'], 'step_01_entry'],
  [['discover', 'inspiration', 'explore', 'trending'], 'step_02_discovery'],
  [['search', 'filter'], 'step_03_search'],
  [['ai interaction', 'chatbot', 'chat', 'assistant', 'ai planner'], 'step_04_ai_interaction'],
  [['recommendation', 'personalization'], 'step_05_recommendations'],
  [['map'], 'step_06_maps'],
  [['booking', 'book'], 'step_07_booking'],
  [['ancillary', 'ancillaries', 'upsell', 'add-on', 'addon'], 'step_08_ancillaries'],
  [['payment', 'checkout', 'pay', 'bnpl'], 'step_09_payment'],
  [['trip management', 'dashboard', 'itinerary', 'post-booking'], 'step_10_trip_management'],
  [['check-in', 'checkin', 'boarding'], 'step_11_checkin'],
  [['loyalty', 'rewards', 'points'], 'step_12_loyalty'],
];

export function mapFeatureToStepId(feature) {
  const text = String(feature || '').toLowerCase();
  for (const [keywords, stepId] of FEATURE_KEYWORD_MAP) {
    if (keywords.some((k) => text.includes(k))) return stepId;
  }
  return null;
}

function selectStep(steps, featureStepId) {
  if (featureStepId) {
    const exactSuccess = steps.find((s) => s.step_id === featureStepId && s.status === 'success');
    if (exactSuccess) return { step: exactSuccess, featureStepFound: true };
    const exactAny = steps.find((s) => s.step_id === featureStepId);
    if (exactAny) return { step: exactAny, featureStepFound: true };
  }
  const lastSuccess = [...steps].reverse().find((s) => s.status === 'success');
  if (lastSuccess) return { step: lastSuccess, featureStepFound: false };
  return { step: steps[steps.length - 1] || null, featureStepFound: false };
}

export const featureVisionStage = new Stage(
  'feature_vision',
  'Screenshot Selection + Vision Analysis',
  async ({ feature, jobId, previousOutput }) => {
    const steps = previousOutput?.steps || [];
    const featureStepId = mapFeatureToStepId(feature);
    const { step: selected, featureStepFound } = selectStep(steps, featureStepId);

    if (!selected || !selected.screenshot_path) {
      throw new Error(`No usable screenshot was captured for feature "${feature}" (mapped journey step: ${featureStepId || 'none'}).`);
    }

    const companySlug = typeof jobId === 'string' ? jobId.split(':')[1] : undefined;
    const result = await getVisionProvider().describe({
      screenshotPath: selected.screenshot_path,
      companySlug,
      url: selected.page_url,
      title: selected.title,
    });
    if (!result.success) {
      throw new Error(result.error || 'Vision analysis failed');
    }

    return {
      url: selected.page_url || null,
      title: selected.title || null,
      screenshotPath: selected.screenshot_path,
      visionFindings: result.findings,
      visionJsonPath: result.jsonPath,
      featureStepId,
      featureStepFound,
      selectedStep: { step_id: selected.step_id, title: selected.title, status: selected.status },
      timing: result.timing,
    };
  },
);
