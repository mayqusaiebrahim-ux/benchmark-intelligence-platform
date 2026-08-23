/**
 * featureReasoningStage — Sprint Reset: thin wrapper over
 * FeatureReasoningProvider.js, matching reasoningStage.js's own
 * provider-wrapping pattern exactly (translate a resolved {status:'failed'}
 * into a thrown Error — the only failure signal Runtime understands).
 *
 * Deliberately does not use getReasoningProvider() / ClaudeProvider.js —
 * that resolves to the 'full' pipeline's Reasoning Provider, hardcoded to
 * REASONING_OUTPUT_SCHEMA, which is empirically too large for Anthropic's
 * structured-output compiler. FeatureReasoningProvider.js is a separate,
 * much smaller call against FEATURE_REPORT_SCHEMA.
 */
import { runFeatureReasoning } from '../../10_Dashboard/lib/providers/FeatureReasoningProvider.js';
import { Stage } from '../runtime/Stage.js';

export const featureReasoningStage = new Stage(
  'feature_reasoning',
  'Reasoning (Claude)',
  async ({ prompt, company, feature, previousOutput }) => {
    const result = await runFeatureReasoning({ prompt, company, feature, previousOutput });
    if (result.status !== 'completed') {
      throw new Error(result.error || 'Feature Reasoning failed');
    }
    return { ...(previousOutput || {}), reasoningData: result.data };
  },
);
