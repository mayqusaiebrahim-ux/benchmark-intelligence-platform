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
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export const featureReasoningStage = new Stage(
  'feature_reasoning',
  'Reasoning (Claude)',
  async ({ prompt, company, feature, previousOutput }) => {
    return withLogContext({ stage: 'feature_reasoning' }, async () => {
      logInfo('Feature Reasoning stage starting', { company, feature });
      let result;
      try {
        result = await runFeatureReasoning({ prompt, company, feature, previousOutput });
      } catch (err) {
        // runFeatureReasoning is designed to resolve {status:'failed'} rather
        // than throw — this catch exists only so an unexpected throw still
        // gets logged with its full stack before propagating, unchanged.
        logError('Feature Reasoning threw unexpectedly', err);
        throw err;
      }
      if (result.status !== 'completed') {
        const err = new Error(result.error || 'Feature Reasoning failed');
        logError('Feature Reasoning failed', err);
        throw err;
      }
      logInfo('Feature Reasoning stage finished', { evidenceSource: result.data?.evidence_source, featureFound: result.data?.feature_found });
      return { ...(previousOutput || {}), reasoningData: result.data };
    });
  },
);
