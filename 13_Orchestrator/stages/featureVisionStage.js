/**
 * featureVisionStage — selects the ONE screenshot to analyse for the
 * requested feature, then sends it to the existing, unmodified Vision
 * capability (VisionProvider.describe()).
 *
 * Correctness rewrite (evidence integrity). Previously, when the mapped
 * journey step was not found among the captured steps, this stage fell back
 * to "the last successful step" — which, for a Homepage benchmark walking a
 * generic journey, was a Payment or Loyalty screenshot. That is forbidden.
 *
 * Now:
 *  - navigation is already feature-scoped (featureJourneyStage produces one
 *    step), so `steps` normally holds exactly the right screenshot;
 *  - selection accepts ONLY: the feature's own step, or — for a
 *    homepage-scoped / unmapped feature — the homepage base screenshot of
 *    the SAME target domain;
 *  - anything else FAILS the evidence stage with a clear reason. There is no
 *    unrelated-screenshot path;
 *  - every evidence item carries { company, url, feature, screenshotPath,
 *    evidenceType, relevance } and is validated against the target
 *    (company slug, feature, domain) before Vision is called.
 */
import { existsSync } from 'fs';
import { basename } from 'path';
import { getVisionProvider } from '../../12_Provider_Layer/registry/ProviderRegistry.js';
import { Stage } from '../runtime/Stage.js';
import { resolveFeatureIntent } from '../featureNavigation/featureIntent.js';
import { assertObservedUrl, sameRegistrableDomain, targetLogFields } from '../runtime/benchmarkTarget.js';
import { getStorage, keyForScreenshot, keyForNavArtifact, persistFile } from '../../10_Dashboard/lib/storage/index.js';
import { withLogContext, logInfo, logError } from '../../shared/logger.mjs';

// Re-exported for existing callers/tests that imported it from here.
export { mapFeatureToStepId } from '../featureNavigation/featureIntent.js';

/**
 * Choose the evidence screenshot. Returns { evidence } or throws.
 * `evidence` = { company, url, feature, screenshotPath, evidenceType,
 * relevance, stepId, stepStatus }.
 *
 * Accepts ONLY:
 *   - the feature's own scoped step (relevance: 'direct'), or
 *   - for a homepage-scoped / unmapped feature, a step_01_entry step whose
 *     page_url is on the target's own domain (relevance: 'base_page').
 * Anything else throws — there is deliberately no "use whatever screenshot
 * we have" path, because that is exactly what analysed a Payment screenshot
 * for a Homepage benchmark.
 */
export function selectEvidence({ steps, target, intent }) {
  const withShots = steps.filter((s) => s.screenshot_path && existsSync(s.screenshot_path));

  // 1 — the feature's own step.
  const own = withShots.find((s) => s.step_id === intent.stepId);
  const ownOnDomain = own && (own.page_url == null || sameRegistrableDomain(target.url, own.page_url));

  // 1a — the feature's own step ACTUALLY SUCCEEDED: this is direct evidence
  //      of the feature. A failed/skipped step whose planned interaction
  //      never landed (e.g. a consent overlay blocked the click) must NOT be
  //      labelled "direct feature_page" — see 1b.
  if (ownOnDomain && own.status === 'success') {
    return {
      evidence: {
        company: target.slug,
        url: own.page_url || target.url,
        feature: target.feature,
        screenshotPath: own.screenshot_path,
        evidenceType: intent.homepageOnly ? 'homepage' : 'feature_page',
        relevance: 'direct',
        stepId: own.step_id,
        stepStatus: own.status,
        navBlocked: false,
      },
    };
  }

  // 2 — homepage base fallback: ONLY a step_01_entry screenshot on the
  //     target's own domain, and ONLY for a homepage-scoped feature.
  if (intent.homepageOnly) {
    const base = withShots.find(
      (s) => s.step_id === 'step_01_entry' &&
        (s.page_url == null || sameRegistrableDomain(target.url, s.page_url)),
    );
    if (base) {
      return {
        evidence: {
          company: target.slug,
          url: base.page_url || target.url,
          feature: target.feature,
          screenshotPath: base.screenshot_path,
          evidenceType: 'homepage_base',
          relevance: 'base_page',
          stepId: base.step_id,
          stepStatus: base.status,
          navBlocked: false,
        },
      };
    }
  }

  // 1b — the feature's own step reached the target domain but its interaction
  //      did NOT succeed. The screenshot documents where navigation stopped
  //      (a blocked / incomplete state), so it is still worth analysing — but
  //      it is base_page evidence, never "direct", and featureStepFound stays
  //      false so Reasoning reports the navigation limitation honestly.
  if (ownOnDomain && own.status !== 'success') {
    return {
      evidence: {
        company: target.slug,
        url: own.page_url || target.url,
        feature: target.feature,
        screenshotPath: own.screenshot_path,
        evidenceType: 'blocked_state',
        relevance: 'base_page',
        stepId: own.step_id,
        stepStatus: own.status,
        navBlocked: true,
        navBlockReason: own.error || 'the planned interaction for this step did not complete',
      },
    };
  }

  // 3 — nothing acceptable. Do NOT analyse an unrelated screenshot.
  const seen = steps.map((s) => `${s.step_id}:${s.status}${s.screenshot_path ? '' : ' (no shot)'}`).join(', ');
  throw new Error(
    `No evidence relevant to "${target.feature}" for ${target.company} was captured (needed step "${intent.stepId}"). ` +
    `Captured: [${seen || 'nothing'}]. Refusing to analyse an unrelated screenshot.`,
  );
}

export const featureVisionStage = new Stage(
  'feature_vision',
  'Screenshot Selection + Vision Analysis',
  async ({ target, previousOutput }) => {
    return withLogContext({ stage: 'feature_vision' }, async () => {
      if (!target) throw new Error('featureVisionStage requires a benchmark target.');
      const steps = previousOutput?.steps || [];
      const intent = resolveFeatureIntent(target.feature);

      logInfo('Feature Vision starting', { ...targetLogFields(target), feature_step: intent.stepId, homepage_only: intent.homepageOnly });

      const { evidence } = selectEvidence({ steps, target, intent });

      // ── Validate the chosen evidence against the target BEFORE spending a
      //    Vision call on it.
      if (evidence.company !== target.slug) {
        throw new Error(`Evidence company "${evidence.company}" != target slug "${target.slug}".`);
      }
      if (evidence.feature !== target.feature) {
        throw new Error(`Evidence feature "${evidence.feature}" != target feature "${target.feature}".`);
      }
      if (evidence.url) assertObservedUrl(target, evidence.url, 'Feature Vision (evidence url)');
      if (!existsSync(evidence.screenshotPath)) {
        throw new Error(`Evidence screenshot "${evidence.screenshotPath}" does not exist on disk.`);
      }

      logInfo('Evidence selected for Vision', {
        ...targetLogFields(target),
        screenshotPath: evidence.screenshotPath,
        evidenceType: evidence.evidenceType,
        relevance: evidence.relevance,
        stepStatus: evidence.stepStatus,
      });

      const visionStartedAt = Date.now();
      let result;
      try {
        result = await getVisionProvider().describe({
          screenshotPath: evidence.screenshotPath,
          companySlug: target.slug,
          url: evidence.url,
          title: null,
        });
      } catch (err) {
        logError('Vision request threw', err);
        throw err; // rethrow unchanged
      }
      logInfo('Vision request finished', { ...targetLogFields(target), success: result.success, durationMs: Date.now() - visionStartedAt });

      if (!result.success) {
        throw new Error(result.error || 'Vision analysis failed');
      }

      // ── Persist the evidence to R2, keyed by requestId (never by the
      //    mutable company label). Screenshot + Vision findings + the
      //    navigation manifest are the artifacts needed to re-open / audit
      //    this run later. When STORAGE_PROVIDER=r2, a failed upload FAILS
      //    the run — evidence that only exists on Render's ephemeral disk is
      //    not "safely persisted". Local-provider mode is a no-op.
      const storage = getStorage();
      const evidenceKeys = {};
      if (storage.isRemote) {
        const rid = target.requestId;
        const uploads = [
          ['screenshot', keyForScreenshot(rid, basename(evidence.screenshotPath)), evidence.screenshotPath],
        ];
        if (result.jsonPath && existsSync(result.jsonPath)) {
          uploads.push(['vision', keyForScreenshot(rid, 'vision.json'), result.jsonPath]);
        }
        const manifestPath = previousOutput?.manifest_path;
        if (manifestPath && existsSync(manifestPath)) {
          uploads.push(['manifest', keyForNavArtifact(rid, 'run_manifest.json'), manifestPath]);
        }
        for (const [name, key, path] of uploads) {
          const r = await persistFile(key, path);
          if (!r.ok) {
            logError('Feature Vision: evidence upload to persistent storage FAILED', { name, key, error: r.error, ...targetLogFields(target) });
            throw new Error(
              `Evidence (${name}) captured but could NOT be saved to persistent storage (${r.error}). ` +
              `Refusing to treat this benchmark as persisted.`,
            );
          }
          evidenceKeys[name] = key;
        }
        logInfo('Feature Vision: evidence persisted to R2', { ...evidenceKeys, ...targetLogFields(target) });
      }

      return {
        // accumulator fields threaded to Reasoning / Report Writer / gate
        targetCompany: target.company,
        targetFeature: target.feature,
        url: evidence.url || null,
        title: null,
        screenshotPath: evidence.screenshotPath,
        visionFindings: result.findings,
        visionJsonPath: result.jsonPath,
        featureStepId: intent.stepId,
        featureStepFound: evidence.relevance === 'direct',
        navBlocked: !!evidence.navBlocked,
        navBlockReason: evidence.navBlockReason || null,
        selectedStep: { step_id: evidence.stepId, status: evidence.stepStatus },
        evidence: { ...evidence, r2Key: evidenceKeys.screenshot || null },
        evidenceKeys,
        timing: result.timing,
      };
    });
  },
);
