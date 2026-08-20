/**
 * Navigation Runner — per-step execution.
 * Runs one JourneyStep against a single, continuous page. Session state
 * (a dismissed cookie banner, an opened chat) carries across steps flagged
 * depends_on_previous; independent steps re-baseline from starting_url first,
 * so one step's side effects don't silently leak into an unrelated one.
 */

import { performStepAction, safeGoto } from './actions.js';
import { captureStepEvidence } from './capture.js';
import { attemptRecovery } from './recovery.js';

/**
 * executeStep — attempts one JourneyStep, captures evidence regardless of
 * outcome, and never throws: every failure mode resolves to a result object
 * with status 'success' | 'failed' | 'skipped' so the run can continue.
 */
export async function executeStep({ page, step, index, journeyPlan, companySlug, runId, previousStepFailed }) {
  const startedAt = Date.now();

  if (step.depends_on_previous && previousStepFailed) {
    const actionResult = {
      success: false,
      action_taken: null,
      error: 'Skipped — the step this one depends on did not succeed.',
    };
    const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });
    return {
      step_id: step.id,
      title: step.title,
      status: 'skipped',
      action_taken: null,
      error: actionResult.error,
      recovered: false,
      ...evidence,
      execution_time_ms: Date.now() - startedAt,
    };
  }

  if (!step.depends_on_previous) {
    try {
      await safeGoto(page, journeyPlan.starting_url);
    } catch (err) {
      const actionResult = { success: false, action_taken: null, error: `Could not reload starting_url: ${err.message}` };
      const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });
      return {
        step_id: step.id,
        title: step.title,
        status: 'failed',
        action_taken: null,
        error: actionResult.error,
        recovered: false,
        ...evidence,
        execution_time_ms: Date.now() - startedAt,
      };
    }
  }

  let actionResult;
  try {
    actionResult = await performStepAction(page, step);
  } catch (err) {
    actionResult = { success: false, error: err.message, action_taken: null };
  }

  let recovered = false;
  if (!actionResult.success) {
    actionResult = await attemptRecovery({ page, step, previousResult: actionResult });
    recovered = !!actionResult.recovered;
  }

  const evidence = await captureStepEvidence(page, { companySlug, runId, index, step, actionResult });

  return {
    step_id: step.id,
    title: step.title,
    status: actionResult.success ? 'success' : 'failed',
    action_taken: actionResult.action_taken,
    error: actionResult.error || null,
    recovered,
    ...evidence,
    execution_time_ms: Date.now() - startedAt,
  };
}
