/**
 * featureReasoningStage — thin wrapper over FeatureReasoningProvider.js.
 *
 * Correctness additions (model-context isolation):
 *  - passes ONLY the current target (company/feature) and the current
 *    evidence (previousOutput from Feature Vision) into the model call —
 *    no fixtures, no prior-request state, no shared mutable context;
 *  - FAILS the run if the model's self-reported `analyzed_company` does not
 *    correspond to the target company (a wrong-company report is never
 *    written).
 */
import { runFeatureReasoning } from '../../10_Dashboard/lib/providers/FeatureReasoningProvider.js';
import { Stage } from '../runtime/Stage.js';
import { nameRefersToTarget, targetLogFields } from '../runtime/benchmarkTarget.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

export const featureReasoningStage = new Stage(
  'feature_reasoning',
  'Reasoning (Claude)',
  async ({ prompt, target, previousOutput }) => {
    return withLogContext({ stage: 'feature_reasoning' }, async () => {
      if (!target) throw new Error('featureReasoningStage requires a benchmark target.');
      logInfo('Feature Reasoning stage starting', targetLogFields(target));

      let result;
      try {
        result = await runFeatureReasoning({
          prompt,
          company: target.company,
          feature: target.feature,
          target: targetLogFields(target),
          previousOutput,
        });
      } catch (err) {
        logError('Feature Reasoning threw unexpectedly', err);
        throw err;
      }
      if (result.status !== 'completed') {
        const err = new Error(result.error || 'Feature Reasoning failed');
        logError('Feature Reasoning failed', err);
        throw err;
      }

      // Model-context isolation: the report must be about the target company.
      const claim = `${result.data?.analyzed_company || ''}\n${result.data?.summary_markdown || ''}`;
      const refCheck = nameRefersToTarget(target, claim);
      if (!refCheck.ok) {
        const err = new Error(
          `Reasoning output does not correspond to the benchmark target "${target.company}" — ${refCheck.reason}. ` +
          `Refusing to write a report for a different product.`,
        );
        logError('Feature Reasoning company mismatch', err, {
          ...targetLogFields(target),
          analyzed_company: result.data?.analyzed_company,
        });
        throw err;
      }

      logInfo('Feature Reasoning stage finished', {
        ...targetLogFields(target),
        evidenceSource: result.data?.evidence_source,
        featureFound: result.data?.feature_found,
        analyzedCompany: result.data?.analyzed_company,
      });
      return { ...(previousOutput || {}), reasoningData: result.data };
    });
  },
);
